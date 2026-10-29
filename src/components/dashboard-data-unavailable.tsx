"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { common } from "@/lib/i18n/sections/common";

/** A failed initial read must not mount editable panels with empty records. */
export function DashboardDataUnavailable({ lang }: { lang: "en" | "cs" }) {
  const t = common[lang];
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-3 px-5 py-10">
      <h1 className="text-lg font-semibold">{t.dataUnavailable}</h1>
      <p role="alert" className="text-sm text-foreground-muted">{t.dataUnavailableDescription}</p>
      <Button className="self-start" disabled={pending} onClick={() => startTransition(() => router.refresh())}>
        {pending ? t.loading : t.retry}
      </Button>
    </main>
  );
}
