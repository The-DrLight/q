import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LivePulse } from "@/components/LivePulse";
import { formatLagosTime, playChime } from "@/lib/q";

export const Route = createFileRoute("/display/$queueId")({
  head: () => ({
    meta: [
      { title: "Lobby Display — Q" },
      { name: "description", content: "High-contrast public lobby display for waiting areas and monitors." },
      { property: "og:title", content: "Lobby Display — Q" },
      { property: "og:description", content: "High-contrast public lobby display for waiting areas and monitors." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LobbyDisplayPage,
});

type Queue = { id: string; venue_name: string; title: string; status: string };
type Ticket = {
  id: string;
  ticket_number: number;
  full_name: string;
  status: string;
  serving_operator_id: string | null;
  sort_order: number;
};
type Operator = { id: string; counter_name: string };

function LobbyDisplayPage() {
  const { queueId } = Route.useParams();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [operatorsMap, setOperatorsMap] = useState<Record<string, string>>({});
  const [now, setNow] = useState<string>("--:--:--");
  const [dynamicBuffer, setDynamicBuffer] = useState<number>(5);
  const previousServingRef = useRef<string>("");

  // Digital live ticking clock (anti-spoofing / freshness check)
  useEffect(() => {
    const tick = () => setNow(formatLagosTime(new Date()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const loadData = useCallback(async () => {
    const [{ data: q }, { data: ts }, { data: ops }, { data: bufSize }] = await Promise.all([
      supabase.from("queues").select("id,venue_name,title,status").eq("id", queueId).maybeSingle(),
      supabase
        .from("tickets")
        .select("id,ticket_number,full_name,status,serving_operator_id,sort_order")
        .eq("queue_id", queueId)
        .in("status", ["WAITING", "SERVING"])
        .order("sort_order", { ascending: true }),
      supabase.from("operators").select("id,counter_name").eq("queue_id", queueId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.rpc as any)("get_dynamic_buffer_size", { p_queue_id: queueId }),
    ]);

    if (q) setQueue(q);
    const activeTickets = (ts as Ticket[]) ?? [];
    setTickets(activeTickets);

    if (ops) {
      const map: Record<string, string> = {};
      ops.forEach((o: Operator) => {
        map[o.id] = o.counter_name;
      });
      setOperatorsMap(map);
    }

    if (typeof bufSize === "number") {
      setDynamicBuffer(bufSize);
    }

    // Play chime on serving change
    const currentServingKeys = activeTickets
      .filter((t) => t.status === "SERVING")
      .map((t) => `${t.id}:${t.serving_operator_id}`)
      .sort()
      .join(",");

    if (previousServingRef.current && previousServingRef.current !== currentServingKeys) {
      playChime();
    }
    previousServingRef.current = currentServingKeys;
  }, [queueId]);

  useEffect(() => {
    loadData();
    const channel = supabase
      .channel(`display-${queueId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `queue_id=eq.${queueId}` }, () => {
        loadData();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "queues", filter: `id=eq.${queueId}` }, () => {
        loadData();
      })
      .subscribe();

    const onVisible = () => document.visibilityState === "visible" && loadData();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      supabase.removeChannel(channel);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [queueId, loadData]);

  const servingTickets = tickets.filter((t) => t.status === "SERVING");
  const waitingTickets = tickets.filter((t) => t.status === "WAITING");
  const onDeckTickets = waitingTickets.slice(0, Math.min(5, dynamicBuffer));

  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#FBF9F5] select-none p-6 md:p-12 flex flex-col justify-between">
      {/* Lobby Header */}
      <header className="flex flex-wrap items-center justify-between border-b-2 border-[#262626] pb-6 gap-4">
        <div className="flex items-center gap-6">
          <span className="font-mono text-5xl font-black tracking-tighter">Q</span>
          <div className="border-l-2 border-[#262626] pl-6">
            <h1 className="font-mono text-2xl md:text-3xl font-bold uppercase tracking-tight text-[#FBF9F5]">
              {queue?.title || "Live Queue Monitor"}
            </h1>
            <p className="font-mono text-sm text-neutral-400 uppercase tracking-widest mt-1">
              {queue?.venue_name || "Official Service Line"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3">
            <LivePulse tone={queue?.status === "OPEN" ? "success" : "warning"} />
            <span className="font-mono text-xs uppercase tracking-widest text-neutral-400">
              {queue?.status === "OPEN" ? "Intake Live" : "Intake Paused"}
            </span>
          </div>
          <div className="border-l border-[#262626] pl-6 flex items-baseline gap-2">
            <span className="font-mono text-2xl md:text-3xl font-bold">{now}</span>
            <span className="font-mono text-xs text-neutral-500 uppercase">WAT</span>
          </div>
        </div>
      </header>

      {/* Main Large-Format Grid (Visible from 15m) */}
      <section className="my-10 flex-1 flex flex-col justify-center">
        <div className="flex items-center justify-between mb-6">
          <span className="font-mono text-xs md:text-sm tracking-widest uppercase text-emerald-400 font-bold">
            ● Now Serving At Counters
          </span>
          <span className="font-mono text-xs text-neutral-500 uppercase tracking-wider">
            Proceed Immediately To Your Assigned Desk
          </span>
        </div>

        {servingTickets.length === 0 ? (
          <div className="border-2 border-dashed border-[#262626] bg-[#111111] p-16 text-center">
            <p className="font-mono text-2xl md:text-4xl font-semibold text-neutral-500">
              Waiting for next ticket call…
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {servingTickets.map((t) => {
              const counter = t.serving_operator_id ? operatorsMap[t.serving_operator_id] || "Counter Desk" : "Counter Desk";
              return (
                <div
                  key={t.id}
                  className="border-2 border-emerald-500 bg-[#111111] p-8 flex flex-col justify-between shadow-2xl shadow-emerald-950/20"
                >
                  <div className="flex justify-between items-baseline border-b border-[#262626] pb-4">
                    <span className="font-mono text-lg font-bold uppercase tracking-wider text-emerald-400">
                      {counter}
                    </span>
                    <span className="font-mono text-xs text-neutral-400 uppercase">Now Calling</span>
                  </div>

                  <div className="my-8 text-center">
                    <p className="font-mono text-7xl md:text-9xl font-black leading-none tracking-tighter text-[#FBF9F5]">
                      #{t.ticket_number}
                    </p>
                    <p className="font-mono text-xl md:text-2xl font-semibold text-neutral-300 mt-4 truncate">
                      {t.full_name}
                    </p>
                  </div>

                  <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 text-center">
                    <span className="font-mono text-xs md:text-sm font-semibold tracking-wider text-emerald-400 uppercase">
                      Please step forward to {counter}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Horizontal Strip: On-Deck Physical Staging Buffer */}
      <footer className="border-t-2 border-[#262626] pt-6">
        <div className="flex flex-wrap items-baseline justify-between mb-4 gap-2">
          <span className="font-mono text-xs md:text-sm font-bold tracking-widest text-amber-400 uppercase">
            ○ On Deck · Physical Staging Buffer
          </span>
          <span className="font-mono text-xs text-neutral-400 uppercase">
            Numbers below must be standing in the immediate staging line
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => {
            const ticket = onDeckTickets[i];
            return (
              <div
                key={i}
                className="border border-[#262626] bg-[#111111] p-4 flex flex-col justify-between min-h-[110px]"
              >
                <div className="flex justify-between items-baseline">
                  <span className="font-mono text-xs text-neutral-500">P{i + 1}</span>
                  <span className="font-mono text-[10px] text-amber-400 uppercase">STAGING</span>
                </div>
                {ticket ? (
                  <>
                    <p className="font-mono text-3xl md:text-4xl font-bold text-[#FBF9F5] mt-1">
                      #{ticket.ticket_number}
                    </p>
                    <p className="font-mono text-xs text-neutral-400 truncate mt-1">{ticket.full_name}</p>
                  </>
                ) : (
                  <p className="font-mono text-3xl text-neutral-700 mt-1">—</p>
                )}
              </div>
            );
          })}
        </div>
      </footer>
    </main>
  );
}
