"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDict } from "@/lib/i18n";
import { groupTips, isTip, type TipGroupKey } from "@/lib/ig-tips";
import type { LinkExportRelations } from "@/lib/link-export";
import {
  buildTipExport,
  shapeTipExport,
  tipExportMarkdown,
  type TipExportSelection,
  type TipExportShape,
} from "@/lib/tip-export";
import type { AiLink } from "@/lib/types";

/**
 * "Copy IG tips to JSON / Markdown": every tip, selected topics or selected
 * tips, grouped by topic. There is no price filter — tips carry no pricing —
 * and each item names its topic and card text as `tip_group` and
 * `tip_summary`, the shape a plan generator reads.
 */
export function TipExportDialog({ links, relations }: { links: AiLink[]; relations?: LinkExportRelations }) {
  const t = useDict();
  const a = t.ai;
  const tt = t.tips;
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("json");
  const [shape, setShape] = useState<TipExportShape>("detailed");
  const [selection, setSelection] = useState<TipExportSelection>("all");
  const [topics, setTopics] = useState<Set<TipGroupKey>>(() => new Set());
  const [itemIds, setItemIds] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState("");
  const tips = useMemo(() => links.filter(isTip), [links]);
  const available = useMemo(() => groupTips(tips), [tips]);
  const data = useMemo(
    () => buildTipExport(tips, { selection, topics: [...topics], itemIds: [...itemIds], relations }),
    [tips, selection, topics, itemIds, relations],
  );
  const content =
    format === "json" ? JSON.stringify(shapeTipExport(data, shape), null, 2) : tipExportMarkdown(data, (group) => tt.groupLabel[group]);

  function toggle<T>(setter: React.Dispatch<React.SetStateAction<Set<T>>>, id: T, checked: boolean) {
    setter((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
    setStatus("");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setStatus(a.exportCopied);
    } catch {
      setStatus(a.exportCopyFailed);
    }
  }

  function download() {
    const blob = new Blob([content], { type: format === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "ig-tips." + (format === "json" ? "json" : "md");
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" onClick={() => setStatus("")}>
          {a.exportIdeasTitle}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100%_-_2rem)] max-w-4xl" showClose={false}>
        <DialogHeader>
          <DialogTitle>{a.exportIdeasTitle}</DialogTitle>
          <DialogDescription>{tt.exportHint}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="tip-export-format">{a.exportFormat}</Label>
            <SimpleSelect
              id="tip-export-format"
              value={format}
              onValueChange={(value) => {
                setFormat(value);
                setStatus("");
              }}
              options={[
                { value: "json", label: "JSON" },
                { value: "markdown", label: "Markdown" },
              ]}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tip-export-selection">{a.exportSelection}</Label>
            <SimpleSelect
              id="tip-export-selection"
              value={selection}
              onValueChange={(value) => {
                setSelection(value as TipExportSelection);
                setStatus("");
              }}
              options={[
                { value: "all", label: tt.exportSelectionAll },
                { value: "topics", label: tt.exportSelectionTopics },
                { value: "items", label: a.exportSelectionIdeas },
              ]}
            />
          </div>
          {format === "json" && (
            <div className="space-y-1.5">
              <Label htmlFor="tip-export-shape">{a.exportShape}</Label>
              <SimpleSelect
                id="tip-export-shape"
                value={shape}
                onValueChange={(value) => {
                  setShape(value as TipExportShape);
                  setStatus("");
                }}
                options={[
                  { value: "detailed", label: a.exportShapeDetailed },
                  { value: "compact", label: a.exportShapeCompact },
                  { value: "grouped", label: tt.exportShapeGrouped },
                ]}
              />
            </div>
          )}
        </div>

        {selection === "topics" && (
          <fieldset className="mt-4 rounded-lg border border-border bg-surface-muted/30 p-3">
            <legend className="px-1 text-xs font-medium">{tt.exportChooseTopics}</legend>
            <div className="grid max-h-36 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {available.map((entry) => (
                <label key={entry.group} className="flex min-h-8 cursor-pointer items-center gap-2 rounded px-1 text-sm hover:bg-surface-hover">
                  <Checkbox checked={topics.has(entry.group)} onCheckedChange={(checked) => toggle(setTopics, entry.group, checked === true)} />
                  <span className="min-w-0 truncate">{tt.groupLabel[entry.group]}</span>
                  <span className="ml-auto text-xs tabular text-foreground-subtle">{entry.tips.length}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {selection === "items" && (
          <fieldset className="mt-4 rounded-lg border border-border bg-surface-muted/30 p-3">
            <legend className="px-1 text-xs font-medium">{a.exportChooseIdeas}</legend>
            <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
              {available.flatMap((entry) => entry.tips).map((tip) => (
                <label key={tip.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-surface-hover">
                  <Checkbox checked={itemIds.has(tip.id)} onCheckedChange={(checked) => toggle(setItemIds, tip.id, checked === true)} />
                  <span className="min-w-0 truncate">{tip.title}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <p className="my-3 text-xs text-foreground-muted" role="status">
          {a.exportCount(data.items.length)}
        </p>
        <Label htmlFor="tip-export-preview">{a.exportPreview}</Label>
        <Textarea id="tip-export-preview" value={content} readOnly rows={14} className="mt-1.5 max-h-[45vh] font-mono text-xs" />
        <p role="status" className="mt-2 text-xs text-foreground-muted">
          {status}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">{a.cancel}</Button>
          </DialogClose>
          <Button variant="outline" onClick={download} disabled={data.items.length === 0}>
            {a.exportDownload}
          </Button>
          <Button onClick={copy} disabled={data.items.length === 0}>
            {a.exportCopy}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
