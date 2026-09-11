"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useLang } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { httpsUrl, PREVIEW_PLATFORMS, type FreelancePlatform } from "@/lib/freelance";

export function useFreelancePlatforms(userId: string, isPreview: boolean) {
  return useQuery({ queryKey: [...qk.freelancePlatforms, userId], enabled: !isPreview && Boolean(userId), staleTime: 60_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await createClient().from("freelance_platforms").select("*").eq("user_id", userId).order("name").limit(500).abortSignal(signal);
      if (error) throw error;
      return data as FreelancePlatform[];
    },
  });
}

export function FreelancePlatforms({ userId, isPreview = false }: { userId: string; isPreview?: boolean }) {
  const cs = useLang().lang === "cs";
  const directory = useFreelancePlatforms(userId, isPreview);
  const rows = isPreview ? PREVIEW_PLATFORMS : directory.data ?? [];
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<FreelancePlatform | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const states = cs ? { draft: "Profil připraven", needs_login: "Vyžaduje přihlášení", needs_verification: "Vyžaduje ověření", terms_pending: "Čeká na souhlas s podmínkami", published: "Profil zveřejněn", paused: "Pozastaveno" }
    : { draft: "Profile drafted", needs_login: "Login needed", needs_verification: "Verification needed", terms_pending: "Terms approval needed", published: "Profile published", paused: "Paused" };
  const kinds = cs ? { marketplace: "Zakázky", services: "Nabídky služeb", directory: "Katalog", leads: "Poptávky", vetted: "Výběrová síť" }
    : { marketplace: "Projects", services: "Service catalog", directory: "Directory", leads: "Leads", vetted: "Vetted network" };
  const save = useMutation({ mutationFn: async (item: FreelancePlatform) => {
    if (isPreview) throw new Error("preview");
    const { error } = await createClient().from("freelance_platforms").upsert({ ...item, user_id: userId, updated_at: new Date().toISOString() });
    if (error) throw error;
  }, onSuccess: () => { void qc.invalidateQueries({ queryKey: [...qk.freelancePlatforms, userId] }); setEditing(null); toast.ok(cs ? "Profil uložen" : "Profile saved"); },
  onError: () => toast.err(cs ? "Profil se nepodařilo uložit." : "Could not save the profile.") });
  const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); toast.ok(cs ? "Zkopírováno" : "Copied"); } catch { toast.err(cs ? "Text označte a zkopírujte ručně." : "Select and copy the text manually."); } };
  const add = () => setEditing({ ...PREVIEW_PLATFORMS[0], id: crypto.randomUUID(), user_id: userId, name: "", url: "", search_url: "", registration_url: null, profile_title: "", profile_text: "", services: "", fee_notes: "", evidence_url: null });
  const valid = editing && editing.name.trim() && httpsUrl(editing.url) && httpsUrl(editing.search_url)
    && (!editing.resources_url || httpsUrl(editing.resources_url)) && (!editing.profile_url || httpsUrl(editing.profile_url)) && (!editing.registration_url || httpsUrl(editing.registration_url))
    && (editing.profile_status !== "published" || httpsUrl(editing.profile_url));
  return <section className="space-y-4">
    <p className="max-w-3xl text-sm text-foreground-muted">{cs ? "Otevřete vyhledávání, vyberte zakázku a uložte ji do přehledu. Připravené texty profilů lze upravit a zkopírovat; zveřejnění a přihlášení probíhá na dané platformě." : "Open a search, choose a project and save it to the pipeline. Edit and copy your profile drafts here, then sign in and publish on the platform."}</p>
    <div className="flex flex-wrap gap-2"><Input className="max-w-md" aria-label={cs ? "Hledat platformu" : "Search platforms"} placeholder={cs ? "Hledat platformu" : "Search platforms"} value={search} onChange={e => setSearch(e.target.value)} /><Button variant="outline" onClick={add}>{cs ? "Přidat platformu" : "Add platform"}</Button></div>
    {!isPreview && directory.isPending && <p role="status">{cs ? "Načítám platformy…" : "Loading platforms…"}</p>}
    {!isPreview && directory.isError && <div role="alert"><p>{cs ? "Platformy se nepodařilo načíst." : "Could not load platforms."}</p><Button onClick={() => directory.refetch()}>{cs ? "Zkusit znovu" : "Retry"}</Button></div>}
    <div className="divide-y divide-border rounded-lg border border-border bg-surface">{rows.filter(row => `${row.name} ${row.notes}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(row => <article key={row.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0"><h2 className="font-semibold">{row.name} <span className="ml-2 text-xs font-normal text-foreground-muted">{kinds[row.kind]} · {states[row.profile_status]}</span></h2>
        <p className="mt-1 text-sm text-foreground-muted whitespace-pre-line break-words">{row.notes}</p>{row.fee_notes && <p className="mt-2 text-xs text-foreground-subtle">{row.fee_notes}</p>}
        {row.checked_on && <p className="mt-1 text-xs text-foreground-subtle">{cs ? "Prověřeno" : "Checked"}: {row.checked_on}</p>}</div>
      <div className="flex flex-wrap items-start gap-2">{httpsUrl(row.resources_url) && <Button asChild variant="outline" size="sm"><a href={httpsUrl(row.resources_url)} target="_blank" rel="noreferrer">{cs ? "Podklady CZ / EN" : "CZ / EN resources"}</a></Button>}<Button asChild variant="outline" size="sm"><a href={httpsUrl(row.search_url)} target="_blank" rel="noreferrer">{cs ? "Hledat zakázky" : "Find projects"}</a></Button><Button size="sm" onClick={() => setEditing({ ...row })}>{cs ? "Profil a služby" : "Profile & services"}</Button>{httpsUrl(row.profile_url) && <Button asChild variant="outline" size="sm"><a href={httpsUrl(row.profile_url)} target="_blank" rel="noreferrer">{cs ? "Veřejný profil" : "Public profile"}</a></Button>}</div>
    </article>)}</div>
    {(isPreview || directory.isSuccess) && !rows.filter(row => `${row.name} ${row.notes}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).length && <p role="status">{cs ? "Žádná platforma neodpovídá hledání." : "No platforms match your search."}</p>}
    <Dialog open={Boolean(editing)} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editing?.name || (cs ? "Nová platforma" : "New platform")}</DialogTitle><DialogDescription>{cs ? "Uložením upravíte údaje v OwnDashboard. Veřejný profil se upravuje na webu platformy." : "Saving updates OwnDashboard. Edit your public profile on the platform itself."}</DialogDescription></DialogHeader>
      {editing && <div className="space-y-4">
        {([['name', cs ? 'Název' : 'Name'], ['url', cs ? 'Web platformy' : 'Platform website'], ['search_url', cs ? 'Odkaz na vyhledávání' : 'Search URL'], ['registration_url', cs ? 'Registrace / přihlášení' : 'Registration / login'], ['profile_url', cs ? 'Odkaz na skutečný profil' : 'Actual profile URL'], ['resources_url', cs ? 'Složka s texty a obrázky' : 'Text and image folder'], ['profile_title', cs ? 'Nadpis profilu' : 'Profile headline']] as const).map(([key,label]) => <div key={key} className="space-y-1.5"><Label htmlFor={`fp-${key}`}>{label}</Label><Input id={`fp-${key}`} value={editing[key] ?? ""} onChange={e => setEditing({ ...editing, [key]: e.target.value || (key.endsWith("url") ? null : "") })} /></div>)}
        <SimpleSelect aria-label={cs ? "Druh platformy" : "Platform type"} value={editing.kind} onValueChange={value => setEditing({ ...editing, kind: value as FreelancePlatform['kind'] })} options={Object.entries(kinds).map(([value,label]) => ({value,label}))} />
        <SimpleSelect aria-label={cs ? "Stav profilu" : "Profile status"} value={editing.profile_status} onValueChange={value => setEditing({ ...editing, profile_status: value as FreelancePlatform['profile_status'] })} options={Object.entries(states).map(([value,label]) => ({value,label}))} />
        {([['profile_text', cs ? 'Text profilu' : 'Profile text'], ['services', cs ? 'Nabídky služeb' : 'Service offers'], ['notes', cs ? 'Postup a poznámky' : 'Next steps and notes'], ['fee_notes', cs ? 'Poplatky a omezení' : 'Fees and restrictions']] as const).map(([key,label]) => <div key={key} className="space-y-1.5"><Label htmlFor={`fp-${key}`}>{label}</Label><Textarea id={`fp-${key}`} rows={key === 'profile_text' || key === 'services' ? 8 : 3} value={editing[key]} onChange={e => setEditing({ ...editing, [key]: e.target.value })} />{(key === 'profile_text' || key === 'services') && <Button variant="outline" size="sm" onClick={() => copy(editing[key])}>{cs ? "Kopírovat text" : "Copy text"}</Button>}</div>)}
        {httpsUrl(editing.registration_url) && <a className="focus-ring inline-flex min-h-11 items-center text-sm underline" href={httpsUrl(editing.registration_url)} target="_blank" rel="noreferrer">{cs ? "Otevřít registraci / přihlášení" : "Open registration / login"}</a>}
        {httpsUrl(editing.evidence_url) && <a className="focus-ring ml-4 inline-flex min-h-11 items-center text-sm underline" href={httpsUrl(editing.evidence_url)} target="_blank" rel="noreferrer">{cs ? "Zdroj informací" : "Evidence source"}</a>}
      </div>}
      <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>{cs ? "Zavřít" : "Close"}</Button><Button disabled={!valid || save.isPending || isPreview} onClick={() => editing && save.mutate(editing)}>{cs ? "Uložit profil" : "Save profile"}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
