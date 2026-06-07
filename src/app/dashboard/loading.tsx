import { Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

function PanelSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 shadow-soft space-y-3">
      <Skeleton className="h-3 w-24" />
      <div className="space-y-2 pt-1">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </div>
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-background">
      {/* sidebar skeleton */}
      <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:border-border md:bg-surface md:fixed md:inset-y-0 md:left-0">
        <div className="flex h-14 items-center gap-2.5 px-4 border-b border-border">
          <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
            <Activity className="h-3.5 w-3.5" />
          </div>
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="flex-1 p-2 space-y-1">
          {Array.from({ length: 9 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      </aside>

      <main className="md:pl-60">
        <div className="mx-auto max-w-6xl px-4 md:px-8 py-6 md:py-8 space-y-6">
          {/* hero */}
          <div className="rounded-xl border border-border bg-surface p-6 md:p-8 shadow-soft space-y-5">
            <div className="flex items-baseline justify-between">
              <div className="space-y-2">
                <Skeleton className="h-7 w-64" />
                <Skeleton className="h-3 w-48" />
              </div>
              <Skeleton className="h-7 w-32 rounded-full" />
            </div>
            <div className="grid gap-6 md:grid-cols-3 pt-4 border-t border-border">
              <div className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
              </div>
            </div>
          </div>
          {/* quick add */}
          <Skeleton className="h-10 w-full rounded-md" />
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-surface p-4 shadow-soft space-y-2"
              >
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <PanelSkeleton />
            <PanelSkeleton />
            <PanelSkeleton />
            <PanelSkeleton />
          </div>
        </div>
      </main>
    </div>
  );
}
