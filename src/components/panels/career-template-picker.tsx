"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CareerPagination } from "@/components/panels/career-pagination";
import { collectionPage } from "@/lib/collection-page";
import { BUILTIN_TEMPLATES } from "@/lib/jobs/template";
import type { LetterLanguage } from "@/lib/jobs/letter-helper";
import { useDict, useLang } from "@/lib/i18n";
import type { CoverLetterTemplate } from "@/lib/types";

const fold = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/** Mounted only while open. The complete library stays in its existing owner cache. */
export function CareerTemplatePicker({ id, templates, language, onSelect, onClose }: {
  id: string;
  templates: CoverLetterTemplate[];
  language: LetterLanguage;
  onSelect: (body: string) => boolean;
  onClose: () => void;
}) {
  const t = useDict();
  const { lang } = useLang();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [pageIndex, setPageIndex] = useState(0);
  const normalizedQuery = fold(query.trim());
  const source = useMemo(() => templates.map(row => {
    const name = row.name.trim() || t.jobs.untitledTemplate;
    return {
      id: row.id, name, key: fold(name), body: row.body,
      preview: row.body.slice(0, 180).replace(/\s+/g, " ").slice(0, 90),
      empty: !row.body.trim(),
    };
  }), [templates, t.jobs.untitledTemplate]);
  const filtered = useMemo(
    () => normalizedQuery ? source.filter(row => row.key.includes(normalizedQuery)) : source,
    [source, normalizedQuery],
  );
  const page = collectionPage(filtered, pageIndex);
  const builtins = BUILTIN_TEMPLATES.filter(row => fold(row.name[lang]).includes(normalizedQuery));

  function choose(body: string) {
    if (onSelect(body)) onClose();
  }

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent id={id} className="flex max-w-xl flex-col gap-3 overflow-hidden">
      <div className="shrink-0 space-y-1 pr-8">
        <DialogTitle>{t.jobs.loadTemplate}</DialogTitle>
        <DialogDescription>{t.jobs.templatesDescription}</DialogDescription>
      </div>
      <div className="shrink-0">
        <Label className="sr-only" htmlFor={searchId}>{t.jobs.templateSearch}</Label>
        <Input id={searchId} type="search" value={query} placeholder={t.jobs.templateSearch}
          onChange={event => { setQuery(event.target.value); setPageIndex(0); }} />
      </div>
      <div className="min-h-0 max-h-[55dvh] flex-1 overflow-y-auto overscroll-contain rounded-md border border-border">
        {builtins.length > 0 && <section aria-label={t.jobs.builtinTemplatesGroup}>
          <h3 className="px-3 py-2 text-xs font-medium text-foreground-muted">{t.jobs.builtinTemplatesGroup}</h3>
          <ul className="divide-y divide-border">
            {builtins.map(row => <li key={row.id}>
              <Button data-career-template-choice type="button" variant="ghost"
                className="h-auto min-h-11 md:h-auto w-full justify-start whitespace-normal rounded-none px-3 py-2 text-left"
                onClick={() => choose(row.body[language])}>{row.name[lang]}</Button>
            </li>)}
          </ul>
        </section>}
        {page.items.length > 0 && <section aria-label={t.jobs.savedTemplatesGroup}>
          <h3 className="px-3 py-2 text-xs font-medium text-foreground-muted">{t.jobs.savedTemplatesGroup}</h3>
          <ul className="divide-y divide-border">
            {page.items.map(row => <li key={row.id}>
              <Button data-career-template-choice data-career-template-id={row.id} type="button"
                variant="ghost" disabled={row.empty}
                className="h-auto min-h-11 md:h-auto w-full flex-col items-start gap-1 whitespace-normal rounded-none px-3 py-2 text-left"
                onClick={() => choose(row.body)}>
                <span className="w-full break-words [overflow-wrap:anywhere]">{row.name}</span>
                <span className="w-full truncate text-xs text-foreground-muted">
                  {row.empty ? t.jobs.emptyTemplate : row.preview}
                </span>
              </Button>
            </li>)}
          </ul>
        </section>}
        {!builtins.length && !page.total && <p role="status" className="px-3 py-6 text-center text-sm text-foreground-muted">
          {t.jobs.noMatchingTemplates}
        </p>}
      </div>
      <div className="shrink-0">
        <CareerPagination page={page} onPage={setPageIndex} label={t.jobs.savedTemplatesGroup} />
      </div>
    </DialogContent>
  </Dialog>;
}
