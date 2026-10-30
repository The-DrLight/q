import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/operator/login")({
  head: () => ({
    meta: [
      { title: "Operator sign in — Q" },
      { name: "description", content: "Sign in to run your desk on Q." },
      { property: "og:title", content: "Operator sign in — Q" },
      { property: "og:description", content: "Sign in to run your desk on Q." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
    if (mode === "in") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setBusy(false);
      if (error) return setMsg({ ok: false, text: error.message });
      await fulfillPendingQueue();
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/operator/login` },
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
    "mt-2 h-12 w-full border bg-transparent px-4 text-base outline-none focus:border-foreground";

  return (
    <main className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <Link to="/" className="num text-2xl font-semibold">
          Q
        </Link>
        <p className="eyebrow mt-10">Operator console</p>
        <h1 className="mt-2 text-3xl font-semibold">{mode === "in" ? "Sign in to your desk" : "Create operator account"}</h1>
        <form onSubmit={submit} className="mt-8">
          <label className="eyebrow" htmlFor="email">Email</label>
          <input id="email" type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          <label className="eyebrow mt-6 block" htmlFor="pw">Password</label>
          <input id="pw" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
          {msg && <p className={`mt-4 text-sm ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p>}
          <button disabled={busy} className="mt-8 h-12 w-full bg-primary font-medium text-primary-foreground disabled:opacity-50">
            {busy ? "…" : mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button onClick={() => setMode(mode === "in" ? "up" : "in")} className="mt-6 text-sm text-muted-foreground hover:text-foreground">
          {mode === "in" ? "New operator? Create an account" : "Have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
