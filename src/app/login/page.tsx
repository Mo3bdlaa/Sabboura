"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/AppProvider";
import { Logo } from "@/components/Logo";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup" | "magic";

export default function LoginPage() {
  const { backend, user } = useApp();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (user) router.replace("/");
  }, [user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "signin") {
        await backend.signInWithPassword(email, password);
      } else if (mode === "signup") {
        const { needsConfirmation } = await backend.signUp(email, password);
        if (needsConfirmation) setNotice("Check your inbox to confirm your email, then come back here.");
      } else {
        await backend.sendMagicLink(email);
        setNotice("Magic link sent. Open it on this device to sign in.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo size={44} />
          <h1 className="text-2xl font-semibold tracking-tight">Sabboura</h1>
          <p className="text-sm text-muted">Your drive of live whiteboards.</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-soft">
          <div className="mb-5 grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1 text-sm">
            {(
              [
                ["signin", "Sign in"],
                ["signup", "Sign up"],
                ["magic", "Magic link"],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setMode(m);
                  setError(null);
                  setNotice(null);
                }}
                className={cn(
                  "rounded-md py-1.5 font-medium transition",
                  mode === m ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-accent"
              />
            </label>
            {mode !== "magic" && (
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Password</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-lg border border-line bg-bg px-3 py-2 outline-none focus:border-accent"
                />
              </label>
            )}

            {error && <p className="text-sm text-danger">{error}</p>}
            {notice && <p className="text-sm text-accent">{notice}</p>}

            <button
              type="submit"
              disabled={busy}
              className="mt-1 rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-ink transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Email me a link"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
