"use client";

import {
  Bot,
  Coins,
  Download,
  FileText,
  GripVertical,
  Languages,
  ListTodo,
  Moon,
  PanelLeft,
  Palette,
  Plug,
  RotateCcw,
  Shield,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useDict, useLang } from "@/lib/i18n";
import {
  useCvLinks,
  useDisplayCurrency,
  useNavOrder,
  useNavVisibility,
  useTasksPerCategory,
  sortByNavOrder,
  TASKS_PER_CATEGORY_OPTIONS,
} from "@/lib/use-prefs";
import { useTheme } from "@/lib/use-theme";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { HOME_ITEM, INBOX_ITEM, NAV_GROUPS } from "@/components/nav/sidebar";
import { cn } from "@/lib/utils";

type NavRowItem = { value: string; icon: typeof Sun };

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: typeof Sun }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex p-0.5 rounded-md bg-surface-muted">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors focus-ring",
              active
                ? "bg-surface text-foreground shadow-soft"
                : "text-foreground-muted hover:text-foreground",
            )}
          >
            {o.icon && <o.icon className="h-3.5 w-3.5" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsPanel({ syncPreferences = true }: { syncPreferences?: boolean }) {
  const t = useDict();
  const { lang, setLang } = useLang();
  const { currency, setCurrency } = useDisplayCurrency();
  const { isHidden, toggle, reset: resetVisibility } = useNavVisibility();
  const { order, setOrder, reset: resetOrder } = useNavOrder();
  const { theme, setTheme } = useTheme();
  const [aiPrefs, setAiPrefs] = useState({ enabled: true, sensitive: false });
  const [integrations, setIntegrations] = useState<null | Record<string, { connected?: boolean; configured: boolean; last_synced_at?: string | null }>>(null);
  useEffect(() => {
    if (!syncPreferences) return;
    void fetch("/api/user/preferences", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) setAiPrefs({ enabled: data.ai_enabled ?? true, sensitive: data.ai_sensitive_opt_in ?? false });
      });
  }, [syncPreferences]);
  useEffect(() => {
    if (!syncPreferences) return;
    void fetch("/api/integrations/status", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setIntegrations(data); });
  }, [syncPreferences]);
  const patchAiPrefs = (patch: { enabled?: boolean; sensitive?: boolean }) => {
    const next = { ...aiPrefs, ...patch };
    setAiPrefs(next);
    if (syncPreferences) {
      void fetch("/api/user/preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ai_enabled: next.enabled, ai_sensitive_opt_in: next.sensitive }) });
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Reordering is scoped to a single group (the sidebar keeps its groups), so
  // on drop we rebuild the full flat order group-by-group and persist it.
  function handleGroupDragEnd(groupId: string, e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const group = NAV_GROUPS.find((g) => g.id === groupId);
    if (!group) return;
    const current = sortByNavOrder(group.items, order);
    const oldIndex = current.findIndex((i) => i.value === e.active.id);
    const newIndex = current.findIndex((i) => i.value === e.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const movedGroup = arrayMove(current, oldIndex, newIndex);
    const flat: string[] = [];
    for (const g of NAV_GROUPS) {
      const items =
        g.id === groupId ? movedGroup : sortByNavOrder(g.items, order);
      flat.push(...items.map((i) => i.value));
    }
    setOrder(flat);
  }
  const { count: tasksPerCategory, setCount: setTasksPerCategory } =
    useTasksPerCategory();
  const { cs: cvCs, en: cvEn, setCs: setCvCs, setEn: setCvEn } = useCvLinks();

  return (
    <div>
      <PageHeader title={t.settings.title} description={t.settings.description} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Language */}
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Languages className="h-3 w-3" /> {t.settings.language}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-foreground-subtle">
              {t.settings.languageDesc}
            </p>
            <Segmented
              value={lang}
              onChange={setLang}
              options={[
                { value: "cs", label: t.settings.czech },
                { value: "en", label: t.settings.english },
              ]}
            />
          </CardContent>
        </Card>

        {/* Display currency */}
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Coins className="h-3 w-3" /> {t.settings.currency}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-foreground-subtle">
              {t.settings.currencyDesc}
            </p>
            <div className="inline-flex flex-wrap gap-1.5">
              {SUPPORTED_CURRENCIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCurrency(c)}
                  aria-pressed={currency === c}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium tabular transition-colors focus-ring",
                    currency === c
                      ? "border-foreground/40 bg-accent text-foreground"
                      : "border-border text-foreground-muted hover:text-foreground hover:border-border-strong",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Tasks */}
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <ListTodo className="h-3 w-3" /> {t.settings.tasks}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-foreground-subtle">
              {t.settings.tasksDesc}
            </p>
            <Segmented
              value={String(tasksPerCategory)}
              onChange={(v) => setTasksPerCategory(Number(v))}
              options={TASKS_PER_CATEGORY_OPTIONS.map((n) => ({
                value: String(n),
                label: n === 0 ? t.settings.tasksAll : String(n),
              }))}
            />
          </CardContent>
        </Card>

        {/* Appearance */}
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Palette className="h-3 w-3" /> {t.settings.appearance}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-foreground-subtle">
              {t.settings.appearanceDesc}
            </p>
            <Segmented
              value={theme}
              onChange={setTheme}
              options={[
                { value: "light", label: t.settings.light, icon: Sun },
                { value: "dark", label: t.settings.dark, icon: Moon },
              ]}
            />
          </CardContent>
        </Card>

        {/* CV links */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> {t.settings.cv}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-foreground-subtle">{t.settings.cvDesc}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cv-cs">{t.settings.cvCzech}</Label>
                <Input
                  id="cv-cs"
                  type="url"
                  inputMode="url"
                  placeholder={t.settings.cvPlaceholder}
                  value={cvCs}
                  onChange={(e) => setCvCs(e.target.value.trim())}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cv-en">{t.settings.cvEnglish}</Label>
                <Input
                  id="cv-en"
                  type="url"
                  inputMode="url"
                  placeholder={t.settings.cvPlaceholder}
                  value={cvEn}
                  onChange={(e) => setCvEn(e.target.value.trim())}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Navigation sections */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <PanelLeft className="h-3 w-3" /> {t.settings.navigation}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-foreground-subtle mb-3">
              {t.settings.navigationDesc}
            </p>

            {[HOME_ITEM, INBOX_ITEM].map((item) => <div key={item.value} className="flex items-center justify-between gap-3 px-2 py-2.5"><div className="flex min-w-0 items-center gap-2.5 pl-[26px]"><item.icon className="h-4 w-4 shrink-0 text-foreground-muted" /><span className="truncate text-sm font-medium">{t.nav.sections[item.value]}</span></div><SectionLabel className="shrink-0">{t.settings.alwaysVisible}</SectionLabel></div>)}

            {NAV_GROUPS.map((g) => {
              const items = sortByNavOrder(g.items, order);
              return (
                <div key={g.id} className="mt-3">
                  <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-foreground-subtle">
                    {t.nav.groups[g.id]}
                  </p>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(e) => handleGroupDragEnd(g.id, e)}
                  >
                    <SortableContext
                      items={items.map((i) => i.value)}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul>
                        {items.map((it) => (
                          <SortableNavRow
                            key={it.value}
                            item={it}
                            label={t.nav.sections[it.value]}
                            dragLabel={t.settings.reorder}
                            visible={!isHidden(it.value)}
                            onToggle={() => toggle(it.value)}
                          />
                        ))}
                      </ul>
                    </SortableContext>
                  </DndContext>
                </div>
              );
            })}
            <Button variant="outline" size="sm" className="mt-4" onClick={() => { resetVisibility(); resetOrder(); }}><RotateCcw />{t.settings.resetNavigation}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="inline-flex items-center gap-1.5"><Bot className="h-3 w-3" />{t.settings.ai}</CardTitle></CardHeader>
          <CardContent className="space-y-4"><p className="text-xs text-foreground-subtle">{t.settings.aiDesc}</p><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{t.settings.aiEnabled}</span><Switch aria-label={t.settings.aiEnabled} checked={aiPrefs.enabled} onCheckedChange={(enabled) => patchAiPrefs({ enabled })} /></div><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{t.settings.aiSensitive}</p><p className="mt-1 text-xs text-foreground-subtle">{t.settings.aiSensitiveDesc}</p></div><Switch aria-label={t.settings.aiSensitive} checked={aiPrefs.sensitive} disabled={!aiPrefs.enabled} onCheckedChange={(sensitive) => patchAiPrefs({ sensitive })} /></div></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="inline-flex items-center gap-1.5"><Plug className="h-3 w-3" />{t.settings.integrations}</CardTitle></CardHeader>
          <CardContent className="space-y-3"><p className="text-xs text-foreground-subtle">{t.settings.integrationsDesc}</p>{[["Google", integrations?.google], ["GitHub", integrations?.github], [t.settings.bankSync, integrations?.bank], [t.settings.emailDelivery, integrations?.email]].map(([label, raw]) => { const state = raw as { connected?: boolean; configured: boolean; last_synced_at?: string | null } | undefined; return <div key={String(label)} className="flex items-center justify-between gap-3 rounded-md border border-border p-3"><div><p className="text-sm font-medium">{String(label)}</p>{state?.last_synced_at && <p className="mt-1 text-xs text-foreground-subtle">{t.settings.lastSync}: {state.last_synced_at.slice(0, 10)}</p>}</div><SectionLabel>{state ? (state.connected === true ? t.settings.connected : state.connected === false ? t.settings.notConnected : state.configured ? t.settings.configured : t.settings.notConfigured) : "…"}</SectionLabel></div>; })}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="inline-flex items-center gap-1.5"><Shield className="h-3 w-3" />{t.settings.dataExport}</CardTitle></CardHeader>
          <CardContent className="space-y-3"><p className="text-xs text-foreground-subtle">{t.settings.dataExportDesc}</p><div className="flex flex-wrap gap-2">{[["/api/export/full", t.settings.exportFull], ["/api/export/financial", t.settings.exportFinancial], ["/api/export/professional", t.settings.exportProfessional], ["/api/export/knowledge", t.settings.exportKnowledge], ["/api/export/projects", t.settings.exportProjects], ["/api/export/notes", t.settings.exportNotes], ["/api/export/prompts", t.settings.exportPrompts], ["/api/export/career", t.settings.exportCareer], ["/api/export/financial?format=csv&table=transactions", t.settings.exportTransactionsCsv], ["/api/export/legacy", t.settings.exportLegacy]].map(([href, label]) => <Button key={href} variant="outline" size="sm" asChild><a href={href} download><Download />{label}</a></Button>)}</div></CardContent>
        </Card>
      </div>
    </div>
  );
}

/** A draggable, toggleable nav-section row in Settings. The grip handle carries
 * the drag listeners so the Switch stays independently clickable. */
function SortableNavRow({
  item,
  label,
  dragLabel,
  visible,
  onToggle,
}: {
  item: NavRowItem;
  label: string;
  dragLabel: string;
  visible: boolean;
  onToggle: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.value });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center justify-between gap-3 rounded-md bg-surface px-2 py-2.5",
        isDragging && "shadow-soft ring-1 ring-border",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          aria-label={dragLabel}
          className="shrink-0 cursor-grab touch-none rounded text-foreground-subtle transition-colors hover:text-foreground focus-ring active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <item.icon className="h-4 w-4 shrink-0 text-foreground-muted" />
        <span className="truncate text-sm font-medium">{label}</span>
      </div>
      <Switch checked={visible} onCheckedChange={onToggle} aria-label={label} />
    </li>
  );
}
