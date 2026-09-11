"use client";

import { useState } from "react";
import { ChevronDown, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { useDict } from "@/lib/i18n";
import { resourceKey } from "@/lib/link-library";
import type { AiLink, AiPricing } from "@/lib/types";

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function LinkAvatar({ url, title }: { url: string; title: string }) {
  const [failed, setFailed] = useState(false);
  const host = resourceKey(url) ? hostOf(url) : null;
  return host && !failed ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`} alt="" width={24} height={24} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-6 w-6 shrink-0 rounded-md bg-surface-muted object-contain p-0.5" />
  ) : <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-xs font-semibold text-foreground-muted">{title.charAt(0).toUpperCase()}</span>;
}

export function PricingDot({ pricing }: { pricing: AiPricing | null }) {
  const t = useDict();
  const label = pricing ? t.ai.pricingLabel[pricing] : t.ai.pricingUnknown;
  const color = { free: "bg-[var(--mac-green)]", freemium: "bg-[var(--mac-yellow)]", paid: "bg-[var(--mac-red)]" };
  return <span role="img" aria-label={label} title={label} className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-foreground/30 ${pricing ? color[pricing] : "bg-transparent"}`} />;
}

export function LinkLibraryCard({ link, expanded, onToggle, onEdit, onDelete }: {
  link: AiLink; expanded: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const t = useDict();
  const safeUrl = resourceKey(link.url) ? link.url : undefined;
  return <article className="min-w-0" data-link-card={link.id}>
    <div className="flex items-center gap-1 px-3 py-2 transition-colors hover:bg-surface-hover/50">
      <div className="min-w-0 flex-1">
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={`link-details-${link.id}`} aria-label={`${expanded ? t.ai.collapseDetails : t.ai.expandDetails}: ${link.title}`} className="focus-ring flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md text-left sm:min-h-8" title={link.title}>
          <LinkAvatar key={link.url} url={link.url} title={link.title} />
          <span className="min-w-0 truncate text-sm font-medium">{link.title}</span>
          <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-foreground-muted transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />
        </button>
        <a href={safeUrl} target="_blank" rel="noreferrer" aria-label={`${t.ai.visit}: ${link.title}`} title={link.url} className="focus-ring ml-8 flex min-h-7 min-w-0 items-center gap-1 rounded text-xs text-foreground-muted hover:text-foreground hover:underline sm:min-h-5"><span className="truncate">{hostOf(link.url)}</span><ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" /></a>
      </div>
      <PricingDot pricing={link.pricing} />
      <div className="flex shrink-0">
        <Tooltip content={t.ai.edit}><button type="button" onClick={onEdit} aria-label={`${t.ai.edit}: ${link.title}`} className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-foreground sm:h-8 sm:w-8"><Pencil aria-hidden="true" className="h-3.5 w-3.5" /></button></Tooltip>
        <Tooltip content={t.ai.deleteLink}><button type="button" onClick={onDelete} aria-label={`${t.ai.deleteLink}: ${link.title}`} className="focus-ring inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-destructive sm:h-8 sm:w-8"><Trash2 aria-hidden="true" className="h-3.5 w-3.5" /></button></Tooltip>
      </div>
    </div>
    <div id={`link-details-${link.id}`} hidden={!expanded} className="space-y-2 border-t border-border/60 bg-surface-muted/30 px-3 py-3 text-xs text-foreground-muted">
      <p className="flex items-center gap-2"><PricingDot pricing={link.pricing} />{link.pricing ? t.ai.pricingLabel[link.pricing] : t.ai.pricingUnknown}</p>
      <p className="whitespace-pre-line [overflow-wrap:anywhere]">{(link.description || t.ai.noDescription).split(/(https?:\/\/[^\s]+)/g).map((part,index) => /^https?:\/\//.test(part) && resourceKey(part) ? <a key={index} href={part} target="_blank" rel="noreferrer" className="focus-ring rounded underline">{part}</a> : part)}</p>
      <a href={safeUrl} target="_blank" rel="noreferrer" className="focus-ring inline-flex min-h-11 max-w-full items-center gap-1 rounded text-foreground underline [overflow-wrap:anywhere] sm:min-h-8">{link.url}<ExternalLink aria-hidden="true" className="h-3 w-3 shrink-0" /></a>
    </div>
  </article>;
}
