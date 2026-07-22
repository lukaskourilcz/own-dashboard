"use client";

import Link from "next/link";
import { Home, LogIn } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { brandConfig } from "@/lib/brand";
import { useDict } from "@/lib/i18n";

/**
 * Rendered for any unmatched URL — including typos like `/dshboard`, where the
 * root catch-all calls `notFound()`. Instead of a bare 404 we explain the
 * address is wrong and offer the two ways forward: sign in, or go to the
 * homepage. It renders inside the root layout, so `useDict` (language) and the
 * theme bootstrap both apply.
 */
export default function NotFound() {
  const t = useDict();

  return (
    <main className="operational-grid flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <BrandMark className="mx-auto mb-5 h-12 w-12" />
        <p className="flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-widest text-foreground-subtle">
          <span>{brandConfig.name}</span>
          <span aria-hidden>·</span>
          <span>404</span>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {t.app.notFoundTitle}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-foreground-muted">
          {t.app.notFoundBody}
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Button asChild className="w-full sm:w-auto">
            <Link href="/">
              <Home className="h-4 w-4" />
              {t.app.notFoundHome}
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <Link href="/login">
              <LogIn className="h-4 w-4" />
              {t.app.notFoundLogin}
            </Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
