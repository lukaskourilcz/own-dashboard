"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, Eye, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDict, useLang } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { useOwnerPreferences } from "@/lib/owner-preferences";
import { qk } from "@/lib/queries/keys";
import { loadProjectTraffic } from "@/lib/project-traffic-client";

const formats = { en: new Intl.NumberFormat("en-US"), cs: new Intl.NumberFormat("cs-CZ") };

/** A minimal visitors sparkline (inline SVG) over the last 30 days. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const w = 100;
  const h = 24;
  const step = w / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="mt-3 h-8 w-full text-primary"
      aria-hidden
    >
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-surface-inset px-3 py-2">
      <p className="inline-flex items-center gap-1.5 text-[11px] text-foreground-subtle">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="mt-0.5 break-all text-lg font-semibold tabular">{value}</p>
    </div>
  );
}

export function ProjectTraffic({
  repoFullName,
  repoId = null,
  enabled = true,
  preview = false,
}: {
  repoFullName: string;
  /** GitHub repository id; matches the Vercel project across renames. */
  repoId?: number | null;
  enabled?: boolean;
  preview?: boolean;
}) {
  const t = useDict(), p = t.professional, { lang } = useLang(), owner = useOwnerPreferences();
  const ownerId = owner?.ownerId ?? "unavailable";
  const active = enabled && !preview && !!owner && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId);
  const query = useQuery({
    queryKey: [...qk.projectTraffic, ownerId, repoFullName, repoId],
    queryFn: ({ signal }) => {
      if (!owner) throw new Error("Traffic unavailable");
      const captured = owner.capture();
      return loadProjectTraffic(captured.ownerId, repoFullName, repoId, AbortSignal.any([signal, captured.signal]));
    },
    enabled: active, retry: false, staleTime: 5 * 60_000,
  });
  const data = query.data, nf = formats[lang];
  if (!active || data?.kind === "unconfigured") return null;
  const retry = () => { void query.refetch({ cancelRefetch: false }); };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          {p.projectTraffic}
        </CardTitle>
        <p className="mt-1 text-xs text-foreground-subtle">{p.trafficDescription}</p>
      </CardHeader>
      <CardContent>
        {query.isError && data && <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 text-sm text-risk"><p>{p.trafficError}</p><Button variant="outline" disabled={query.isFetching} onClick={retry}>{t.common.retry}</Button></div>}
        {query.isPending ? (
          <p className="text-sm text-foreground-muted">{p.trafficLoading}</p>
        ) : !data ? (
          <div role="alert" className="space-y-2"><p className="text-sm text-foreground-muted">{p.trafficError}</p><Button variant="outline" disabled={query.isFetching} onClick={retry}>{t.common.retry}</Button></div>
        ) : data.kind === "not-found" ? (
          <p className="text-sm text-foreground-muted">{p.trafficNotFound}</p>
        ) : (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              {p.trafficLast30}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Metric icon={Users} label={p.trafficVisitors} value={nf.format(data.last30.visitors)} />
              <Metric icon={Eye} label={p.trafficPageviews} value={nf.format(data.last30.pageviews)} />
            </div>
            <Sparkline values={data.daily.map((d) => d.visitors)} />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border pt-2 text-xs text-foreground-muted">
              <span>{p.trafficLifetime}</span>
              <span className="min-w-0 break-words tabular">
                {nf.format(data.lifetime.visitors)} {p.trafficVisitors.toLowerCase()} ·{" "}
                {nf.format(data.lifetime.pageviews)} {p.trafficPageviews.toLowerCase()}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
