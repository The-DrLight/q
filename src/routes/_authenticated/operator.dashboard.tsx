import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { LivePulse } from "@/components/LivePulse";
import { CreateQueueModal } from "@/components/CreateQueueModal";
import { DEFAULT_BUFFER_SIZE, MAX_STRIKES, formatWait } from "@/lib/q";
import { downloadVenuePoster } from "@/lib/poster-generator";

export const Route = createFileRoute("/_authenticated/operator/dashboard")({
  head: () => ({
    meta: [
      { title: "Operator Console — Q" },
      { name: "description", content: "Mobile-first inline operator controls and venue desk management." },
      { property: "og:title", content: "Operator Console — Q" },
      { property: "og:description", content: "Mobile-first inline operator controls and venue desk management." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

type Operator = { id: string; email: string; queue_id: string | null; counter_name: string; role: string };
type Queue = { id: string; venue_name: string; title: string; status: string; expires_at?: string | null };
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
  const [operatorsList, setOperatorsList] = useState<Array<{ id: string; email: string; counter_name: string; role: string }>>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [dynamicBuffer, setDynamicBuffer] = useState<number>(DEFAULT_BUFFER_SIZE);
  const [mobileTab, setMobileTab] = useState<"queue" | "qr">("queue");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

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
  const joinUrl = queueId ? `https://queue-engine.vercel.app/join/${queueId}` : "";

  const load = useCallback(async () => {
    if (!queueId) return;
    const [{ data: q }, { data: ts }, { data: ops }, { data: bufSize }] = await Promise.all([
      supabase.from("queues").select("id,venue_name,title,status,expires_at").eq("id", queueId).maybeSingle(),
      supabase
        .from("tickets")
        .select("id,ticket_number,full_name,phone_number,status,strikes,sort_order,serving_operator_id,created_at,served_at")
        .eq("queue_id", queueId)
        .in("status", ["WAITING", "SERVING"])
        .order("sort_order", { ascending: true }),
      supabase.from("operators").select("id,email,counter_name,role").eq("queue_id", queueId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.rpc as any)("get_dynamic_buffer_size", { p_queue_id: queueId }),
    ]);

    if (q) setQueue(q);
    setTickets((ts as Ticket[]) ?? []);

    if (ops) {
      setOperatorsList(ops);
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
    import("qrcode").then((m) =>
      m.toDataURL(joinUrl, { margin: 1, width: 400, color: { dark: "#111111", light: "#FFFFFF" } }).then(setQr),
    );
  }, [queueId, joinUrl]);

  // Operator Actions
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
        toast.warning(`#${ticketNumber} absent (Strike ${nextStrikes}/3) · bumped behind buffer`);
      }
    }
    load();
  }

  async function handleInviteClerk(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || !queueId) return;
    setInviting(true);
    const { error } = await supabase.from("operator_invitations").insert({
      queue_id: queueId,
      email: inviteEmail.trim().toLowerCase(),
    });
    setInviting(false);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Invitation sent to ${inviteEmail.trim()}`);
      setInviteEmail("");
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/operator/login" });
  }

  const waitingTickets = useMemo(() => tickets.filter((t) => t.status === "WAITING"), [tickets]);
  const servingTickets = useMemo(() => tickets.filter((t) => t.status === "SERVING"), [tickets]);
  const onDeckTickets = useMemo(() => waitingTickets.slice(0, dynamicBuffer), [waitingTickets, dynamicBuffer]);
  const offPremiseTickets = useMemo(() => {
    const list = waitingTickets.slice(dynamicBuffer);
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((t) => t.full_name.toLowerCase().includes(q) || String(t.ticket_number).includes(q));
  }, [waitingTickets, dynamicBuffer, search]);

  // Loading state
  if (op === undefined) {
    return (
      <main className="min-h-screen bg-[#FBF9F5] p-8 text-[#111111]">
        <div className="mx-auto max-w-5xl">
          <p className="font-mono text-xs text-[#666666]">Connecting to operator desk…</p>
        </div>
      </main>
    );
  }

  // Empty state: No active queue
  if (!op || !op.queue_id) {
    return (
      <main className="min-h-screen bg-[#FBF9F5] text-[#111111] p-6 md:p-12">
        <div className="mx-auto max-w-2xl border border-[#E8E5DF] bg-[#FFFFFF] p-8 md:p-12 shadow-sm text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center border border-[#E8E5DF] bg-[#FBF9F5]">
            <span className="font-mono text-2xl font-bold text-[#111111]">Q</span>
          </div>
          <h1 className="mt-6 font-mono text-2xl font-bold text-[#111111]">Welcome to Q Console</h1>
          <p className="mt-3 text-sm text-[#666666] leading-relaxed max-w-md mx-auto">
            You do not have an active queue right now. Deploy a new queue to get a live QR code and start calling visitors.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="inline-flex min-h-[44px] items-center bg-[#111111] px-6 font-mono text-xs font-bold uppercase tracking-wider text-[#FBF9F5] transition-colors hover:bg-neutral-800"
            >
              + Create Your First Queue
            </button>
            <button
              onClick={signOut}
              className="inline-flex min-h-[44px] items-center border border-[#E8E5DF] bg-[#FFFFFF] px-6 font-mono text-xs font-semibold text-[#666666] hover:text-[#111111]"
            >
              Sign Out
            </button>
          </div>
        </div>

        <CreateQueueModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSuccess={() => {
            window.location.reload();
          }}
        />
      </main>
    );
  }

  const open = queue?.status === "OPEN";

  return (
    <main className="min-h-screen bg-[#FBF9F5] text-[#111111]">
      {/* Top Header */}
      <header className="sticky top-0 z-30 border-b border-[#E8E5DF] bg-[#FBF9F5]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="font-mono text-2xl font-black tracking-tighter text-[#111111]">
              Q
            </Link>
            <div className="h-4 w-px bg-[#E8E5DF]" />
            <div>
              <p className="truncate font-mono text-sm font-bold text-[#111111]">{queue?.title}</p>
              <p className="font-mono text-xs text-[#666666]">
                {op.counter_name} • {op.email}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Engine Indicator */}
            <div className="hidden sm:flex items-center gap-2 border border-[#E8E5DF] bg-[#FFFFFF] px-3.5 py-1.5 font-mono text-xs">
              <span className="text-[#666666]">Waiting:</span>
              <span className="font-bold text-[#111111]">{waitingTickets.length}</span>
              <span className="mx-1 text-[#E8E5DF]">|</span>
              <span className="text-[#666666]">Buffer:</span>
              <span className="font-bold text-[#111111]">{dynamicBuffer}</span>
            </div>

            <Link
              to="/display/$queueId"
              params={{ queueId: op.queue_id }}
              target="_blank"
              className="inline-flex min-h-[44px] items-center border border-[#E8E5DF] bg-[#FFFFFF] px-3.5 py-2 font-mono text-xs font-semibold uppercase tracking-wider text-[#111111] hover:bg-[#F4F1EA]"
              title="Launch TV Waiting Room View"
            >
              Lobby TV ↗
            </Link>

            <button
              onClick={signOut}
              className="min-h-[44px] px-3 font-mono text-xs font-medium text-[#666666] hover:text-[#111111]"
            >
              Exit
            </button>
          </div>
        </div>
      </header>

      {/* Mobile-Only Segmented Tabs */}
      <div className="block md:hidden border-b border-[#E8E5DF] bg-[#FFFFFF]">
        <div className="grid grid-cols-2">
          <button
            type="button"
            onClick={() => setMobileTab("queue")}
            className={`min-h-[48px] font-mono text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
              mobileTab === "queue"
                ? "border-[#111111] text-[#111111]"
                : "border-transparent text-[#666666] hover:text-[#111111]"
            }`}
          >
            Queue ({waitingTickets.length})
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("qr")}
            className={`min-h-[48px] font-mono text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
              mobileTab === "qr"
                ? "border-[#111111] text-[#111111]"
                : "border-transparent text-[#666666] hover:text-[#111111]"
            }`}
          >
            Venue QR & Poster
          </button>
        </div>
      </div>

      {/* Main 2-Column Responsive Layout */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:px-8">
        <div className="grid gap-8 md:grid-cols-[65%_35%]">
          {/* LEFT COLUMN: The Live Queue Hopper */}
          <div className={`space-y-8 ${mobileTab === "qr" ? "hidden md:block" : "block"}`}>
            {/* Currently Serving Section */}
            {servingTickets.length > 0 && (
              <section className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 shadow-sm">
                <div className="flex items-center justify-between border-b border-[#E8E5DF] pb-4">
                  <div className="flex items-center gap-2">
                    <LivePulse tone="success" />
                    <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#30A46C]">
                      Currently Serving ({servingTickets.length})
                    </h2>
                  </div>
                  <span className="font-mono text-[10px] text-[#666666] uppercase">Active Counters</span>
                </div>

                <div className="mt-5 space-y-4">
                  {servingTickets.map((t) => {
                    const isMyTicket = t.serving_operator_id === op.id;
                    const servingOp = t.serving_operator_id ? operatorsMap[t.serving_operator_id] : null;

                    return (
                      <div
                        key={t.id}
                        className={`flex flex-wrap items-center justify-between gap-4 border p-5 ${
                          isMyTicket ? "border-[#30A46C] bg-[#30A46C]/5" : "border-[#E8E5DF] bg-[#FBF9F5]"
                        }`}
                      >
                        <div className="flex items-baseline gap-5">
                          <span className="font-mono text-4xl font-extrabold text-[#111111]">
                            #{String(t.ticket_number).padStart(3, "0")}
                          </span>
                          <div>
                            <p className="font-mono text-lg font-bold text-[#111111]">{t.full_name}</p>
                            <p className="font-mono text-xs text-[#666666]">
                              {isMyTicket ? "Assigned to your counter" : `At ${servingOp?.counter_name || "Counter"}`}
                              {t.served_at && ` • ${formatWait(t.served_at, now)}`}
                            </p>
                          </div>
                        </div>

                        {/* Tactile 44px+ controls */}
                        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                          <button
                            type="button"
                            onClick={() => handleAbsent(t.id, t.ticket_number, t.strikes)}
                            disabled={busy}
                            className="min-h-[44px] flex-1 sm:flex-initial px-4 py-2 border border-[#E5484D] font-mono text-xs font-bold uppercase tracking-wider text-[#E5484D] transition-colors hover:bg-[#E5484D]/10 disabled:opacity-40"
                          >
                            Absent
                          </button>

                          {isMyTicket ? (
                            <button
                              type="button"
                              onClick={() => handleComplete(t.id, t.ticket_number)}
                              disabled={busy}
                              className="min-h-[44px] flex-1 sm:flex-initial px-6 py-2 bg-[#111111] font-mono text-xs font-bold uppercase tracking-wider text-[#FBF9F5] transition-colors hover:bg-neutral-800 disabled:opacity-40"
                            >
                              Done
                            </button>
                          ) : (
                            <span className="flex min-h-[44px] items-center border border-[#E8E5DF] bg-[#FFFFFF] px-4 font-mono text-xs text-[#666666]">
                              {servingOp?.counter_name || "In Progress"}
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
            <section className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 shadow-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#E8E5DF] pb-4">
                <div className="flex items-center gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-[#F76B15]" />
                  <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#111111]">
                    Physical On-Deck Zone (Top {dynamicBuffer})
                  </h2>
                </div>
                <span className="font-mono text-[10px] text-[#666666] uppercase">
                  Standing directly in front of counters
                </span>
              </div>

              {onDeckTickets.length === 0 ? (
                <p className="mt-8 py-6 text-center font-mono text-xs text-[#666666]">
                  No visitors currently in the physical on-deck staging buffer.
                </p>
              ) : (
                <div className="mt-4 divide-y divide-[#E8E5DF]">
                  {onDeckTickets.map((t, idx) => (
                    <div key={t.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
                      <div className="flex items-baseline gap-4">
                        <span className="w-8 font-mono text-xs font-bold text-[#666666]">P{idx + 1}</span>
                        <span className="font-mono text-2xl font-bold text-[#111111]">
                          #{String(t.ticket_number).padStart(3, "0")}
                        </span>
                        <div>
                          <p className="font-mono text-sm font-bold text-[#111111]">{t.full_name}</p>
                          <div className="flex items-center gap-2 font-mono text-[11px] text-[#666666]">
                            <span>{t.phone_number || "No phone"}</span>
                            <span>•</span>
                            <span>Waited {formatWait(t.created_at, now)}</span>
                            {t.strikes > 0 && (
                              <span className="text-[#E5484D] font-bold">({t.strikes}/{MAX_STRIKES} strikes)</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Per-row inline controls */}
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <button
                          type="button"
                          onClick={() => handleAbsent(t.id, t.ticket_number, t.strikes)}
                          disabled={busy}
                          className="min-h-[44px] flex-1 sm:flex-initial px-4 py-2 border border-[#E5484D] font-mono text-xs font-bold uppercase tracking-wider text-[#E5484D] transition-colors hover:bg-[#E5484D]/10 disabled:opacity-40"
                        >
                          Absent
                        </button>
                        <button
                          type="button"
                          onClick={() => handleServe(t.id, t.ticket_number)}
                          disabled={busy}
                          className="min-h-[44px] flex-1 sm:flex-initial px-6 py-2 bg-[#111111] font-mono text-xs font-bold uppercase tracking-wider text-[#FBF9F5] transition-colors hover:bg-neutral-800 disabled:opacity-40"
                        >
                          Serve
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Off-Premise Free Roam Zone */}
            <section className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E8E5DF] pb-4">
                <div>
                  <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#666666]">
                    Off-Premise Free Roam ({offPremiseTickets.length})
                  </h2>
                  <p className="font-mono text-[10px] text-[#666666] mt-0.5">
                    Position {dynamicBuffer + 1}+ waiting freely outside the hall
                  </p>
                </div>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or #…"
                  className="h-10 w-48 border border-[#E8E5DF] bg-[#FBF9F5] px-3 font-mono text-xs text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#111111]"
                />
              </div>

              {offPremiseTickets.length === 0 ? (
                <p className="mt-8 py-4 text-center font-mono text-xs text-[#666666]">
                  No visitors waiting in the off-premise zone.
                </p>
              ) : (
                <div className="mt-4 divide-y divide-[#E8E5DF]">
                  {offPremiseTickets.map((t, idx) => (
                    <div key={t.id} className="flex flex-wrap items-center justify-between gap-4 py-3.5">
                      <div className="flex items-baseline gap-4">
                        <span className="w-8 font-mono text-xs text-[#666666]">
                          P{idx + dynamicBuffer + 1}
                        </span>
                        <span className="font-mono text-lg font-bold text-[#111111]">
                          #{String(t.ticket_number).padStart(3, "0")}
                        </span>
                        <div>
                          <p className="font-mono text-sm font-semibold text-[#111111]">{t.full_name}</p>
                          <p className="font-mono text-[10px] text-[#666666]">
                            Waited {formatWait(t.created_at, now)}
                            {t.strikes > 0 && ` • Strike ${t.strikes}/${MAX_STRIKES}`}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleAbsent(t.id, t.ticket_number, t.strikes)}
                          disabled={busy}
                          className="min-h-[44px] px-3 py-2 border border-[#E5484D]/60 font-mono text-xs font-semibold uppercase text-[#E5484D] hover:bg-[#E5484D]/10 disabled:opacity-40"
                        >
                          Absent
                        </button>
                        <button
                          type="button"
                          onClick={() => handleServe(t.id, t.ticket_number)}
                          disabled={busy}
                          className="min-h-[44px] px-4 py-2 border border-[#111111] font-mono text-xs font-bold uppercase text-[#111111] hover:bg-[#F4F1EA] disabled:opacity-40"
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

          {/* RIGHT COLUMN: Venue Control & QR Sign */}
          <div className={`space-y-6 ${mobileTab === "queue" ? "hidden md:block" : "block"}`}>
            {/* Printable QR Code Poster Card */}
            <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 shadow-sm">
              <div className="flex items-baseline justify-between border-b border-[#E8E5DF] pb-3">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#111111]">
                  Intake Signage
                </span>
                <span className="font-mono text-[10px] text-[#30A46C] font-semibold">A4 / Poster Ready</span>
              </div>

              <div className="mt-5 border border-[#E8E5DF] bg-[#FBF9F5] p-4 text-center">
                {qr ? (
                  <img src={qr} alt="Scan to join queue" className="mx-auto w-56 h-56 object-contain" />
                ) : (
                  <div className="mx-auto w-56 h-56 bg-neutral-200" />
                )}
                <a
                  href={joinUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block truncate font-mono text-xs font-medium text-[#111111] hover:underline"
                >
                  {joinUrl} ↗
                </a>
              </div>

              <div className="mt-5 space-y-3">
                <button
                  type="button"
                  onClick={() => queue && downloadVenuePoster(queue.title, joinUrl)}
                  className="min-h-[44px] w-full bg-[#111111] font-mono text-xs font-bold uppercase tracking-wider text-[#FBF9F5] transition-colors hover:bg-neutral-800"
                >
                  Download Printable Sign (PNG)
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="min-h-[44px] w-full border border-[#E8E5DF] bg-[#FFFFFF] font-mono text-xs font-semibold uppercase text-[#111111] hover:bg-[#F4F1EA]"
                >
                  Print Direct
                </button>
              </div>
            </div>

            {/* Queue Engine Telemetry */}
            <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 shadow-sm">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#111111]">
                Queue Engine State
              </span>
              <dl className="mt-4 space-y-3 font-mono text-xs">
                <div className="flex justify-between border-b border-[#E8E5DF] pb-2">
                  <dt className="text-[#666666]">Intake Status</dt>
                  <dd className={open ? "text-[#30A46C] font-bold" : "text-[#F76B15] font-bold"}>
                    {open ? "OPEN" : "PAUSED"}
                  </dd>
                </div>
                <div className="flex justify-between border-b border-[#E8E5DF] pb-2">
                  <dt className="text-[#666666]">Active Operators</dt>
                  <dd className="text-[#111111] font-bold">
                    {Math.max(1, Math.round((dynamicBuffer - 2) / 3))} Online
                  </dd>
                </div>
                <div className="flex justify-between border-b border-[#E8E5DF] pb-2">
                  <dt className="text-[#666666]">Dynamic Buffer</dt>
                  <dd className="text-[#111111] font-bold">Top {dynamicBuffer}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-[#666666]">Absence Limit</dt>
                  <dd className="text-[#E5484D] font-bold">{MAX_STRIKES} Strikes</dd>
                </div>
              </dl>
            </div>

            {/* Operator Invitations Manager */}
            <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 shadow-sm">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#111111]">
                Desk Clerks & Access
              </span>
              <form onSubmit={handleInviteClerk} className="mt-4">
                <div className="flex gap-2">
                  <input
                    type="email"
                    required
                    placeholder="clerk@venue.org"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    className="h-10 flex-1 border border-[#E8E5DF] bg-[#FBF9F5] px-3 font-mono text-xs text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#111111]"
                  />
                  <button
                    type="submit"
                    disabled={inviting || !inviteEmail.trim()}
                    className="h-10 bg-[#111111] px-4 font-mono text-xs font-bold uppercase text-[#FBF9F5] disabled:opacity-40 hover:bg-neutral-800"
                  >
                    {inviting ? "…" : "Invite"}
                  </button>
                </div>
              </form>

              <div className="mt-4 divide-y divide-[#E8E5DF]">
                {operatorsList.map((clerk) => (
                  <div key={clerk.id} className="flex justify-between py-2.5 font-mono text-xs">
                    <span className="truncate pr-2 text-[#111111]">{clerk.email}</span>
                    <span className="text-[#666666] shrink-0">{clerk.counter_name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
