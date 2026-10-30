import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/operator/login")({
  validateSearch: (search: Record<string, unknown>): { mode?: string | undefined } => {
    return {
      mode: typeof search["mode"] === "string" ? search["mode"] : undefined,
    };
  },
  head: () => ({
    meta: [
      { title: "Operator Sign In — Q" },
      { name: "description", content: "Authenticate to manage your desk on Q Virtual Queuing Engine." },
      { property: "og:title", content: "Operator Sign In — Q" },
      { property: "og:description", content: "Authenticate to manage your desk on Q Virtual Queuing Engine." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const searchParams = Route.useSearch();
  const [mode, setMode] = useState<"in" | "up">(searchParams.mode === "signup" ? "up" : "in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (searchParams.mode === "signup") {
      setMode("up");
    }
  }, [searchParams.mode]);

  async function fulfillPendingQueue() {
    const raw = sessionStorage.getItem("q_pending_queue");
    if (!raw) {
      navigate({ to: "/operator/dashboard" });
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("create_queue_with_operators", {
        p_title: parsed.title,
        p_operator_emails: parsed.emails || [],
      });
      sessionStorage.removeItem("q_pending_queue");
      if (error) console.error("Error creating pending queue:", error);
    } catch (e) {
      console.error(e);
    }
    navigate({ to: "/operator/dashboard" });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);

    const redirectUrl = "https://queue-engine.vercel.app/operator/dashboard";

    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) return setMsg({ ok: false, text: error.message });
      await fulfillPendingQueue();
    } else {
      if (!fullName.trim()) {
        setBusy(false);
        return setMsg({ ok: false, text: "Please enter your full name." });
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName.trim(),
          },
          emailRedirectTo: redirectUrl,
        },
      });
      setBusy(false);
      if (error) return setMsg({ ok: false, text: error.message });
      if (data.session) {
        await fulfillPendingQueue();
        return;
      }
      setMsg({ ok: true, text: "Check your email to confirm your account, then sign in." });
    }
  }

  const field =
    "mt-1.5 h-12 w-full border border-[#E8E5DF] bg-[#FBF9F5] px-4 font-mono text-sm text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#111111]";

  return (
    <main className="min-h-screen bg-[#FBF9F5] text-[#111111] flex flex-col justify-between">
      {/* Mini Header */}
      <header className="border-b border-[#E8E5DF] px-6 py-4 md:px-12 bg-[#FBF9F5]">
        <Link to="/" className="inline-flex items-center gap-3">
          <span className="font-mono text-2xl font-black tracking-tighter text-[#111111]">Q</span>
          <div className="h-4 w-px bg-[#E8E5DF]" />
          <span className="font-mono text-xs uppercase tracking-wider text-[#666666]">
            Virtual Queue Engine
          </span>
        </Link>
      </header>

      {/* Main Auth Card */}
      <div className="mx-auto w-full max-w-md px-6 py-12">
        <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-8 md:p-10 shadow-sm">
          {/* Mode Switcher Tabs */}
          <div className="grid grid-cols-2 border-b border-[#E8E5DF] pb-4 mb-6">
            <button
              type="button"
              onClick={() => {
                setMode("in");
                setMsg(null);
              }}
              className={`font-mono text-xs font-bold uppercase pb-2 border-b-2 transition-colors ${
                mode === "in"
                  ? "border-[#111111] text-[#111111]"
                  : "border-transparent text-[#666666] hover:text-[#111111]"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("up");
                setMsg(null);
              }}
              className={`font-mono text-xs font-bold uppercase pb-2 border-b-2 transition-colors ${
                mode === "up"
                  ? "border-[#111111] text-[#111111]"
                  : "border-transparent text-[#666666] hover:text-[#111111]"
              }`}
            >
              Create Account
            </button>
          </div>

          <span className="font-mono text-xs font-bold uppercase tracking-widest text-[#666666]">
            Desk Operator Authentication
          </span>
          <h1 className="mt-1 font-mono text-2xl font-bold tracking-tight text-[#111111]">
            {mode === "in" ? "Sign in to console" : "Create operator profile"}
          </h1>

          <form onSubmit={submit} className="mt-6 space-y-4">
            {mode === "up" && (
              <div>
                <label className="block font-mono text-xs font-semibold uppercase text-[#111111]" htmlFor="fullName">
                  Full Name <span className="text-[#E5484D]">*</span>
                </label>
                <input
                  id="fullName"
                  name="fullName"
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. Funke Adebayo"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className={field}
                />
              </div>
            )}

            <div>
              <label className="block font-mono text-xs font-semibold uppercase text-[#111111]" htmlFor="email">
                Email Address <span className="text-[#E5484D]">*</span>
              </label>
              <input
                id="email"
                type="email"
                required
                autoFocus={mode === "in"}
                placeholder="name@organization.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={field}
              />
            </div>

            <div>
              <label className="block font-mono text-xs font-semibold uppercase text-[#111111]" htmlFor="password">
                Password <span className="text-[#E5484D]">*</span>
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={field}
              />
            </div>

            {msg && (
              <p
                className={`p-3 font-mono text-xs ${
                  msg.ok
                    ? "border border-[#30A46C]/30 bg-[#30A46C]/10 text-[#30A46C]"
                    : "border border-[#E5484D]/30 bg-[#E5484D]/10 text-[#E5484D]"
                }`}
              >
                {msg.text}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-6 h-12 w-full bg-[#111111] font-mono text-xs font-bold uppercase tracking-wider text-[#FBF9F5] transition-colors hover:bg-neutral-800 disabled:opacity-40"
            >
              {busy ? "Authenticating…" : mode === "in" ? "Sign In →" : "Create Account →"}
            </button>
          </form>

          <div className="mt-6 border-t border-[#E8E5DF] pt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setMode(mode === "in" ? "up" : "in");
                setMsg(null);
              }}
              className="font-mono text-xs text-[#666666] hover:text-[#111111]"
            >
              {mode === "in" ? "Need an account? Register operator profile" : "Already have an account? Sign in"}
            </button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-[#E8E5DF] py-6 text-center text-xs text-[#666666] font-mono">
        Q Virtual Queuing Engine • https://queue-engine.vercel.app
      </footer>
    </main>
  );
}
