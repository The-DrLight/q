import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Q — Zero-Friction Virtual Queuing" },
      {
        name: "description",
        content: "Zero-install virtual queuing for high-density physical lines. Instant setup with dynamic buffer sizing.",
      },
      { property: "og:title", content: "Q — Zero-Friction Virtual Queuing" },
      {
        property: "og:description",
        content: "Zero-install virtual queuing for high-density physical lines. Instant setup with dynamic buffer sizing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [queueName, setQueueName] = useState("");
  const [operatorEmails, setOperatorEmails] = useState("");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUser(data.user?.id ?? null);
    });
  }, []);

  async function handleCreateQueue(e: FormEvent) {
    e.preventDefault();
    if (!queueName.trim()) return;

    setErrorMsg(null);
    setBusy(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const emails = operatorEmails
      .split(",")
      .map((em) => em.trim())
      .filter((em) => em.length > 0);

    if (!session) {
      // Store intent and send to login
      sessionStorage.setItem(
        "q_pending_queue",
        JSON.stringify({ title: queueName.trim(), emails }),
      );
      navigate({ to: "/operator/login" });
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)(
        "create_queue_with_operators",
        {
          p_title: queueName.trim(),
          p_operator_emails: emails,
        },
      );

      if (error) {
        setErrorMsg(error.message);
        setBusy(false);
        return;
      }

      sessionStorage.removeItem("q_pending_queue");
      navigate({ to: "/operator/dashboard" });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to create queue.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#FBF9F5] selection:bg-[#FBF9F5] selection:text-[#0A0A0A]">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col justify-between px-6 py-8 md:px-12">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[#262626] pb-6">
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl font-bold tracking-tighter">Q</span>
            <span className="font-mono text-xs text-neutral-400">v1.1</span>
          </div>
          <div className="flex items-center gap-6">
            <Link
              to="/operator/login"
              className="font-mono text-xs tracking-wider text-neutral-400 uppercase transition-colors hover:text-[#FBF9F5]"
            >
              {currentUser ? "Open Desk →" : "Clerk Sign In →"}
            </Link>
          </div>
        </header>

        {/* Hero & Intake Form */}
        <section className="py-12 md:py-16">
          <div className="max-w-2xl">
            <p className="font-mono text-xs tracking-widest text-neutral-400 uppercase">
              Physical Line Elimination Engine
            </p>
            <h1 className="mt-4 font-mono text-4xl font-bold tracking-tight text-[#FBF9F5] md:text-6xl">
              Lines without <br />
              the crowd.
            </h1>
            <p className="mt-6 text-base leading-relaxed text-neutral-400 md:text-lg">
              Zero-install virtual queuing engineered for PVC collection, faculty registries,
              consulates, and high-density counters. Visitors scan, roam freely, and return only when
              they reach the dynamic physical staging zone.
            </p>
          </div>

          <div className="mt-12 max-w-xl border border-[#262626] bg-[#111111] p-6 sm:p-8">
            <div className="flex items-baseline justify-between border-b border-[#262626] pb-4">
              <span className="font-mono text-xs font-semibold tracking-wider text-[#FBF9F5] uppercase">
                Deploy New Virtual Queue
              </span>
              <span className="font-mono text-[10px] text-neutral-400">24-HR EPHEMERAL LEASE</span>
            </div>

            <form onSubmit={handleCreateQueue} className="mt-6 space-y-6">
              <div>
                <label
                  htmlFor="queueName"
                  className="block font-mono text-xs font-medium tracking-wide text-neutral-300 uppercase"
                >
                  Queue Name / Venue Title <span className="text-[#E5484D]">*</span>
                </label>
                <input
                  id="queueName"
                  type="text"
                  required
                  maxLength={100}
                  value={queueName}
                  onChange={(e) => setQueueName(e.target.value)}
                  placeholder="e.g. PVC Collection Desk 4"
                  className="mt-2 w-full border border-[#262626] bg-[#0A0A0A] px-4 py-3 font-mono text-sm text-[#FBF9F5] outline-none placeholder:text-neutral-600 focus:border-[#FBF9F5]"
                />
              </div>

              <div>
                <label
                  htmlFor="operatorEmails"
                  className="block font-mono text-xs font-medium tracking-wide text-neutral-300 uppercase"
                >
                  Invite Clerks / Operators{" "}
                  <span className="text-[10px] tracking-normal text-neutral-500 lowercase">(comma separated)</span>
                </label>
                <input
                  id="operatorEmails"
                  type="text"
                  value={operatorEmails}
                  onChange={(e) => setOperatorEmails(e.target.value)}
                  placeholder="clerk1@venue.org, clerk2@venue.org"
                  className="mt-2 w-full border border-[#262626] bg-[#0A0A0A] px-4 py-3 font-mono text-sm text-[#FBF9F5] outline-none placeholder:text-neutral-600 focus:border-[#FBF9F5]"
                />
              </div>

              {errorMsg && (
                <div className="border border-[#E5484D]/40 bg-[#E5484D]/10 p-3 font-mono text-xs text-[#E5484D]">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !queueName.trim()}
                className="w-full bg-[#FBF9F5] py-4 font-mono text-sm font-semibold tracking-wider text-[#0A0A0A] uppercase transition-colors hover:bg-white disabled:opacity-40"
              >
                {busy ? "Deploying Queue…" : "Create Virtual Queue →"}
              </button>
            </form>
          </div>
        </section>

        {/* Footer */}
        <footer className="grid grid-cols-1 gap-6 border-t border-[#262626] pt-8 md:grid-cols-3">
          <div>
            <div className="font-mono text-2xl font-bold tracking-tight text-[#FBF9F5]">Dynamic</div>
            <div className="font-mono text-xs tracking-wider text-neutral-400 uppercase">
              Adaptive Buffer Sizing
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold tracking-tight text-[#FBF9F5]">Single-Active</div>
            <div className="font-mono text-xs tracking-wider text-neutral-400 uppercase">
              Strict Device Lock
            </div>
          </div>
          <div>
            <div className="font-mono text-2xl font-bold tracking-tight text-[#FBF9F5]">MIT License</div>
            <div className="font-mono text-xs tracking-wider text-neutral-400 uppercase">
              Open Architecture
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
