import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Q — Virtual Queuing Engine" },
      {
        name: "description",
        content: "The zero-install queue engine for high-density venues. Replace chaotic physical lines with a self-regulating browser queue.",
      },
      { property: "og:title", content: "Q — Virtual Queuing Engine" },
      {
        property: "og:description",
        content: "The zero-install queue engine for high-density venues. Replace chaotic physical lines with a self-regulating browser queue.",
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
      setErrorMsg(err instanceof Error ? err.message : "Failed to deploy queue.");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#FBF9F5] text-[#111111]">
      {/* Header */}
      <header className="border-b border-[#E8E5DF] bg-[#FBF9F5]/90 backdrop-blur-md sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 md:px-12">
          <div className="flex items-center gap-3">
            <span className="font-mono text-2xl font-black tracking-tighter text-[#111111]">Q</span>
            <div className="h-4 w-px bg-[#E8E5DF]" />
            <span className="font-mono text-xs uppercase tracking-wider text-[#666666]">
              Virtual Queuing Engine
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="#deploy"
              className="hidden sm:inline-block font-mono text-xs font-semibold uppercase tracking-wider text-[#666666] hover:text-[#111111]"
            >
              Create Queue
            </a>
            <Link
              to="/operator/login"
              className="inline-flex items-center justify-center border border-[#111111] bg-[#111111] px-4 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-[#FBF9F5] transition-colors hover:bg-neutral-800"
            >
              {currentUser ? "Open Console →" : "Operator Sign In →"}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-12 md:px-12 md:pt-24 md:pb-16">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 border border-[#E8E5DF] bg-[#FFFFFF] px-3 py-1 text-[11px] font-mono uppercase tracking-widest text-[#666666] mb-6">
            <span className="h-1.5 w-1.5 rounded-full bg-[#30A46C]" />
            Version 1.1 Live Production Release
          </div>
          <h1 className="font-mono text-4xl font-extrabold leading-[1.08] tracking-tight text-[#111111] sm:text-5xl md:text-6xl">
            The zero-install queue engine for high-density venues.
          </h1>
          <p className="mt-6 text-lg md:text-xl leading-relaxed text-[#666666]">
            Replace chaotic physical lines with a self-regulating browser queue. Visitors scan an on-site
            QR code, roam freely, and arrive right when they're called.
          </p>
        </div>

        {/* 3 Metric / Feature Cards Strip */}
        <div className="mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#666666]">
                01 / Frictionless Intake
              </span>
              <h3 className="mt-3 font-mono text-lg font-bold text-[#111111]">Zero App Downloads</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#666666]">
                Instant mobile web check-in via native camera QR scan. Single-active device verification eliminates ghost bookings.
              </p>
            </div>
            <div className="mt-6 font-mono text-xs text-[#30A46C] font-semibold">Web Push Notification Ready</div>
          </div>

          <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#666666]">
                02 / Smart Staging
              </span>
              <h3 className="mt-3 font-mono text-lg font-bold text-[#111111]">Dynamic Staging Buffer</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#666666]">
                Scales automatically with active clerks: <span className="font-mono text-xs bg-[#FBF9F5] px-1 py-0.5 border border-[#E8E5DF]">(Clerks × 3) + 2</span>. Keeps 3 to 11 visitors on-deck to eliminate desk idle latency.
              </p>
            </div>
            <div className="mt-6 font-mono text-xs text-[#111111] font-semibold">Fractional Re-Indexing</div>
          </div>

          <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 sm:p-8 flex flex-col justify-between">
            <div>
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#666666]">
                03 / Verification Security
              </span>
              <h3 className="mt-3 font-mono text-lg font-bold text-[#111111]">Anti-Spoofing Protocol</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#666666]">
                Live ticking seconds clock and continuous SVG pulsing canvas strictly require an active, foreground browser tab. Static screenshots are invalid.
              </p>
            </div>
            <div className="mt-6 font-mono text-xs text-[#E5484D] font-semibold">3-Strike Absence Penalty</div>
          </div>
        </div>
      </section>

      {/* Queue Deployment Section */}
      <section id="deploy" className="border-t border-[#E8E5DF] bg-[#F4F1EA]/50 py-16 md:py-20">
        <div className="mx-auto max-w-4xl px-6 md:px-12">
          <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-8 md:p-12 shadow-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#E8E5DF] pb-5">
              <div>
                <span className="font-mono text-xs font-bold uppercase tracking-widest text-[#111111]">
                  Deploy Queue Instance
                </span>
                <p className="font-mono text-xs text-[#666666] mt-0.5">Instant setup with zero corporate onboarding</p>
              </div>
              <span className="font-mono text-[11px] text-[#30A46C] font-semibold uppercase">
                Rolling 24-Hour Lease
              </span>
            </div>

            <form onSubmit={handleCreateQueue} className="mt-8 space-y-6">
              <div>
                <label
                  htmlFor="queueName"
                  className="block font-mono text-xs font-semibold tracking-wider text-[#111111] uppercase"
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
                  placeholder="e.g. PVC Collection Booth, Course Registration Desk 3"
                  className="mt-2 w-full border border-[#E8E5DF] bg-[#FBF9F5] px-4 py-3.5 font-mono text-sm text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#111111]"
                />
              </div>

              <div>
                <label
                  htmlFor="operatorEmails"
                  className="block font-mono text-xs font-semibold tracking-wider text-[#111111] uppercase"
                >
                  Invite Additional Clerks / Operators{" "}
                  <span className="text-[11px] tracking-normal text-[#666666] font-normal lowercase">
                    (optional, comma-separated)
                  </span>
                </label>
                <input
                  id="operatorEmails"
                  type="text"
                  value={operatorEmails}
                  onChange={(e) => setOperatorEmails(e.target.value)}
                  placeholder="clerk1@venue.org, clerk2@venue.org"
                  className="mt-2 w-full border border-[#E8E5DF] bg-[#FBF9F5] px-4 py-3.5 font-mono text-sm text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#111111]"
                />
              </div>

              {errorMsg && (
                <div className="border border-[#E5484D]/30 bg-[#E5484D]/10 p-3 font-mono text-xs text-[#E5484D]">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !queueName.trim()}
                className="w-full bg-[#111111] py-4 font-mono text-xs md:text-sm font-bold tracking-wider text-[#FBF9F5] uppercase transition-colors hover:bg-neutral-800 disabled:opacity-40"
              >
                {busy ? "Deploying Queue Instance…" : "Deploy Virtual Queue →"}
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#E8E5DF] bg-[#FBF9F5] py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-center md:flex-row md:px-12 md:text-left">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-black tracking-tighter text-[#111111]">Q</span>
            <span className="text-xs text-[#666666]">
              Open Source Community Tool • MIT License
            </span>
          </div>
          <div className="font-mono text-xs text-[#666666]">
            Production Domain: <span className="text-[#111111] font-medium">https://queue-engine.vercel.app</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
