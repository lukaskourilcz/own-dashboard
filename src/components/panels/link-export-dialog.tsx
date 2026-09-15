"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useDict } from "@/lib/i18n";
import { buildLinkExport, linkExportMarkdown, type LinkPricingFilter } from "@/lib/link-export";
import type { AiCategory, AiLink } from "@/lib/types";

export function LinkExportDialog({ links, categories }: { links: AiLink[]; categories: AiCategory[] }) {
  const t = useDict().ai;
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("json");
  const [pricing, setPricing] = useState<LinkPricingFilter>("all");
  const [status, setStatus] = useState("");
  const data = useMemo(() => buildLinkExport(links, categories, pricing), [links, categories, pricing]);
  const content = format === "json" ? JSON.stringify(data, null, 2) : linkExportMarkdown(data);

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
    anchor.download = "links-and-ideas." + (format === "json" ? "json" : "md");
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm" onClick={() => setStatus("")}>{t.exportTitle}</Button></DialogTrigger>
      <DialogContent className="max-w-3xl w-[calc(100%_-_2rem)]" showClose={false}>
        <DialogHeader>
          <DialogTitle>{t.exportTitle}</DialogTitle>
          <DialogDescription>{t.exportHint}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="link-export-format">{t.exportFormat}</Label>
            <SimpleSelect id="link-export-format" value={format} onValueChange={(value) => { setFormat(value); setStatus(""); }} options={[{ value: "json", label: "JSON" }, { value: "markdown", label: "Markdown" }]} />
          </div>
          <div className="space-y-1.5"><Label htmlFor="link-export-pricing">{t.pricing}</Label>
            <SimpleSelect id="link-export-pricing" value={pricing} onValueChange={(value) => { setPricing(value as LinkPricingFilter); setStatus(""); }} options={[{ value: "free", label: t.exportFree }, { value: "freemium", label: t.exportFreemium }, { value: "all", label: t.exportAll }]} />
          </div>
        </div>
        <p className="my-3 text-xs text-foreground-muted" role="status">{t.exportCount(data.items.length)}</p>
        <Label htmlFor="link-export-preview">{t.exportPreview}</Label>
        <Textarea id="link-export-preview" value={content} readOnly rows={14} className="mt-1.5 max-h-[45vh] font-mono text-xs" />
        <p role="status" className="mt-2 text-xs text-foreground-muted">{status}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <DialogClose asChild><Button variant="ghost">{t.cancel}</Button></DialogClose>
          <Button variant="outline" onClick={download}>{t.exportDownload}</Button>
          <Button onClick={copy}>{t.exportCopy}</Button>
        </div>
      </DialogContent>
    </Dialog>;
}
