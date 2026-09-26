"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDict } from "@/lib/i18n";
import {
  buildLinkExport,
  linkExportMarkdown,
  shapeLinkExport,
  UNCATEGORIZED_EXPORT,
  type LinkExportRelations,
  type LinkExportScope,
  type LinkExportSelection,
  type LinkExportShape,
  type LinkPricingFilter,
} from "@/lib/link-export";
import type { AiCategory, AiLink } from "@/lib/types";

export function LinkExportDialog({ links, categories, scope, relations }: { links: AiLink[]; categories: AiCategory[]; scope: Exclude<LinkExportScope, "all">; relations?: LinkExportRelations }) {
  const t = useDict().ai;
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("json");
  const [shape, setShape] = useState<LinkExportShape>("detailed");
  const [pricing, setPricing] = useState<LinkPricingFilter>("all");
  const [selection, setSelection] = useState<LinkExportSelection>("all");
  const [categoryIds, setCategoryIds] = useState<Set<string>>(() => new Set());
  const [itemIds, setItemIds] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState("");
  const scopedLinks = useMemo(() => links.filter((link) => (link.record_type ?? "link") === scope), [links, scope]);
  const availableCategories = useMemo(() => {
    const used = new Set(scopedLinks.map((link) => link.category_id ?? UNCATEGORIZED_EXPORT));
    return [
      ...categories.filter((category) => used.has(category.id)).map((category) => ({ id: category.id, name: category.name })),
      ...(used.has(UNCATEGORIZED_EXPORT) ? [{ id: UNCATEGORIZED_EXPORT, name: t.uncategorized }] : []),
    ];
  }, [categories, scopedLinks, t.uncategorized]);
  const data = useMemo(() => buildLinkExport(links, categories, pricing, "", {
    scope,
    selection,
    categoryIds: [...categoryIds],
    itemIds: [...itemIds],
    relations,
  }), [links, categories, pricing, scope, selection, categoryIds, itemIds, relations]);
  const content = format === "json" ? JSON.stringify(shapeLinkExport(data, shape), null, 2) : linkExportMarkdown(data);
  const triggerLabel = scope === "idea" ? t.exportIdeasTitle : t.exportLinksTitle;

  function toggle(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string, checked: boolean) {
    setter((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
    setStatus("");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setStatus(t.exportCopied);
    } catch {
      setStatus(t.exportCopyFailed);
    }
  }

  function download() {
    const blob = new Blob([content], { type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = (scope === "idea" ? "ig-tips" : "links") + "." + (format === "json" ? "json" : "md");
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm" onClick={() => setStatus("")}>{triggerLabel}</Button></DialogTrigger>
      <DialogContent className="w-[calc(100%_-_2rem)] max-w-4xl" showClose={false}>
        <DialogHeader>
          <DialogTitle>{triggerLabel}</DialogTitle>
          <DialogDescription>{t.exportHint}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5"><Label htmlFor="link-export-format">{t.exportFormat}</Label>
            <SimpleSelect id="link-export-format" value={format} onValueChange={(value) => { setFormat(value); setStatus(""); }} options={[{ value: "json", label: "JSON" }, { value: "markdown", label: "Markdown" }]} />
          </div>
          <div className="space-y-1.5"><Label htmlFor={`link-export-selection-${scope}`}>{t.exportSelection}</Label>
            <SimpleSelect id={`link-export-selection-${scope}`} value={selection} onValueChange={(value) => { setSelection(value as LinkExportSelection); setStatus(""); }} options={[{ value: "all", label: t.exportSelectionAll }, { value: "categories", label: t.exportSelectionCategories }, { value: "items", label: scope === "idea" ? t.exportSelectionIdeas : t.exportSelectionLinks }]} />
          </div>
          <div className="space-y-1.5"><Label htmlFor="link-export-pricing">{t.pricing}</Label>
            <SimpleSelect id="link-export-pricing" value={pricing} onValueChange={(value) => { setPricing(value as LinkPricingFilter); setStatus(""); }} options={[{ value: "all", label: t.exportAll }, { value: "free", label: t.exportFree }, { value: "freemium", label: t.exportFreemium }, { value: "freemium-only", label: t.exportFreemiumOnly }, { value: "paid", label: t.exportPaid }, { value: "unknown", label: t.exportUnknown }]} />
          </div>
          {format === "json" && <div className="space-y-1.5"><Label htmlFor={`link-export-shape-${scope}`}>{t.exportShape}</Label>
            <SimpleSelect id={`link-export-shape-${scope}`} value={shape} onValueChange={(value) => { setShape(value as LinkExportShape); setStatus(""); }} options={[{ value: "detailed", label: t.exportShapeDetailed }, { value: "compact", label: t.exportShapeCompact }, { value: "grouped", label: t.exportShapeGrouped }]} />
          </div>}
        </div>

        {selection === "categories" && <fieldset className="mt-4 rounded-lg border border-border bg-surface-muted/30 p-3">
          <legend className="px-1 text-xs font-medium">{t.exportChooseCategories}</legend>
          <div className="grid max-h-36 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {availableCategories.map((category) => <label key={category.id} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1 text-sm hover:bg-surface-hover">
              <Checkbox checked={categoryIds.has(category.id)} onCheckedChange={(checked) => toggle(setCategoryIds, category.id, checked === true)} />
              <span className="min-w-0 truncate">{category.name}</span>
              <span className="ml-auto text-xs tabular text-foreground-subtle">{scopedLinks.filter((link) => (link.category_id ?? UNCATEGORIZED_EXPORT) === category.id).length}</span>
            </label>)}
          </div>
        </fieldset>}

        {selection === "items" && <fieldset className="mt-4 rounded-lg border border-border bg-surface-muted/30 p-3">
          <legend className="px-1 text-xs font-medium">{scope === "idea" ? t.exportChooseIdeas : t.exportChooseLinks}</legend>
          <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
            {scopedLinks.map((link) => <label key={link.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-hover">
              <Checkbox checked={itemIds.has(link.id)} onCheckedChange={(checked) => toggle(setItemIds, link.id, checked === true)} />
              <span className="min-w-0 truncate">{link.title}</span>
            </label>)}
          </div>
        </fieldset>}

        <p className="my-3 text-xs text-foreground-muted" role="status">{t.exportCount(data.items.length)}</p>
        <Label htmlFor="link-export-preview">{t.exportPreview}</Label>
        <Textarea id="link-export-preview" value={content} readOnly rows={14} className="mt-1.5 max-h-[45vh] font-mono text-xs" />
        <p role="status" className="mt-2 text-xs text-foreground-muted">{status}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <DialogClose asChild><Button variant="ghost">{t.cancel}</Button></DialogClose>
          <Button variant="outline" onClick={download} disabled={data.items.length === 0}>{t.exportDownload}</Button>
          <Button onClick={copy} disabled={data.items.length === 0}>{t.exportCopy}</Button>
        </div>
      </DialogContent>
    </Dialog>;
}
