"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, Eye, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDict } from "@/lib/i18n";

type TrafficResponse =
  | { kind: "unconfigured" }
  | { kind: "not-found" }
  | { kind: "error" }
  | {
      kind: "ok";
      projectId: string;
      lifetime: { pageviews: number; visitors: number };
      last30: { pageviews: number; visitors: number };
      daily: { date: string; pageviews: number; visitors: number }[];
    };

async function loadTraffic(repo: string): Promise<TrafficResponse> {
  const res = await fetch(`/api/vercel/analytics?repo=${encodeURIComponent(repo)}`, {
    cache: "no-store",
  });
  if (!res.ok) return { kind: "error" };
  return (await res.json()) as TrafficResponse;
}

const nf = new Intl.NumberFormat();

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

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <div className="rounded-md border border-border bg-surface-inset px-3 py-2">
      <p className="inline-flex items-center gap-1.5 text-[11px] text-foreground-subtle">
        <Icon className="h-3 w-3" />
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular">{nf.format(value)}</p>
    </div>
  );
}

export function ProjectTraffic({
  repoFullName,
  enabled = true,
}: {
  repoFullName: string;
  enabled?: boolean;
}) {
  const p = useDict().professional;
  const query = useQuery({
    queryKey: ["vercel", "traffic", repoFullName],
    queryFn: () => loadTraffic(repoFullName),
    enabled,
    staleTime: 5 * 60_000,
  });
  const data = query.data;

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
        {query.isPending ? (
          <p className="text-sm text-foreground-muted">{p.trafficLoading}</p>
        ) : !data || data.kind === "error" ? (
          <p className="text-sm text-foreground-muted">{p.trafficError}</p>
        ) : data.kind === "unconfigured" ? (
          <p className="text-sm text-foreground-muted">{p.trafficUnconfigured}</p>
        ) : data.kind === "not-found" ? (
          <p className="text-sm text-foreground-muted">{p.trafficNotFound}</p>
        ) : (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">
              {p.trafficLast30}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Metric icon={Users} label={p.trafficVisitors} value={data.last30.visitors} />
              <Metric icon={Eye} label={p.trafficPageviews} value={data.last30.pageviews} />
            </div>
            <Sparkline values={data.daily.map((d) => d.visitors)} />
            <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs text-foreground-muted">
              <span>{p.trafficLifetime}</span>
              <span className="tabular">
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
