"use client";

import { useState } from "react";
import { motion, MotionConfig } from "motion/react";
import { Activity, ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { MeshGradient } from "@/components/ui/mesh-gradient";
import { brandConfig } from "@/lib/brand";
import { useDict } from "@/lib/i18n";

export default function LoginPage() {
  const t = useDict();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithGoogle() {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes:
          "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        queryParams: {
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
        },
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <MotionConfig reducedMotion="user">
    <div className="min-h-screen grid place-items-center bg-background px-4 relative overflow-hidden">
      {/* ambient mesh gradient */}
      <MeshGradient />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-sm"
      >
        <div className="text-center mb-8">
          <div className="mx-auto h-10 w-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center mb-4 shadow-card">
            <Activity className="h-4 w-4" />
          </div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-foreground-subtle">
            {brandConfig.name}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t.login.welcomeBack}
          </h1>
          <p className="mt-2 text-sm text-foreground-muted">
            {t.login.tagline}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-6 shadow-card space-y-4">
          <Button
            onClick={signInWithGoogle}
            disabled={loading}
            size="lg"
            className="w-full"
          >
            <GoogleIcon />
            {loading ? t.common.redirecting : t.login.continueWithGoogle}
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          {error && (
            <p className="text-xs text-destructive text-center">{error}</p>
          )}
          <p className="text-[11px] text-foreground-subtle text-center leading-relaxed">
            {t.login.calendarNotice}
          </p>
        </div>
      </motion.div>
    </div>
    </MotionConfig>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A10.99 10.99 0 0 0 12 23z"
      />
      <path
        fill="#FBBC04"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.99 10.99 0 0 0 1 12c0 1.77.42 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}
