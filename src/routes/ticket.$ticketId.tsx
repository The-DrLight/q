import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { LivePulse } from "@/components/LivePulse";
import { DEFAULT_BUFFER_SIZE, MAX_STRIKES, clearActiveTicket, formatLagosTime, getClientUuid, notify } from "@/lib/q";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/ticket/$ticketId")({
  head: () => ({
    meta: [
      { title: "Your place in line — Q" },
      { name: "description", content: "Live position tracking for your spot in the queue." },
      { property: "og:title", content: "Your place in line — Q" },
      { property: "og:description", content: "Live position tracking for your spot in the queue." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TicketPage,
});

type Status = {
  id: string;
  queue_id: string;
  ticket_number: number;
  full_name: string;
  status: string;
  strikes: number;
  queue_position: number | null;
  venue_name: string;
  title: string;
  queue_status: string;
  counter_name: string | null;
};

function Clock() {
  const [now, setNow] = useState<string>("--:--:--");
  useEffect(() => {
    const tick = () => setNow(formatLagosTime(new Date()));
    tick();
    const i = setInterval(tick, 1000);
    return () => clearInterval(i);
  }, []);
  return <span className="num text-sm font-mono">{now}</span>;
}

function TicketPage() {
  const { ticketId } = Route.useParams();
  const [t, setT] = useState<Status | null>(null);
  const [missing, setMissing] = useState(false);
  const [dynamicBuffer, setDynamicBuffer] = useState<number>(DEFAULT_BUFFER_SIZE);
  const [isOnline, setIsOnline] = useState(true);
  const prev = useRef<Status | null>(null);

  const load = useCallback(async () => {
    const cleanTicketId = ticketId.trim();

    // 1. Wrap RPC in a 3.5s timeout promise
    let row: Status | null = null;
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Request timed out")), 3500)
      );
      const query = supabase.rpc("get_ticket_status", { p_ticket_id: cleanTicketId });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await Promise.race([query, timeout]);
      if (res?.data && res.data[0]) {
        row = res.data[0] as Status;
      }
    } catch (rpcErr) {
      console.warn("get_ticket_status RPC timed out or failed; falling back to direct select:", rpcErr);
    }

    // 2. Direct fallback query if RPC failed, timed out, or returned null
    if (!row) {
      const { data: directTicket, error: directError } = await supabase
        .from("tickets")
        .select(`
          id,
          queue_id,
          ticket_number,
          full_name,
          status,
          strikes,
          sort_order,
          serving_operator_id
        `)
        .eq("id", cleanTicketId)
        .maybeSingle();

      if (directError || !directTicket) {
        setMissing(true);
        return;
      }

      // Fetch queue title and venue name
      const { data: queueData } = await supabase
        .from("queues")
        .select("title, status")
        .eq("id", directTicket.queue_id)
        .maybeSingle();

      // Recalculate dynamic position: count how many WAITING tickets are ahead in sort_order
      let queuePosition: number | null = null;
      if (directTicket.status === "WAITING") {
        const { count } = await supabase
          .from("tickets")
          .select("id", { count: "exact", head: true })
          .eq("queue_id", directTicket.queue_id)
          .eq("status", "WAITING")
          .lt("sort_order", (directTicket as any).sort_order ?? 999999);
        queuePosition = (count ?? 0) + 1;
      }

      row = {
        id: directTicket.id,
        queue_id: directTicket.queue_id,
        ticket_number: directTicket.ticket_number,
        full_name: directTicket.full_name,
        status: directTicket.status,
        strikes: directTicket.strikes,
        queue_position: queuePosition,
        venue_name: (queueData as any)?.venue_name || (queueData as any)?.venue_id || queueData?.title || "Venue",
        title: queueData?.title || "Virtual Queue",
        queue_status: queueData?.status || "OPEN",
        counter_name: null,
      };
    }

    setT(row);

    // Fetch dynamic buffer size non-blockingly
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.rpc as any)("get_dynamic_buffer_size", {
      p_queue_id: row.queue_id,
    })
      .then(({ data: bufSize }: { data: unknown }) => {
        if (typeof bufSize === "number") {
          setDynamicBuffer(bufSize);
        }
      })
      .catch(() => {});
  }, [ticketId]);

  // Network offline/online indicator
  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      load();
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [load]);

  // initial + background-wake resync + 5-second polling fallback
  useEffect(() => {
    load();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    const poll = setInterval(load, 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(poll);
    };
  }, [load]);

  // realtime: queue version bumps on every ticket change
  const queueId = t?.queue_id;
  useEffect(() => {
    if (!queueId) return;
    const ch = supabase
      .channel(`q-${queueId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "queues", filter: `id=eq.${queueId}` }, () =>
        load(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `id=eq.${ticketId}` }, () =>
        load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [queueId, ticketId, load]);

  // alerts on transitions
  useEffect(() => {
    if (!t) return;
    const p = prev.current;
    const key = `q_alerted_${t.id}_${t.strikes}`;
    if (t.status === "WAITING" && t.queue_position != null && t.queue_position <= dynamicBuffer && !localStorage.getItem(key)) {
      localStorage.setItem(key, "1");
      notify("You are now entering the physical staging zone", "Please proceed to the physical line immediately.");
    }
    if (t.status === "SERVING" && p && p.status !== "SERVING") {
      notify("It's your turn", `Please go to ${t.counter_name ?? "the desk"}.`);
    }
    if (t.status === "COMPLETED" || t.status === "REVOKED") clearActiveTicket(t.queue_id);
    prev.current = t;
  }, [t, dynamicBuffer]);

  async function cancel() {
    await supabase.rpc("cancel_ticket", { p_ticket_id: ticketId, p_client_uuid: getClientUuid() });
    clearActiveTicket(t?.queue_id);
    load();
  }

  if (missing)
    return (
      <Shell venue="Q" isOnline={isOnline}>
        <div className="py-8 text-center space-y-4">
          <p className="font-mono text-xl font-bold text-[#111111] dark:text-[#FBF9F5]">Ticket not found</p>
          <p className="text-sm text-neutral-500 max-w-xs mx-auto">
            This ticket may have expired, or the identification link was incomplete.
          </p>
          <div className="pt-4">
            <button
              type="button"
              onClick={() => {
                const lastQueueId = t?.queue_id || Object.keys(localStorage)
                  .find((k) => k.startsWith("q_active_ticket_"))
                  ?.replace("q_active_ticket_", "");
                if (lastQueueId) {
                  window.location.href = `/join/${lastQueueId}`;
                } else {
                  window.location.href = "/";
                }
              }}
              className="inline-flex items-center justify-center rounded-full bg-[#111111] dark:bg-[#FBF9F5] px-6 py-3 font-mono text-xs font-bold uppercase tracking-wider text-[#FBF9F5] dark:text-[#111111] hover:opacity-90"
            >
              Scan QR Again →
            </button>
          </div>
        </div>
      </Shell>
    );
  if (!t)
    return (
      <Shell venue="…" isOnline={isOnline}>
        <p className="eyebrow">Loading your spot…</p>
      </Shell>
    );

  const pos = t.queue_position;
  const inBuffer = t.status === "WAITING" && pos != null && pos <= dynamicBuffer;
  const tone = t.status === "SERVING" ? "success" : inBuffer ? "warning" : "success";

  return (
    <Shell venue={`${t.venue_name} · ${t.title}`} pulse={<LivePulse tone={tone} />} isOnline={isOnline}>
      <div className="flex items-baseline justify-between border-b border-[#262626] pb-4">
        <span className="font-mono text-xs uppercase tracking-wider text-neutral-400">Your Ticket</span>
        <span className="font-mono text-xl font-black text-[#FBF9F5]">#{t.ticket_number}</span>
      </div>

      {t.status === "WAITING" && pos != null && (
        <div className="my-8">
          <p className="font-mono text-xs uppercase tracking-widest text-neutral-400">Position in Line</p>
          <p className="font-mono mt-2 text-[7.5rem] font-bold leading-none tracking-tight text-[#FBF9F5]">{pos}</p>
          <p className="mt-4 font-mono text-base text-neutral-400">
            {pos === 1 ? "You're next at the counter." : `${pos - 1} ${pos - 1 === 1 ? "person" : "people"} ahead of you`}
          </p>
        </div>
      )}

      {t.status === "SERVING" && (
        <div className="my-8 border-2 border-emerald-500 bg-emerald-950/20 p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-emerald-400">Now Serving</p>
          <p className="mt-2 font-mono text-4xl font-bold text-[#FBF9F5]">It's your turn.</p>
          <p className="mt-2 font-mono text-sm text-neutral-300">
            Please proceed immediately to {t.counter_name ?? "the counter desk"}.
          </p>
        </div>
      )}

      {t.status === "COMPLETED" && (
        <div className="my-8 border border-[#262626] bg-[#111111] p-6">
          <p className="font-mono text-3xl font-bold text-[#FBF9F5]">All Done.</p>
          <p className="mt-2 font-mono text-sm text-neutral-400">Your ticket has been completed. Thank you for waiting with Q.</p>
        </div>
      )}

      {t.status === "REVOKED" && (
        <div className="my-8 border-2 border-[#E5484D] bg-[#E5484D]/10 p-6">
          <p className="font-mono text-xs font-bold uppercase tracking-wider text-[#E5484D]">Ticket Revoked</p>
          <p className="mt-2 font-mono text-xl font-bold text-[#FBF9F5]">
            {t.strikes >= MAX_STRIKES ? "Permanently removed after 3 missed calls." : "This ticket is no longer active."}
          </p>
          <Link
            to="/join/$queueId"
            params={{ queueId: t.queue_id }}
            className="mt-6 inline-flex h-12 items-center bg-[#FBF9F5] px-5 font-mono text-xs font-bold uppercase text-[#0A0A0A] hover:bg-white"
          >
            Rejoin Line
          </Link>
        </div>
      )}

      {inBuffer && (
        <div className="mt-6 border-2 border-amber-500 bg-amber-500/10 p-5 text-amber-300">
          <p className="font-mono text-xs font-bold uppercase tracking-wider">Physical Staging Zone</p>
          <p className="mt-1 font-mono text-sm leading-snug">
            You are now entering the physical staging zone (Top {dynamicBuffer}). Please proceed to the physical line immediately.
          </p>
        </div>
      )}

      {t.status === "WAITING" && t.strikes > 0 && (
        <div className="mt-4 border border-amber-600/60 bg-amber-950/20 p-4 font-mono text-xs text-amber-400">
          Missed call detected. Reassigned behind the staging buffer (Strike {t.strikes}/{MAX_STRIKES}).
        </div>
      )}

      {(t.status === "WAITING" || t.status === "SERVING") && (
        <div className="mt-10 flex items-center justify-between border-t border-[#262626] pt-5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase text-neutral-400">Strikes</span>
            <span className="flex gap-1.5" aria-label={`${t.strikes} of ${MAX_STRIKES} strikes`}>
              {Array.from({ length: MAX_STRIKES }).map((_, i) => (
                <span
                  key={i}
                  className={`h-2.5 w-2.5 ${i < t.strikes ? "bg-[#E5484D]" : "border border-[#262626]"}`}
                />
              ))}
            </span>
            <span className="font-mono text-xs text-neutral-500">
              {t.strikes}/{MAX_STRIKES}
            </span>
          </div>
          {t.queue_status !== "OPEN" && (
            <span className="font-mono text-xs uppercase text-amber-400">Intake Paused</span>
          )}
        </div>
      )}

      {(t.status === "WAITING" || t.status === "SERVING") && (
        <div className="mt-16 text-center">
          <AlertDialog>
            <AlertDialogTrigger className="font-mono text-xs text-neutral-500 underline underline-offset-4 hover:text-neutral-300">
              Leave Line / Cancel Ticket
            </AlertDialogTrigger>
            <AlertDialogContent className="border border-[#262626] bg-[#111111] text-[#FBF9F5]">
              <AlertDialogHeader>
                <AlertDialogTitle className="font-mono text-base font-bold">Leave the line?</AlertDialogTitle>
                <AlertDialogDescription className="font-mono text-xs text-neutral-400">
                  You will surrender your spot. Under the single-active ticket policy, this spot cannot be recovered.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border border-[#262626] font-mono text-xs text-neutral-300">
                  Keep My Spot
                </AlertDialogCancel>
                <AlertDialogAction onClick={cancel} className="bg-[#E5484D] font-mono text-xs font-bold text-white hover:bg-red-700">
                  Leave Line
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </Shell>
  );
}

function Shell({
  venue,
  pulse,
  isOnline,
  children,
}: {
  venue: string;
  pulse?: React.ReactNode;
  isOnline: boolean;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#FBF9F5]">
      {/* Network Offline Resilience Banner */}
      {!isOnline && (
        <div className="bg-[#E5484D] px-4 py-2 text-center font-mono text-xs font-bold tracking-wider text-white uppercase">
          ● Network Disconnected — Reconnecting to Queue Engine…
        </div>
      )}

      <div className="mx-auto max-w-md px-6 pb-12 pt-6">
        <header className="flex items-center justify-between border-b border-[#262626] pb-4">
          <span className="truncate pr-4 font-mono text-sm font-semibold">{venue}</span>
          <span className="flex shrink-0 items-center gap-2">
            {pulse}
            <Clock />
            <span className="font-mono text-[10px] text-neutral-500">WAT</span>
          </span>
        </header>
        <section className="pt-6">{children}</section>
      </div>
    </main>
  );
}
