import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { LivePulse } from "@/components/LivePulse";
import { DEFAULT_BUFFER_SIZE, MAX_STRIKES, formatWait } from "@/lib/q";

export const Route = createFileRoute("/_authenticated/operator/dashboard")({
  head: () => ({
    meta: [
      { title: "Desk Console — Q" },
      { name: "description", content: "Mobile-first inline operator controls for high-throughput queuing." },
      { property: "og:title", content: "Desk Console — Q" },
      { property: "og:description", content: "Mobile-first inline operator controls for high-throughput queuing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

type Operator = { id: string; email: string; queue_id: string | null; counter_name: string; role: string };
type Queue = { id: string; venue_name: string; title: string; status: string };
type Ticket = {
  id: string;
  ticket_number: number;
  full_name: string;
  phone_number: string | null;
  status: string;
  strikes: number;
  sort_order: number;
  serving_operator_id: string | null;
  created_at: string | null;
  served_at: string | null;
};

function Dashboard() {
  const navigate = useNavigate();
  const [op, setOp] = useState<Operator | null | undefined>(undefined);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [operatorsMap, setOperatorsMap] = useState<Record<string, { email: string; counter_name: string }>>({});
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [dynamicBuffer, setDynamicBuffer] = useState<number>(DEFAULT_BUFFER_SIZE);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: o } = await supabase.from("operators").select("*").eq("id", data.user.id).maybeSingle();
      setOp(o ?? null);
    });
  }, []);

  const queueId = op?.queue_id ?? null;

  const load = useCallback(async () => {
    if (!queueId) return;
    const [{ data: q }, { data: ts }, { data: ops }, { data: bufSize }] = await Promise.all([
      supabase.from("queues").select("id,venue_name,title,status").eq("id", queueId).maybeSingle(),
      supabase
        .from("tickets")
        .select("id,ticket_number,full_name,phone_number,status,strikes,sort_order,serving_operator_id,created_at,served_at")
        .eq("queue_id", queueId)
        .in("status", ["WAITING", "SERVING"])
        .order("sort_order", { ascending: true }),
      supabase.from("operators").select("id,email,counter_name").eq("queue_id", queueId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.rpc as any)("get_dynamic_buffer_size", { p_queue_id: queueId }),
    ]);

    if (q) setQueue(q);
    setTickets((ts as Ticket[]) ?? []);

    if (ops) {
      const map: Record<string, { email: string; counter_name: string }> = {};
      ops.forEach((o: { id: string; email: string; counter_name: string }) => {
        map[o.id] = { email: o.email, counter_name: o.counter_name };
      });
      setOperatorsMap(map);
    }

    if (typeof bufSize === "number") {
      setDynamicBuffer(bufSize);
    } else {
      setDynamicBuffer(DEFAULT_BUFFER_SIZE);
    }
  }, [queueId]);

  useEffect(() => {
    if (!queueId) return;
    load();
    const ch = supabase
      .channel(`desk-${queueId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tickets", filter: `queue_id=eq.${queueId}` }, () => load())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "queues", filter: `id=eq.${queueId}` }, () => load())
      .subscribe();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [queueId, load]);

  useEffect(() => {
    if (!queueId) return;
    const url = `${window.location.origin}/join/${queueId}`;
    import("qrcode").then((m) => m.toDataURL(url, { margin: 1, width: 320 }).then(setQr));
  }, [queueId]);

  // Operator Action Handlers
  async function handleServe(ticketId: string, ticketNumber: number) {
    if (busy || !op) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("clerk_serve_ticket", {
      p_ticket_id: ticketId,
      p_operator_id: op.id,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success(`Serving #${ticketNumber}`);
    load();
  }

  async function handleComplete(ticketId: string, ticketNumber: number) {
    if (busy || !op) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("clerk_complete_ticket", {
      p_ticket_id: ticketId,
      p_operator_id: op.id,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success(`#${ticketNumber} completed`);
    load();
  }

  async function handleAbsent(ticketId: string, ticketNumber: number, currentStrikes: number) {
    if (busy) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)("clerk_mark_ticket_absent", {
      p_ticket_id: ticketId,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      const nextStrikes = currentStrikes + 1;
      if (nextStrikes >= MAX_STRIKES) {
        toast.error(`#${ticketNumber} revoked (3 strikes)`);
      } else {
        toast.warning(`#${ticketNumber} marked absent (Strike ${nextStrikes}/3) · bumped behind buffer`);
      }
    }
    load();
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/operator/login" });
  }

  const waitingTickets = useMemo(() => tickets.filter((t) => t.status === "WAITING"), [tickets]);
  const servingTickets = useMemo(() => tickets.filter((t) => t.status === "SERVING"), [tickets]);

  // Physical On-Deck Zone (Top N slots based on dynamic buffer)
  const onDeckTickets = useMemo(() => waitingTickets.slice(0, dynamicBuffer), [waitingTickets, dynamicBuffer]);
  // Off-Premise Zone (Remaining waiting tickets)
  const offPremiseTickets = useMemo(() => {
    const list = waitingTickets.slice(dynamicBuffer);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => t.full_name.toLowerCase().includes(q) || String(t.ticket_number).includes(q));
  }, [waitingTickets, dynamicBuffer, search]);

  if (op === undefined) {
    return (
      <main className="min-h-screen bg-[#0A0A0A] p-8 text-[#FBF9F5]">
        <p className="font-mono text-xs text-neutral-400">Loading operator desk…</p>
      </main>
    );
  }

  if (!op || !op.queue_id) {
    return (
      <main className="min-h-screen bg-[#0A0A0A] p-8 text-[#FBF9F5]">
        <div className="max-w-md border border-[#262626] bg-[#111111] p-6">
          <p className="font-mono text-base font-bold text-[#FBF9F5]">Account not assigned to a queue</p>
          <p className="mt-2 text-sm text-neutral-400">
            Please create a new queue on the home screen or ask your queue administrator for an invite.
          </p>
          <div className="mt-6 flex gap-4">
            <Link to="/" className="bg-[#FBF9F5] px-4 py-2 font-mono text-xs font-semibold text-[#0A0A0A]">
              Create Queue
            </Link>
            <button onClick={signOut} className="border border-[#262626] px-4 py-2 font-mono text-xs text-neutral-400">
              Sign out
            </button>
          </div>
        </div>
      </main>
    );
  }

  const open = queue?.status === "OPEN";

  return (
    <main className="min-h-screen bg-[#0A0A0A] text-[#FBF9F5]">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-[#262626] bg-[#0A0A0A]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-4">
            <Link to="/" className="font-mono text-xl font-bold tracking-tighter">
              Q
            </Link>
            <div className="border-l border-[#262626] pl-4">
              <p className="truncate font-mono text-xs font-bold text-[#FBF9F5]">{queue?.title}</p>
              <p className="font-mono text-[10px] text-neutral-400">{op.counter_name} · {op.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Header Tools */}
            <div className="flex items-center gap-2 border border-[#262626] bg-[#111111] px-3 py-1.5 font-mono text-xs">
              <span className="text-neutral-400">Waiting:</span>
              <span className="font-bold text-[#FBF9F5]">{waitingTickets.length}</span>
              <span className="mx-1 text-neutral-600">|</span>
              <span className="text-neutral-400">Buffer:</span>
              <span className="font-bold text-[#FBF9F5]">{dynamicBuffer}</span>
            </div>

            <Link
              to="/display/$queueId"
              params={{ queueId: op.queue_id }}
              target="_blank"
              className="inline-flex min-h-[44px] items-center border border-[#262626] px-3 py-2 font-mono text-xs font-medium text-neutral-300 transition-colors hover:border-[#FBF9F5] hover:text-[#FBF9F5]"
              title="Open Lobby TV View"
            >
              Lobby TV ↗
            </Link>

            <button
              onClick={signOut}
              className="min-h-[44px] px-2 font-mono text-xs text-neutral-400 hover:text-[#FBF9F5]"
            >
              Exit
            </button>
          </div>
        </div>
      </header>

      {/* Main Responsive Grid */}
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
          {/* Main Queue Management Area */}
          <div className="space-y-8">
            {/* Currently Serving Section */}
            {servingTickets.length > 0 && (
              <section className="border border-[#262626] bg-[#111111] p-5">
                <div className="flex items-center justify-between border-b border-[#262626] pb-3">
                  <div className="flex items-center gap-2">
                    <LivePulse tone="success" />
                    <h2 className="font-mono text-xs font-bold tracking-wider uppercase text-emerald-400">
                      Currently Serving ({servingTickets.length})
                    </h2>
                  </div>
                  <span className="font-mono text-[10px] text-neutral-500">SHARED HOPPER</span>
                </div>

                <div className="mt-4 space-y-3">
                  {servingTickets.map((t) => {
                    const isMyTicket = t.serving_operator_id === op.id;
                    const servingOp = t.serving_operator_id ? operatorsMap[t.serving_operator_id] : null;

                    return (
                      <div
                        key={t.id}
                        className={`flex flex-wrap items-center justify-between gap-4 border p-4 ${
                          isMyTicket ? "border-emerald-500/50 bg-emerald-950/10" : "border-[#262626] bg-[#0A0A0A]"
                        }`}
                      >
                        <div className="flex items-baseline gap-4">
                          <span className="font-mono text-3xl font-bold text-[#FBF9F5]">#{t.ticket_number}</span>
                          <div>
                            <p className="font-mono text-base font-semibold text-[#FBF9F5]">{t.full_name}</p>
                            <p className="font-mono text-xs text-neutral-400">
                              {isMyTicket ? "At your counter" : `Serving at ${servingOp?.counter_name || "Another Desk"}`}
                              {t.served_at && ` · ${formatWait(t.served_at, now)}`}
                            </p>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleAbsent(t.id, t.ticket_number, t.strikes)}
                            disabled={busy}
                            className="min-h-[44px] min-w-[90px] border border-amber-600/70 bg-transparent px-4 py-2 font-mono text-xs font-bold tracking-wider text-amber-400 uppercase transition-colors hover:bg-amber-600/20 disabled:opacity-40"
                          >
                            Absent
                          </button>

                          {isMyTicket ? (
                            <button
                              type="button"
                              onClick={() => handleComplete(t.id, t.ticket_number)}
                              disabled={busy}
                              className="min-h-[44px] min-w-[90px] bg-[#FBF9F5] px-5 py-2 font-mono text-xs font-bold tracking-wider text-[#0A0A0A] uppercase transition-colors hover:bg-white disabled:opacity-40"
                            >
                              Done
                            </button>
                          ) : (
                            <span className="flex min-h-[44px] items-center border border-[#262626] bg-[#111111] px-4 font-mono text-xs text-neutral-500">
                              {servingOp?.counter_name || "Busy"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Physical On-Deck Zone (Top N slots) */}
            <section className="border border-[#262626] bg-[#111111] p-5">
              <div className="flex flex-wrap items-baseline justify-between border-b border-[#262626] pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  <h2 className="font-mono text-xs font-bold tracking-wider uppercase text-[#FBF9F5]">
                    Physical On-Deck Zone (Top {dynamicBuffer})
                  </h2>
                </div>
                <span className="font-mono text-[10px] text-neutral-400">IMMEDIATE STAGING LINE</span>
              </div>

              {onDeckTickets.length === 0 ? (
                <p className="mt-6 py-4 text-center font-mono text-xs text-neutral-500">
                  No visitors in the on-deck buffer.
                </p>
              ) : (
                <div className="mt-4 divide-y divide-[#262626]">
                  {onDeckTickets.map((t, idx) => (
                    <div key={t.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                      <div className="flex items-baseline gap-4">
                        <span className="w-8 font-mono text-xs font-bold text-neutral-400">P{idx + 1}</span>
                        <span className="font-mono text-2xl font-bold text-[#FBF9F5]">#{t.ticket_number}</span>
                        <div>
                          <p className="font-mono text-sm font-semibold text-[#FBF9F5]">{t.full_name}</p>
                          <div className="flex items-center gap-2 font-mono text-[10px] text-neutral-400">
                            <span>{t.phone_number || "No phone"}</span>
                            <span>·</span>
                            <span>Waited {formatWait(t.created_at, now)}</span>
                            {t.strikes > 0 && (
                              <span className="text-amber-400">({t.strikes}/{MAX_STRIKES} strikes)</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Per-row inline controls */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAbsent(t.id, t.ticket_number, t.strikes)}
                          disabled={busy}
                          className="min-h-[44px] min-w-[85px] border border-amber-600/60 bg-transparent px-3 py-2 font-mono text-xs font-bold tracking-wider text-amber-400 uppercase transition-colors hover:bg-amber-600/10 disabled:opacity-40"
                        >
                          Absent
                        </button>
                        <button
                          type="button"
                          onClick={() => handleServe(t.id, t.ticket_number)}
                          disabled={busy}
                          className="min-h-[44px] min-w-[85px] bg-[#FBF9F5] px-4 py-2 font-mono text-xs font-bold tracking-wider text-[#0A0A0A] uppercase transition-colors hover:bg-white disabled:opacity-40"
                        >
                          Serve
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Off-Premise Zone */}
            <section className="border border-[#262626] bg-[#111111] p-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#262626] pb-3">
                <h2 className="font-mono text-xs font-bold tracking-wider uppercase text-neutral-300">
                  Off-Premise Zone ({waitingTickets.length > dynamicBuffer ? waitingTickets.length - dynamicBuffer : 0})
                </h2>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or #…"
                  className="h-9 w-48 border border-[#262626] bg-[#0A0A0A] px-3 font-mono text-xs text-[#FBF9F5] outline-none placeholder:text-neutral-600 focus:border-[#FBF9F5]"
                />
              </div>

              {offPremiseTickets.length === 0 ? (
                <p className="mt-6 py-4 text-center font-mono text-xs text-neutral-500">
                  No visitors waiting off-premise.
                </p>
              ) : (
                <div className="mt-4 divide-y divide-[#262626]">
                  {offPremiseTickets.map((t, idx) => (
                    <div key={t.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                      <div className="flex items-baseline gap-4">
                        <span className="w-8 font-mono text-xs text-neutral-500">
                          P{idx + dynamicBuffer + 1}
                        </span>
                        <span className="font-mono text-lg font-bold text-neutral-300">#{t.ticket_number}</span>
                        <div>
                          <p className="font-mono text-sm font-medium text-[#FBF9F5]">{t.full_name}</p>
                          <p className="font-mono text-[10px] text-neutral-500">
                            Waited {formatWait(t.created_at, now)}
                            {t.strikes > 0 && ` · Strike ${t.strikes}/${MAX_STRIKES}`}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAbsent(t.id, t.ticket_number, t.strikes)}
                          disabled={busy}
                          className="min-h-[44px] min-w-[85px] border border-amber-600/40 bg-transparent px-3 py-2 font-mono text-xs font-bold tracking-wider text-amber-500 uppercase hover:bg-amber-600/10 disabled:opacity-40"
                        >
                          Absent
                        </button>
                        <button
                          type="button"
                          onClick={() => handleServe(t.id, t.ticket_number)}
                          disabled={busy}
                          className="min-h-[44px] min-w-[85px] border border-neutral-600 bg-transparent px-4 py-2 font-mono text-xs font-bold tracking-wider text-[#FBF9F5] uppercase hover:bg-neutral-800 disabled:opacity-40"
                        >
                          Serve
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Sidebar / Intake & Info */}
          <aside className="space-y-6">
            <div className="border border-[#262626] bg-[#111111] p-5">
              <span className="font-mono text-xs font-bold tracking-wider text-neutral-300 uppercase">
                Intake QR Code
              </span>
              <div className="mt-4 border border-[#262626] bg-white p-3">
                {qr ? (
                  <img src={qr} alt="Scan to join queue" className="w-full" />
                ) : (
                  <div className="aspect-square bg-neutral-900" />
                )}
              </div>
              <a
                href={`/join/${queueId}`}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block truncate font-mono text-xs text-neutral-400 hover:text-[#FBF9F5]"
              >
                /join/{queueId} ↗
              </a>
              <button
                type="button"
                onClick={() => window.print()}
                className="mt-4 min-h-[44px] w-full border border-[#262626] font-mono text-xs font-semibold text-[#FBF9F5] uppercase hover:bg-[#262626]"
              >
                Print Venue Sign
              </button>
            </div>

            <div className="border border-[#262626] bg-[#111111] p-5">
              <span className="font-mono text-xs font-bold tracking-wider text-neutral-300 uppercase">
                Engine Status
              </span>
              <dl className="mt-3 space-y-3 font-mono text-xs">
                <div className="flex justify-between border-b border-[#262626] pb-2">
                  <dt className="text-neutral-400">Intake Mode</dt>
                  <dd className={open ? "text-emerald-400" : "text-amber-400"}>
                    {open ? "OPEN" : "PAUSED"}
                  </dd>
                </div>
                <div className="flex justify-between border-b border-[#262626] pb-2">
                  <dt className="text-neutral-400">Active Clerks</dt>
                  <dd className="text-[#FBF9F5]">{Math.max(1, Math.round((dynamicBuffer - 2) / 3))}</dd>
                </div>
                <div className="flex justify-between border-b border-[#262626] pb-2">
                  <dt className="text-neutral-400">Buffer Formula</dt>
                  <dd className="text-neutral-400">(Clerks × 3) + 2</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-neutral-400">Strike Limit</dt>
                  <dd className="text-[#E5484D]">{MAX_STRIKES} Strikes</dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
