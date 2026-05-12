import { LayoutDashboard } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function PanelSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-32" />
      </CardHeader>
      <CardContent className="space-y-2">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-3 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 flex items-center justify-center">
              <LayoutDashboard className="h-4 w-4" />
            </div>
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 space-y-4">
        <Skeleton className="h-9 w-full" />
        <Card>
          <CardContent className="pt-6 space-y-3">
            <Skeleton className="h-4 w-72" />
            <div className="grid gap-3 md:grid-cols-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          </CardContent>
        </Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <PanelSkeleton lines={2} />
          <PanelSkeleton lines={2} />
          <PanelSkeleton lines={2} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <PanelSkeleton />
          <PanelSkeleton />
          <PanelSkeleton />
          <PanelSkeleton />
        </div>
      </main>
    </div>
  );
}
