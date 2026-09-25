"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { qk } from "@/lib/queries/keys";
import { useDict } from "@/lib/i18n";
import { resourceKey } from "@/lib/link-library";
import type { Competitor, CompetitorCategory, Project, Updater } from "@/lib/types";

export type CompetitorForm = {
  id?: string;
  project_id: string;
  name: string;
  url: string;
  summary: string;
  category: CompetitorCategory;
  useful_features: string;
  social_content: string;
  pricing_model: string;
  lessons: string;
  relevance_score: string;
  score_rationale: string;
  social_links: string;
  source_urls: string;
  reviewed_at: string;
};

export function emptyCompetitorForm(projectId = ""): CompetitorForm {
  return {
    project_id: projectId,
    name: "",
    url: "",
    summary: "",
    category: "direct",
    useful_features: "",
    social_content: "",
    pricing_model: "",
    lessons: "",
    relevance_score: "",
    score_rationale: "",
    social_links: "",
    source_urls: "",
    reviewed_at: "",
  };
}

export function competitorToForm(competitor: Competitor): CompetitorForm {
  return {
    id: competitor.id,
    project_id: competitor.project_id,
    name: competitor.name,
    url: competitor.url ?? "",
    summary: competitor.summary,
    category: competitor.category,
    useful_features: competitor.useful_features.join("\n"),
    social_content: competitor.social_content,
    pricing_model: competitor.pricing_model,
    lessons: competitor.lessons,
    relevance_score: competitor.relevance_score ? String(competitor.relevance_score) : "",
    score_rationale: competitor.score_rationale,
    social_links: competitor.social_links.join("\n"),
    source_urls: competitor.source_urls.join("\n"),
    reviewed_at: competitor.reviewed_at ?? "",
  };
}

const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const urlLines = (value: string) => lines(value).filter((line) => resourceKey(line));

/** Shared create/update dialog for the Competition section and a project's Competition tab. */
export function CompetitorDialog({ open, onOpenChange, form, setForm, projects, setCompetitors }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: CompetitorForm;
  setForm: (next: CompetitorForm) => void;
  projects: Project[];
  setCompetitors: Updater<Competitor[]>;
}) {
  const t = useDict();
  const p = t.portfolio;
  const supabase = createClient();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const close = (next: boolean) => {
    if (!next) setError(null);
    onOpenChange(next);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.project_id) return setError(p.nameAndProjectRequired);
    const payload = {
      project_id: form.project_id,
      name: form.name.trim(),
      url: form.url.trim() && resourceKey(form.url.trim()) ? form.url.trim() : null,
      summary: form.summary.trim(),
      category: form.category,
      useful_features: lines(form.useful_features),
      social_content: form.social_content.trim(),
      pricing_model: form.pricing_model.trim(),
      lessons: form.lessons.trim(),
      relevance_score: form.relevance_score ? Number(form.relevance_score) : null,
      score_rationale: form.score_rationale.trim(),
      social_links: urlLines(form.social_links),
      source_urls: urlLines(form.source_urls),
      reviewed_at: form.reviewed_at || null,
    };
    setSaving(true);
    try {
      if (form.id) {
        const { data, error: updateError } = await supabase.from("competitors").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", form.id).select().single();
        if (updateError) throw updateError;
        setCompetitors((prev) => prev.map((item) => (item.id === form.id ? (data as Competitor) : item)));
      } else {
        const userId = await currentUserId(supabase);
        if (!userId) throw new Error(t.common.signInFirst);
        const { data, error: insertError } = await supabase.from("competitors").insert({ ...payload, user_id: userId }).select().single();
        if (insertError) throw insertError;
        setCompetitors((prev) => [...prev, data as Competitor]);
      }
      void qc.invalidateQueries({ queryKey: qk.competitors });
      close(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof CompetitorForm) => ({
    value: form[key] as string,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [key]: event.target.value }),
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? p.editCompetitor : p.addCompetitor}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="competitor-project">{p.project}</Label>
              <SimpleSelect id="competitor-project" value={form.project_id} onValueChange={(project_id) => setForm({ ...form, project_id })} options={projects.map((project) => ({ value: project.id, label: project.name }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-category">{p.competitorCategory}</Label>
              <SimpleSelect id="competitor-category" value={form.category} onValueChange={(category) => setForm({ ...form, category: category as CompetitorCategory })} options={(["direct", "indirect", "inspiration"] as CompetitorCategory[]).map((value) => ({ value, label: p.categories[value] }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-name">{p.competitorName}</Label>
              <Input id="competitor-name" autoFocus {...field("name")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-url">{p.competitorUrl}</Label>
              <Input id="competitor-url" inputMode="url" placeholder="https://" {...field("url")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="competitor-summary">{p.competitorSummary}</Label>
            <Textarea id="competitor-summary" rows={2} {...field("summary")} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="competitor-features">{p.usefulFeatures}</Label>
              <Textarea id="competitor-features" rows={4} placeholder={p.usefulFeaturesHint} {...field("useful_features")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-social">{p.socialContent}</Label>
              <Textarea id="competitor-social" rows={4} {...field("social_content")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-pricing">{p.pricingModel}</Label>
              <Textarea id="competitor-pricing" rows={3} {...field("pricing_model")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-lessons">{p.lessons}</Label>
              <Textarea id="competitor-lessons" rows={3} {...field("lessons")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-score">{p.relevanceScore}</Label>
              <SimpleSelect id="competitor-score" value={form.relevance_score} onValueChange={(relevance_score) => setForm({ ...form, relevance_score })} options={[{ value: "", label: p.notScored }, ...[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: `${value}/5` }))]} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-reviewed">{p.reviewedAt}</Label>
              <Input id="competitor-reviewed" type="date" {...field("reviewed_at")} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="competitor-rationale">{p.scoreRationale}</Label>
              <Input id="competitor-rationale" {...field("score_rationale")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-social-links">{p.socialLinks}</Label>
              <Textarea id="competitor-social-links" rows={3} placeholder={p.oneUrlPerLine} {...field("social_links")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="competitor-sources">{p.sourceUrls}</Label>
              <Textarea id="competitor-sources" rows={3} placeholder={p.oneUrlPerLine} {...field("source_urls")} />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => close(false)}>{t.common.cancel}</Button>
            <Button type="submit" disabled={saving}>{form.id ? t.common.save : t.common.add}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Confirmed delete shared by both surfaces; keeps the cache and the query in step. */
export function useDeleteCompetitor(setCompetitors: Updater<Competitor[]>) {
  const t = useDict();
  const p = t.portfolio;
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirmation();
  return async (competitor: Competitor) => {
    if (!await confirm({
      title: p.deleteCompetitor,
      description: p.deleteCompetitorConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) return;
    const { error } = await supabase.from("competitors").delete().eq("id", competitor.id);
    if (error) return toast.err(error.message);
    setCompetitors((prev) => prev.filter((item) => item.id !== competitor.id));
    void qc.invalidateQueries({ queryKey: qk.competitors });
  };
}
