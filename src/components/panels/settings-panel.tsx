"use client";

import {
  Coins,
  FileText,
  Languages,
  ListTodo,
  Moon,
  PanelLeft,
  Palette,
  Sun,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { useDict, useLang } from "@/lib/i18n";
import {
  useCvLinks,
  useDisplayCurrency,
  useNavVisibility,
  useTasksPerCategory,
  TASKS_PER_CATEGORY_OPTIONS,
} from "@/lib/use-prefs";
import { useTheme } from "@/lib/use-theme";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { NAV_ITEMS } from "@/components/nav/sidebar";
import { cn } from "@/lib/utils";

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

export function SettingsPanel() {
  const t = useDict();
  const { lang, setLang } = useLang();
  const { currency, setCurrency } = useDisplayCurrency();
  const { isHidden, toggle } = useNavVisibility();
  const { theme, setTheme } = useTheme();
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
            <ul className="-mx-2 divide-y divide-border">
              {NAV_ITEMS.map((it) => {
                const locked = it.value === "overview";
                const visible = !isHidden(it.value);
                return (
                  <li
                    key={it.value}
                    className="flex items-center justify-between gap-3 px-2 py-2.5"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <it.icon className="h-4 w-4 shrink-0 text-foreground-muted" />
                      <span className="text-sm font-medium truncate">
                        {t.nav.sections[it.value]}
                      </span>
                    </div>
                    {locked ? (
                      <SectionLabel className="shrink-0">
                        {t.settings.alwaysVisible}
                      </SectionLabel>
                    ) : (
                      <Switch
                        checked={visible}
                        onCheckedChange={() => toggle(it.value)}
                        aria-label={t.nav.sections[it.value]}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
