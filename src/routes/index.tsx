import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Navbar } from "@/components/Navbar";
import { CreateQueueModal } from "@/components/CreateQueueModal";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Q — Zero-Install Virtual Queues" },
      {
        name: "description",
        content:
          "End the physical crowd. Let your visitors roam. A browser-based queuing platform for busy campus halls, clinic intakes, and customer desks.",
      },
      { property: "og:title", content: "Q — Zero-Install Virtual Queues" },
      {
        property: "og:description",
        content:
          "End the physical crowd. Let your visitors roam. A browser-based queuing platform for busy campus halls, clinic intakes, and customer desks.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setCurrentUser(data.user?.id ?? null);
    });
  }, []);

  function handlePrimaryCTA() {
    if (currentUser) {
      setIsModalOpen(true);
    } else {
      navigate({ to: "/operator/login", search: { mode: "signup" } });
    }
  }

  return (
    <div className="min-h-screen bg-[#FBF9F5] text-[#111111] flex flex-col justify-between">
      {/* Global Navigation Bar */}
      <Navbar />

      {/* Hero Section */}
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 pt-16 pb-16 md:px-12 md:pt-24 md:pb-20">
          <div className="max-w-3xl">
            {/* Subtle status pill */}
            <div className="inline-flex items-center gap-2 border border-[#E8E5DF] bg-[#FFFFFF] px-3.5 py-1 text-[11px] font-mono uppercase tracking-widest text-[#666666] mb-8 shadow-xs">
              <span className="h-2 w-2 rounded-full bg-[#30A46C] animate-pulse" />
              <span>Zero-Install Queuing Engine</span>
            </div>

            {/* Headline */}
            <h1 className="font-mono text-4xl font-extrabold leading-[1.08] tracking-tight text-[#111111] sm:text-5xl md:text-6xl">
              End the physical crowd. Let your visitors roam.
            </h1>

            {/* Subhead */}
            <p className="mt-6 text-lg md:text-xl leading-relaxed text-[#666666] max-w-2xl">
              A browser-based queuing platform for busy campus halls, clinic intakes, and customer
              desks. Zero apps to download. Dynamic physical buffers. Real-time Web Push arrivals.
            </p>

            {/* Dual CTAs */}
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={handlePrimaryCTA}
                className="inline-flex items-center justify-center rounded-full bg-[#111111] px-6 py-3.5 font-mono text-xs md:text-sm font-semibold tracking-wider text-[#FBF9F5] transition-transform active:scale-95 hover:bg-black shadow-sm"
              >
                Create a Queue →
              </button>

              <Link
                to="/operator/login"
                className="inline-flex items-center justify-center rounded-full border border-[#E8E5DF] bg-[#FFFFFF] px-6 py-3.5 font-mono text-xs md:text-sm font-semibold text-[#111111] hover:bg-[#F4F1EA] transition-colors"
              >
                Sign in as Operator
              </Link>
            </div>
          </div>

          {/* Feature Pillars: 3-Column Editorial Grid */}
          <div className="mt-20 grid grid-cols-1 gap-6 md:grid-cols-3">
            <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 sm:p-8 flex flex-col justify-between shadow-xs">
              <div>
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#666666]">
                  01 / Frictionless Intake
                </span>
                <h3 className="mt-4 font-mono text-lg font-bold text-[#111111]">
                  Instant QR Onboarding
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-[#666666]">
                  No App Store friction. Visitors scan a printed paper sign on arrival, type their
                  name, and immediately hold a verified sequential ticket on their phone.
                </p>
              </div>
              <div className="mt-8 font-mono text-xs text-[#30A46C] font-semibold">
                Single-Device Verification
              </div>
            </div>

            <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 sm:p-8 flex flex-col justify-between shadow-xs">
              <div>
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#666666]">
                  02 / Smart Staging
                </span>
                <h3 className="mt-4 font-mono text-lg font-bold text-[#111111]">
                  Dynamic Staging Buffer
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-[#666666]">
                  Never leave service desks idling. Q dynamically recalculates the on-deck zone
                  based on active clerk speed, notifying the next batch just in time.
                </p>
              </div>
              <div className="mt-8 font-mono text-xs text-[#111111] font-semibold">
                (Active Clerks × 3) + 2
              </div>
            </div>

            <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 sm:p-8 flex flex-col justify-between shadow-xs">
              <div>
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#666666]">
                  03 / Verification Security
                </span>
                <h3 className="mt-4 font-mono text-lg font-bold text-[#111111]">
                  Verified Live Presence
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-[#666666]">
                  Say goodbye to screenshot line-cutting. Live ticking seconds and anti-spoof
                  animations guarantee every ticket shown at the counter is active.
                </p>
              </div>
              <div className="mt-8 font-mono text-xs text-[#E5484D] font-semibold">
                3-Strike Absence Penalty
              </div>
            </div>
          </div>

          {/* How It Works Step-Through */}
          <div className="mt-20 border border-[#E8E5DF] bg-[#FFFFFF] p-8 md:p-12 shadow-xs">
            <span className="font-mono text-xs font-bold uppercase tracking-widest text-[#666666]">
              Operational Workflow
            </span>
            <h2 className="mt-2 font-mono text-2xl font-bold tracking-tight text-[#111111]">
              How Q Works in 3 Steps
            </h2>

            <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-3">
              <div className="border-t border-[#E8E5DF] pt-4">
                <span className="font-mono text-2xl font-black text-[#111111]">1</span>
                <h4 className="mt-2 font-mono text-sm font-bold text-[#111111]">
                  Create your queue in 10 seconds.
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-[#666666]">
                  Give your queue a name and invite fellow operators. No complex software installations
                  or IT overhead.
                </p>
              </div>

              <div className="border-t border-[#E8E5DF] pt-4">
                <span className="font-mono text-2xl font-black text-[#111111]">2</span>
                <h4 className="mt-2 font-mono text-sm font-bold text-[#111111]">
                  Download and print your venue QR sign.
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-[#666666]">
                  One-click export generates an ultra high-res, print-ready A4 poster to place at intake
                  doors and counters.
                </p>
              </div>

              <div className="border-t border-[#E8E5DF] pt-4">
                <span className="font-mono text-2xl font-black text-[#111111]">3</span>
                <h4 className="mt-2 font-mono text-sm font-bold text-[#111111]">
                  Call visitors from any device.
                </h4>
                <p className="mt-1 text-xs leading-relaxed text-[#666666]">
                  Clerks process visitors from a shared queue hopper. Handle absent visitors with
                  automated strike re-indexing.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Clean Footer */}
      <footer className="border-t border-[#E8E5DF] bg-[#FBF9F5] py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-center md:flex-row md:px-12 md:text-left">
          <div className="flex items-center gap-3">
            <span className="font-mono text-lg font-black tracking-tighter text-[#111111]">Q</span>
            <span className="text-xs text-[#666666]">
              Q Engine • Open Source under MIT License •{" "}
              <a
                href="https://github.com/The-DrLight/q"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-[#111111]"
              >
                GitHub Repository
              </a>
            </span>
          </div>
          <div className="font-mono text-xs text-[#666666]">
            Production Domain: <span className="text-[#111111] font-medium">https://queue-engine.vercel.app</span>
          </div>
        </div>
      </footer>

      {/* Creation Modal */}
      <CreateQueueModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => {
          navigate({ to: "/operator/dashboard" });
        }}
      />
    </div>
  );
}
