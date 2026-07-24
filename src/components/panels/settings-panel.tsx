"use client";

import {
  Bell,
  Bot,
  Coins,
  Download,
  FileText,
  FolderKanban,
  GripVertical,
  Languages,
  ListTodo,
  Moon,
  PanelLeft,
  Palette,
  Plug,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { useDict, useLang } from "@/lib/i18n";
import {
  useCvLinks,
  useDisplayCurrency,
  useNavOrder,
  useNavVisibility,
  useTasksPerCategory,
  useProjectTabVisibility,
  sortByNavOrder,
  TASKS_PER_CATEGORY_OPTIONS,
} from "@/lib/use-prefs";
import { useTheme } from "@/lib/use-theme";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { HOME_ITEM, INBOX_ITEM, NAV_GROUPS } from "@/components/nav/sidebar";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { Project, Updater } from "@/lib/types";
import { useToast } from "@/components/ui/toast";
import { saveUserPreferences } from "@/lib/preference-client";
import {
  PROJECT_WORKSPACE_TABS,
  type ProjectWorkspaceTab,
} from "@/lib/project-workspace-tabs";

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

export function SettingsPanel({
  projects = [],
  setProjects = () => undefined,
  syncPreferences = true,
  preferencesSyncAvailable = true,
}: {
  projects?: Project[];
  setProjects?: Updater<Project[]>;
  syncPreferences?: boolean;
  preferencesSyncAvailable?: boolean;
}) {
  const t = useDict();
  const toast = useToast();
  const supabase = createClient();
  const { lang, setLang } = useLang();
  const { currency, setCurrency } = useDisplayCurrency();
  const {
    hidden,
    isHidden,
    setHidden,
    reset: resetVisibility,
  } = useNavVisibility();
  const { order, setOrder, reset: resetOrder } = useNavOrder();
  const { theme, setTheme } = useTheme();
  const [aiPrefs, setAiPrefs] = useState({ enabled: true, sensitive: false });
  const [renewalNotifications, setRenewalNotifications] = useState(true);
  // Inactive projects (often dozens of old repos) stay collapsed behind a toggle
  // so the card isn't a wall of switches for projects that will never be active.
  const [showInactive, setShowInactive] = useState(false);
  const [integrations, setIntegrations] = useState<null | Record<string, { connected?: boolean; configured: boolean; last_synced_at?: string | null }>>(null);
  const saveErrorShown = useRef(false);
  const savePreferences = (patch: Record<string, unknown>) => {
    if (!syncPreferences) return;
    void saveUserPreferences(patch).catch(() => {
      if (saveErrorShown.current) return;
      saveErrorShown.current = true;
      toast.err(t.settings.preferenceSaveFailed);
    });
  };
  useEffect(() => {
    if (!syncPreferences) return;
    void fetch("/api/user/preferences", { cache: "no-store" })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data) {
          setAiPrefs({ enabled: data.ai_enabled ?? true, sensitive: data.ai_sensitive_opt_in ?? false });
          setRenewalNotifications(data.notifications_renewals ?? true);
        }
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
      savePreferences({ ai_enabled: next.enabled, ai_sensitive_opt_in: next.sensitive });
    }
  };
  const patchRenewalNotifications = (notifications_renewals: boolean) => {
    setRenewalNotifications(notifications_renewals);
    if (syncPreferences) {
      savePreferences({ notifications_renewals });
    }
  };
  const toggleProject = async (project: Project) => {
    const next = !project.is_active;
    setProjects((current) =>
      current.map((item) =>
        item.id === project.id ? { ...item, is_active: next } : item,
      ),
    );
    const { error } = await supabase
      .from("projects")
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq("id", project.id);
    if (error) {
      setProjects((current) =>
        current.map((item) =>
          item.id === project.id
            ? { ...item, is_active: project.is_active }
            : item,
        ),
      );
      toast.err(t.settings.projectUpdateFailed);
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
    savePreferences({ navigation_order: flat });
  }
  const { count: tasksPerCategory, setCount: setTasksPerCategory } =
    useTasksPerCategory();
  const { cs: cvCs, en: cvEn, setCs: setCvCs, setEn: setCvEn } = useCvLinks();
  const { hiddenProjectTabs, setHiddenProjectTabs } =
    useProjectTabVisibility();
  const toggleProjectTab = (tab: ProjectWorkspaceTab) => {
    if (tab === "overview") return;
    const next = hiddenProjectTabs.includes(tab)
      ? hiddenProjectTabs.filter((item) => item !== tab)
      : [...hiddenProjectTabs, tab];
    setHiddenProjectTabs(next);
    savePreferences({ hidden_project_tabs: next });
  };
  const projectTabLabel = (tab: ProjectWorkspaceTab) => {
    const labels = {
      overview: t.professional.projectOverview,
      tasks: t.professional.projectTasks,
      activity: t.professional.projectActivity,
      communication: t.professional.projectCommunication,
      repository: t.professional.projectRepository,
      operations: t.professional.projectOperations,
      finance: t.professional.projectFinance,
      knowledge: t.professional.projectKnowledge,
      scaling: t.professional.projectScaling,
      monetization: t.professional.projectMonetization,
    };
    return labels[tab];
  };

  const activeProjectsList = projects.filter((p) => p.is_active);
  const inactiveProjectsList = projects.filter((p) => !p.is_active);
  const projectRow = (project: Project) => (
    <li
      key={project.id}
      className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{project.name}</p>
        <p className="truncate font-mono text-[10px] text-foreground-subtle">
          {project.repo_full_name ?? t.settings.projectWithoutRepository}
        </p>
      </div>
      <Switch
        checked={project.is_active}
        onCheckedChange={() => void toggleProject(project)}
        aria-label={project.name}
      />
    </li>
  );

  return (
    <div>
      <PageHeader title={t.settings.title} description={t.settings.description} />

      {!preferencesSyncAvailable && (
        <div
          role="status"
          className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground"
        >
          {t.settings.preferenceSyncUnavailable}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Preferences — language, appearance, currency, task density, alerts */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <SlidersHorizontal className="h-3 w-3" /> {t.settings.preferences}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-foreground-subtle">
              {t.settings.preferencesDesc}
            </p>
            <PrefRow icon={Languages} label={t.settings.language}>
              <Segmented
                value={lang}
                onChange={(language) => {
                  setLang(language);
                  savePreferences({ language });
                }}
                options={[
                  { value: "cs", label: t.settings.czech },
                  { value: "en", label: t.settings.english },
                ]}
              />
            </PrefRow>
            <PrefRow icon={Palette} label={t.settings.appearance}>
              <Segmented
                value={theme}
                onChange={(next) => {
                  setTheme(next);
                  savePreferences({ theme: next });
                }}
                options={[
                  { value: "light", label: t.settings.light, icon: Sun },
                  { value: "dark", label: t.settings.dark, icon: Moon },
                ]}
              />
            </PrefRow>
            <PrefRow icon={Coins} label={t.settings.currency}>
              <div className="inline-flex flex-wrap justify-end gap-1.5">
                {SUPPORTED_CURRENCIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setCurrency(c);
                      savePreferences({ display_currency: c });
                    }}
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
            </PrefRow>
            <PrefRow icon={ListTodo} label={t.settings.tasks}>
              <Segmented
                value={String(tasksPerCategory)}
                onChange={(v) => {
                  const tasks_per_category = Number(v);
                  setTasksPerCategory(tasks_per_category);
                  savePreferences({ tasks_per_category });
                }}
                options={TASKS_PER_CATEGORY_OPTIONS.map((n) => ({
                  value: String(n),
                  label: n === 0 ? t.settings.tasksAll : String(n),
                }))}
              />
            </PrefRow>
            <PrefRow
              icon={Bell}
              label={t.settings.renewalNotifications}
              desc={t.settings.renewalNotificationsDesc}
            >
              <Switch
                aria-label={t.settings.renewalNotifications}
                checked={renewalNotifications}
                onCheckedChange={patchRenewalNotifications}
              />
            </PrefRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <FolderKanban className="h-3 w-3" />
              {t.settings.projectSections}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-foreground-subtle">
              {t.settings.projectSectionsDesc}
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {PROJECT_WORKSPACE_TABS.map((tab) => {
                const alwaysVisible = tab === "overview";
                return (
                  <li
                    key={tab}
                    className="flex min-h-11 items-center justify-between gap-3 px-3 py-2"
                  >
                    <span className="text-sm font-medium">
                      {projectTabLabel(tab)}
                    </span>
                    {alwaysVisible ? (
                      <SectionLabel>{t.settings.alwaysVisible}</SectionLabel>
                    ) : (
                      <Switch
                        checked={!hiddenProjectTabs.includes(tab)}
                        onCheckedChange={() => toggleProjectTab(tab)}
                        aria-label={projectTabLabel(tab)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <FolderKanban className="h-3 w-3" />
              {t.settings.activeProjects}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-foreground-subtle">
                {t.settings.activeProjectsDesc}
              </p>
              <SectionLabel className="shrink-0">
                {t.settings.activeProjectCount(
                  activeProjectsList.length,
                  projects.length,
                )}
              </SectionLabel>
            </div>
            {activeProjectsList.length > 0 && (
              <ul className="divide-y divide-border rounded-md border border-border">
                {activeProjectsList.map(projectRow)}
              </ul>
            )}
            {inactiveProjectsList.length > 0 && (
              <div className="space-y-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowInactive((v) => !v)}
                  aria-expanded={showInactive}
                >
                  {showInactive
                    ? t.settings.hideInactiveProjects
                    : t.settings.showInactiveProjects(inactiveProjectsList.length)}
                </Button>
                {showInactive && (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {inactiveProjectsList.map(projectRow)}
                  </ul>
                )}
              </div>
            )}
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
                  onBlur={() => savePreferences({ cv_url_cs: cvCs })}
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
                  onBlur={() => savePreferences({ cv_url_en: cvEn })}
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
                            onToggle={() => {
                              const next = hidden.includes(it.value)
                                ? hidden.filter((value) => value !== it.value)
                                : [...hidden, it.value];
                              setHidden(next);
                              savePreferences({ hidden_navigation: next });
                            }}
                          />
                        ))}
                      </ul>
                    </SortableContext>
                  </DndContext>
                </div>
              );
            })}
            <Button variant="outline" size="sm" className="mt-4" onClick={() => {
              resetVisibility();
              resetOrder();
              savePreferences({ hidden_navigation: [], navigation_order: [] });
            }}><RotateCcw />{t.settings.resetNavigation}</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="inline-flex items-center gap-1.5"><Bot className="h-3 w-3" />{t.settings.ai}</CardTitle></CardHeader>
          <CardContent className="space-y-4"><p className="text-xs text-foreground-subtle">{t.settings.aiDesc}</p><div className="space-y-1 text-xs text-foreground-subtle"><p>{t.settings.aiModels}</p><p>{t.settings.aiDataCategories}</p><p>{t.settings.aiWrites}</p></div><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{t.settings.aiEnabled}</span><Switch aria-label={t.settings.aiEnabled} checked={aiPrefs.enabled} onCheckedChange={(enabled) => patchAiPrefs({ enabled })} /></div><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{t.settings.aiSensitive}</p><p className="mt-1 text-xs text-foreground-subtle">{t.settings.aiSensitiveDesc}</p></div><Switch aria-label={t.settings.aiSensitive} checked={aiPrefs.sensitive} disabled={!aiPrefs.enabled} onCheckedChange={(sensitive) => patchAiPrefs({ sensitive })} /></div></CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="inline-flex items-center gap-1.5"><Plug className="h-3 w-3" />{t.settings.integrations}</CardTitle></CardHeader>
          <CardContent className="space-y-3"><p className="text-xs text-foreground-subtle">{t.settings.integrationsDesc}</p>{[["Google", integrations?.google], ["GitHub", integrations?.github], [t.settings.bankSync, integrations?.bank], [t.settings.emailDelivery, integrations?.email]].map(([label, raw]) => { const state = raw as { connected?: boolean; configured: boolean; last_synced_at?: string | null } | undefined; const value = !state ? "pending" : state.connected === true ? "connected" : state.connected === false ? "not_connected" : state.configured ? "configured" : "not_configured"; const status = !state ? "…" : state.connected === true ? t.settings.connected : state.connected === false ? t.settings.notConnected : state.configured ? t.settings.configured : t.settings.notConfigured; return <div key={String(label)} className="flex items-center justify-between gap-3 rounded-md border border-border p-3"><div><p className="text-sm font-medium">{String(label)}</p>{state?.last_synced_at && <p className="mt-1 text-xs text-foreground-subtle">{t.settings.lastSync}: {state.last_synced_at.slice(0, 10)}</p>}</div><StatusBadge value={value} label={status} /></div>; })}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="inline-flex items-center gap-1.5"><Shield className="h-3 w-3" />{t.settings.dataExport}</CardTitle></CardHeader>
          <CardContent className="space-y-3"><p className="text-xs text-foreground-subtle">{t.settings.dataExportDesc}</p><div className="flex flex-wrap gap-2">{[["/api/export/full", t.settings.exportFull], ["/api/export/financial", t.settings.exportFinancial], ["/api/export/professional", t.settings.exportProfessional], ["/api/export/knowledge", t.settings.exportKnowledge], ["/api/export/projects", t.settings.exportProjects], ["/api/export/notes", t.settings.exportNotes], ["/api/export/prompts", t.settings.exportPrompts], ["/api/export/career", t.settings.exportCareer], ["/api/export/financial?format=csv&table=transactions", t.settings.exportTransactionsCsv], ["/api/export/legacy", t.settings.exportLegacy]].map(([href, label]) => <Button key={href} variant="outline" size="sm" asChild><a href={href} download><Download />{label}</a></Button>)}</div></CardContent>
        </Card>
      </div>
    </div>
  );
}

/** A labeled row in the merged Preferences card: icon + label (+ optional
 * description) on the left, the control on the right. */
function PrefRow({
  icon: Icon,
  label,
  desc,
  children,
}: {
  icon: typeof Sun;
  label: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <div className="min-w-0">
        <p className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Icon className="h-3.5 w-3.5 text-foreground-muted" />
          {label}
        </p>
        {desc && <p className="mt-0.5 text-xs text-foreground-subtle">{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
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
    setActivatorNodeRef,
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
          ref={setActivatorNodeRef}
          type="button"
          aria-label={dragLabel}
          className="shrink-0 cursor-grab touch-none select-none rounded text-foreground-subtle transition-colors hover:text-foreground focus-ring active:cursor-grabbing"
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
