"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutDashboard } from "lucide-react";

export default function LoginPage() {
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
        },
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto h-12 w-12 rounded-xl bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900 flex items-center justify-center">
            <LayoutDashboard className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">Your Personal Dashboard</CardTitle>
          <CardDescription>
            Track subscriptions, todos, streaks, and your calendar in one place.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button onClick={signInWithGoogle} disabled={loading} size="lg">
            {loading ? "Redirecting…" : "Sign in with Google"}
          </Button>
          {error && (
            <p className="text-sm text-red-600 text-center">{error}</p>
          )}
          <p className="text-xs text-zinc-500 dark:text-zinc-400 text-center">
            We request access to your Google Calendar to create events from the dashboard.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
