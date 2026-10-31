import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { LivePulse } from "@/components/LivePulse";
import { CreateQueueModal } from "@/components/CreateQueueModal";
import { DEFAULT_BUFFER_SIZE, MAX_STRIKES, formatWait } from "@/lib/q";
import { downloadVenuePoster } from "@/lib/poster-generator";

export const Route = createFileRoute("/_authenticated/operator/dashboard")({
  validateSearch: (search: Record<string, unknown>): { queueId?: string | undefined } => {
    return {
      queueId: typeof search["queueId"] === "string" ? search["queueId"] : undefined,
    };
  },
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
type Queue = { id: string; venue_name: string; title: string; status: string; expires_at?: string | null; last_activity_at?: string | null };
type MyQueue = {
  queue_id: string;
  title: string;
  venue_name: string;
  status: string;
  waiting_count: number;
  serving_count: number;
  role: string;
  last_activity_at: string | null;
  expires_at: string | null;
  created_at: string | null;
};
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
  const searchParams = Route.useSearch();
  const [op, setOp] = useState<Operator | null | undefined>(undefined);
  const [myQueues, setMyQueues] = useState<MyQueue[]>([]);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(searchParams.queueId ?? null);
  const [queue, setQueue] = useState<Queue | null>(null);
  const [operatorsMap, setOperatorsMap] = useState<Record<string, { email: string; counter_name: string }>>({});
  const [operatorsList, setOperatorsList] = useState<Array<{ id: string; email: string; counter_name: string; role: string }>>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [search, setSearch] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [dynamicBuffer, setDynamicBuffer] = useState<number>(DEFAULT_BUFFER_SIZE);
  const [mobileTab, setMobileTab] = useState<"queue" | "qr" | "hub">("queue");
  const [showHubModal, setShowHubModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  // Fetch operator and multi-queue list
  const loadMyQueues = useCallback(async () => {
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) return;

    // Load operator record
    const { data: o } = await supabase.from("operators").select("*").eq("id", authUser.id).maybeSingle();
    setOp(o ?? null);

    // Call RPC get_my_queues
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: qList, error } = await (supabase.rpc as any)("get_my_queues");
    if (!error && qList && Array.isArray(qList)) {
      const sanitized = qList.map((mq: MyQueue) => ({
        ...mq,
        status: mq.status || "OPEN",
      }));
      setMyQueues(sanitized as MyQueue[]);

      // Determine active queue:
      // Priority 1: URL search param
      // Priority 2: already selected activeQueueId
      // Priority 3: first queue from get_my_queues
      // Priority 4: operator's legacy queue_id
      setActiveQueueId((curr) => {
        if (searchParams.queueId) return searchParams.queueId;
        if (curr && sanitized.some((q: MyQueue) => q.queue_id === curr)) return curr;
        if (sanitized.length > 0 && sanitized[0]) return sanitized[0].queue_id;
        return o?.queue_id ?? null;
      });
    } else {
      // Fallback: load directly from queues if RPC not yet deployed
      if (o?.queue_id) {
        const { data: singleQ } = await supabase.from("queues").select("*").eq("id", o.queue_id).maybeSingle();
        if (singleQ) {
          const fallbackMyQ: MyQueue = {
            queue_id: singleQ.id,
            title: singleQ.title,
            venue_name: singleQ.venue_name,
            status: singleQ.status || "OPEN",
            waiting_count: 0,
            serving_count: 0,
            role: o.role || "ADMIN",
            last_activity_at: singleQ.last_activity_at,
            expires_at: singleQ.expires_at,
            created_at: singleQ.created_at,
          };
          setMyQueues([fallbackMyQ]);
          setActiveQueueId((curr) => curr ?? singleQ.id);
        }
      }
    }
  }, [searchParams.queueId]);

  useEffect(() => {
    loadMyQueues();
  }, [loadMyQueues]);

  // Sync URL when active queue changes
  const switchQueue = (newQId: string) => {
    setActiveQueueId(newQId);
    navigate({
      to: "/operator/dashboard",
      search: { queueId: newQId },
      replace: true,
    });
  };

  // Sanitize activeQueueId so we never construct undefined/null URLs
  const cleanQueueId = activeQueueId && activeQueueId !== "undefined" && activeQueueId !== "null" ? activeQueueId.trim() : null;
  const joinUrl = cleanQueueId ? `https://queue-engine.vercel.app/join/${cleanQueueId}` : "";

  // Load active queue data (tickets, operators, dynamic buffer)
  const load = useCallback(async () => {
    if (!activeQueueId) return;
    const cleanId = activeQueueId.trim();

    console.log("Fetching tickets for queue:", cleanId);
    const [{ data: q }, { data: ts, error: tsError }, { data: ops }, { data: bufSize }] = await Promise.all([
      supabase.from("queues").select("id,venue_name,title,status,expires_at,last_activity_at").eq("id", cleanId).maybeSingle(),
      supabase
        .from("tickets")
        .select("id,ticket_number,full_name,phone_number,status,strikes,sort_order,serving_operator_id,created_at,served_at")
        .eq("queue_id", cleanId)
        .in("status", ["WAITING", "waiting", "SERVING", "serving"])
        .order("sort_order", { ascending: true }),
      supabase.from("operators").select("id,email,counter_name,role").eq("queue_id", cleanId),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.rpc as any)("get_dynamic_buffer_size", { p_queue_id: cleanId }),
    ]);

    if (tsError) {
      console.error("Failed to load hopper tickets:", tsError);
    }
    console.log("Raw tickets retrieved:", ts);

    if (q) {
      setQueue({
        ...q,
        status: q.status || "OPEN",
      });
    }
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
  }, [activeQueueId]);

  useEffect(() => {
    if (!activeQueueId) return;
    const cleanId = activeQueueId.trim();
    load();
    const ch = supabase
      .channel(`desk-${cleanId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tickets", filter: `queue_id=eq.${cleanId}` },
        (payload) => {
          console.log("Realtime ticket change detected:", payload);
          load();
          loadMyQueues();
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "queues", filter: `id=eq.${cleanId}` },
        () => load()
      )
      .subscribe();
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      supabase.removeChannel(ch);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [activeQueueId, load, loadMyQueues]);

  useEffect(() => {
    if (!activeQueueId) return;
    import("qrcode").then((m) =>
      m.toDataURL(joinUrl, { margin: 1, width: 400, color: { dark: "#111111", light: "#FFFFFF" } }).then(setQr),
    );
  }, [activeQueueId, joinUrl]);

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
    loadMyQueues();
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
    loadMyQueues();
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
        toast.error(`#${ticketNumber} marked absent (Revoked after 3 strikes)`);
      } else {
        toast.warning(`#${ticketNumber} marked absent (Strike ${nextStrikes}/3 — Bumped behind top ${dynamicBuffer})`);
      }
    }
    load();
    loadMyQueues();
  }

  async function handleToggleIntake() {
    if (!queue || busy || !activeQueueId) return;
    const currentStatus = queue.status || "OPEN";
    const nextStatus = currentStatus === "OPEN" ? "PAUSED" : "OPEN";
    setBusy(true);

    // Optimistically update
    setQueue({ ...queue, status: nextStatus });
    setMyQueues((prev) =>
      prev.map((mq) => (mq.queue_id === activeQueueId ? { ...mq, status: nextStatus } : mq))
    );

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("set_queue_intake_status", {
        p_queue_id: activeQueueId,
        p_status: nextStatus,
      });

      if (error) {
        // Fallback to direct table update
        const { error: directError } = await supabase
          .from("queues")
          .update({ status: nextStatus })
          .eq("id", activeQueueId);
        if (directError) throw directError;
      }

      toast.success(`Queue intake is now ${nextStatus}`);
    } catch (err: unknown) {
      // Revert optimistic update
      setQueue({ ...queue, status: currentStatus });
      setMyQueues((prev) =>
        prev.map((mq) => (mq.queue_id === activeQueueId ? { ...mq, status: currentStatus } : mq))
      );
      toast.error(err instanceof Error ? err.message : "Failed to update intake status");
    } finally {
      setBusy(false);
      loadMyQueues();
    }
  }

  async function handleBufferChange(newBuffer: number) {
    if (!activeQueueId || busy) return;
    const onlineOps = Math.max(1, operatorsList.length > 0 ? operatorsList.length : 1);
    const formulaFloor = onlineOps * 3 + 2;

    if (newBuffer < formulaFloor) return;
    if (newBuffer > 30) return;

    const previousBuffer = dynamicBuffer;
    setDynamicBuffer(newBuffer);

    try {
      // Call RPC set_queue_buffer_override
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("set_queue_buffer_override", {
        p_queue_id: activeQueueId,
        p_buffer: newBuffer <= formulaFloor ? null : newBuffer,
      });

      if (error) {
        // Fallback to direct update on queues
        await supabase
          .from("queues")
          .update({ buffer_override: newBuffer <= formulaFloor ? null : newBuffer })
          .eq("id", activeQueueId);
      }
      toast.success(`Staging buffer updated to Top ${newBuffer}`);
    } catch (err) {
      setDynamicBuffer(previousBuffer);
      toast.error("Failed to update buffer size");
    }
  }

  async function handleInviteClerk(e: React.FormEvent) {
    e.preventDefault();
    if (!activeQueueId || !inviteEmail.trim() || inviting) return;
    setInviting(true);
    const emailToInvite = inviteEmail.trim().toLowerCase();

    // Insert into operator_invitations
    const { error } = await supabase
      .from("operator_invitations")
      .insert({ queue_id: activeQueueId, email: emailToInvite });

    setInviting(false);
    if (error) {
      if (error.code === "23505") {
        toast.error("This email is already invited to this queue.");
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success(`Invitation recorded for ${emailToInvite}`);
      setInviteEmail("");
    }
  }

  async function handleDeleteQueue(queueId: string) {
    if (!confirm("Are you sure you want to delete this queue? All active and historical tickets will be removed.")) {
      return;
    }

    try {
      // Call the dedicated delete_queue RPC
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("delete_queue", {
        p_queue_id: queueId,
      });

      if (error) {
        // Fallback to direct delete if RPC not yet picked up
        const { error: directError } = await supabase
          .from("queues")
          .delete()
          .eq("id", queueId);
        if (directError) throw directError;
      }

      toast.success("Queue deleted successfully.");

      // Update local state: remove from managed queues list
      setMyQueues((prev) => prev.filter((q) => q.queue_id !== queueId));

      // If deleted queue was the currently active console queue, switch to another or clear
      if (activeQueueId === queueId) {
        const remaining = myQueues.filter((q) => q.queue_id !== queueId);
        if (remaining.length > 0 && remaining[0]) {
          switchQueue(remaining[0].queue_id);
        } else {
          setActiveQueueId(null);
        }
      }

      loadMyQueues();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : "Failed to delete queue";
      toast.error(errorMsg);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  // Sieve tickets into groups (case-insensitive)
  const servingTickets = useMemo(
    () => tickets.filter((t) => t.status?.toUpperCase() === "SERVING"),
    [tickets]
  );
  const waitingTickets = useMemo(
    () => tickets.filter((t) => t.status?.toUpperCase() === "WAITING"),
    [tickets]
  );

  // Buffer separation based on dynamic buffer size
  const onDeckBuffer = useMemo(() => waitingTickets.slice(0, dynamicBuffer), [waitingTickets, dynamicBuffer]);
  const offPremiseRoam = useMemo(() => waitingTickets.slice(dynamicBuffer), [waitingTickets, dynamicBuffer]);

  const filteredOnDeck = useMemo(() => {
    if (!search || !search.trim()) return onDeckBuffer;
    const s = search.trim().toLowerCase();
    return onDeckBuffer.filter(
      (t) =>
        t.ticket_number.toString().includes(s) ||
        (t.full_name && t.full_name.toLowerCase().includes(s))
    );
  }, [onDeckBuffer, search]);

  const filteredRoam = useMemo(() => {
    if (!search || !search.trim()) return offPremiseRoam;
    const s = search.trim().toLowerCase();
    return offPremiseRoam.filter(
      (t) =>
        t.ticket_number.toString().includes(s) ||
        (t.full_name && t.full_name.toLowerCase().includes(s))
    );
  }, [offPremiseRoam, search]);

  // Loading indicator
  if (op === undefined) {
    return (
      <main className="min-h-screen bg-[#FBF9F5] p-8 text-[#111111]">
        <div className="mx-auto max-w-5xl">
          <p className="font-mono text-xs text-[#666666]">Connecting to operator desk…</p>
        </div>
      </main>
    );
  }

  // Empty state: No active queue found
  if (!activeQueueId || myQueues.length === 0) {
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
          onSuccess={(newId) => {
            loadMyQueues();
            if (newId) switchQueue(newId);
          }}
        />
      </main>
    );
  }

  const onlineOps = Math.max(1, operatorsList.length > 0 ? operatorsList.length : 1);
  const formulaFloor = onlineOps * 3 + 2;
  const open = (queue?.status || "OPEN") === "OPEN";

  return (
    <main className="min-h-screen bg-[#FBF9F5] text-[#111111]">
      {/* Top Header with Multi-Queue Switcher */}
      <header className="sticky top-0 z-30 border-b border-[#E8E5DF] bg-[#FBF9F5]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3 md:gap-4 flex-wrap">
            <Link to="/" className="font-mono text-2xl font-black tracking-tighter text-[#111111]">
              Q
            </Link>
            <div className="h-4 w-px bg-[#E8E5DF]" />

            {/* Multi-Queue Switcher Dropdown */}
            <div className="flex items-center gap-2">
              <select
                aria-label="Select Active Queue"
                value={activeQueueId}
                onChange={(e) => switchQueue(e.target.value)}
                className="h-9 border border-[#E8E5DF] bg-[#FFFFFF] px-3 font-mono text-xs font-bold text-[#111111] outline-none hover:border-[#111111] focus:border-[#111111] max-w-[220px] sm:max-w-xs truncate cursor-pointer shadow-xs"
              >
                {myQueues.map((mq) => (
                  <option key={mq.queue_id} value={mq.queue_id}>
                    {mq.title} ({mq.waiting_count})
                  </option>
                ))}
              </select>

              {/* + New Queue Action */}
              <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="h-9 px-3 border border-[#E8E5DF] bg-[#FFFFFF] font-mono text-xs font-semibold text-[#111111] hover:bg-[#F4F1EA] transition-colors"
                title="Create an additional queue"
              >
                + New Queue
              </button>

              {/* All Queues Overview Button */}
              <button
                type="button"
                onClick={() => setShowHubModal(true)}
                className="hidden sm:inline-flex h-9 px-3 border border-[#E8E5DF] bg-[#FFFFFF] font-mono text-xs font-semibold text-[#666666] hover:text-[#111111] hover:bg-[#F4F1EA] transition-colors"
              >
                All Queues ({myQueues.length})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Waiting & Dynamic Buffer Telemetry */}
            <div className="hidden sm:flex items-center gap-2 border border-[#E8E5DF] bg-[#FFFFFF] px-3.5 py-1.5 font-mono text-xs shadow-xs">
              <span className="text-[#666666]">Waiting:</span>
              <span className="font-bold text-[#111111]">{waitingTickets.length}</span>
              <span className="mx-1 text-[#E8E5DF]">|</span>
              <span className="text-[#666666]">Buffer:</span>
              <span className="font-bold text-[#111111]">{dynamicBuffer}</span>
            </div>

            {/* Lobby TV View */}
            <Link
              to="/display/$queueId"
              params={{ queueId: activeQueueId }}
              target="_blank"
              className="inline-flex min-h-[38px] items-center border border-[#E8E5DF] bg-[#FFFFFF] px-3 py-1.5 font-mono text-xs font-semibold uppercase tracking-wider text-[#111111] hover:bg-[#F4F1EA] transition-colors shadow-xs"
              title="Launch TV Waiting Room View"
            >
              Lobby TV ↗
            </Link>

            <button
              onClick={signOut}
              className="min-h-[38px] px-2.5 font-mono text-xs font-medium text-[#666666] hover:text-[#111111]"
            >
              Exit
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Segmented Tabs */}
      <div className="block md:hidden border-b border-[#E8E5DF] bg-[#FFFFFF]">
        <div className="grid grid-cols-3">
          <button
            type="button"
            onClick={() => setMobileTab("queue")}
            className={`min-h-[44px] font-mono text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
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
            className={`min-h-[44px] font-mono text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
              mobileTab === "qr"
                ? "border-[#111111] text-[#111111]"
                : "border-transparent text-[#666666] hover:text-[#111111]"
            }`}
          >
            Venue QR
          </button>
          <button
            type="button"
            onClick={() => setMobileTab("hub")}
            className={`min-h-[44px] font-mono text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
              mobileTab === "hub"
                ? "border-[#111111] text-[#111111]"
                : "border-transparent text-[#666666] hover:text-[#111111]"
            }`}
          >
            All Queues
          </button>
        </div>
      </div>

      {/* Main 2-Column Responsive Layout */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 md:px-8">
        {/* Mobile Hub Tab */}
        {mobileTab === "hub" && (
          <div className="block md:hidden mb-8">
            <h2 className="font-mono text-sm font-bold uppercase text-[#111111] mb-4">All Managed Queues</h2>
            <div className="space-y-4">
              {myQueues.map((mq) => (
                <div key={mq.queue_id} className="border border-[#E8E5DF] bg-[#FFFFFF] p-5 shadow-xs">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-mono text-sm font-bold text-[#111111]">{mq.title}</h3>
                      <p className="font-mono text-xs text-[#666666] mt-0.5">{mq.role} • {mq.status}</p>
                    </div>
                    <span className="font-mono text-xs font-bold bg-[#FBF9F5] border border-[#E8E5DF] px-2.5 py-1">
                      {mq.waiting_count} waiting
                    </span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        switchQueue(mq.queue_id);
                        setMobileTab("queue");
                      }}
                      className="flex-1 bg-[#111111] py-2 font-mono text-xs font-bold text-[#FBF9F5]"
                    >
                      Open
                    </button>
                    {mq.role === "ADMIN" && (
                      <button
                        type="button"
                        onClick={() => handleDeleteQueue(mq.queue_id)}
                        className="px-3 border border-[#E5484D] text-[#E5484D] font-mono text-xs font-bold"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-8 md:grid-cols-[65%_35%]">
          {/* LEFT COLUMN: The Live Queue Hopper */}
          <div className={`space-y-8 ${mobileTab === "qr" || mobileTab === "hub" ? "hidden md:block" : "block"}`}>
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
                    const isMyTicket = op ? t.serving_operator_id === op.id : false;
                    const servingOp = t.serving_operator_id ? operatorsMap[t.serving_operator_id] : null;

                    return (
                      <div
                        key={t.id}
                        className={`flex flex-wrap items-center justify-between gap-4 border p-5 ${
                          isMyTicket ? "border-[#30A46C] bg-[#30A46C]/5" : "border-[#E8E5DF] bg-[#FBF9F5]"
                        }`}
                      >
                        <div className="flex items-baseline gap-5">
                          <span className="font-mono text-3xl md:text-4xl font-extrabold tracking-tight text-[#111111]">
                            #{t.ticket_number}
                          </span>
                          <div>
                            <p className="font-mono text-base font-bold text-[#111111]">{t.full_name}</p>
                            <p className="font-mono text-xs text-[#666666] mt-0.5">
                              {servingOp ? `${servingOp.counter_name} (${servingOp.email})` : "Desk Clerk"} • Serving for{" "}
                              {formatWait(t.served_at, now)}
                            </p>
                          </div>
                        </div>

                        {/* Inline Operator Actions */}
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleAbsent(t.id, t.ticket_number, t.strikes)}
                            className="min-h-[44px] min-w-[90px] border border-[#E5484D] bg-[#FFFFFF] px-4 font-mono text-xs font-bold uppercase tracking-wider text-[#E5484D] transition-colors hover:bg-[#E5484D]/10"
                          >
                            Absent
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleComplete(t.id, t.ticket_number)}
                            className="min-h-[44px] min-w-[90px] bg-[#111111] px-5 font-mono text-xs font-bold uppercase tracking-wider text-[#FBF9F5] transition-colors hover:bg-neutral-800"
                          >
                            Done ✓
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Waiting Hopper: On-Deck Dynamic Buffer & Off-Premise Roam */}
            <section className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E8E5DF] pb-4">
                <div>
                  <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-[#111111]">
                    Queue Hopper ({waitingTickets.length} waiting)
                  </h2>
                  <p className="font-mono text-xs text-[#666666] mt-0.5">
                    Physical Staging Buffer: Top {dynamicBuffer} tickets
                  </p>
                </div>
                <input
                  type="text"
                  placeholder="Filter ticket or name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9 w-full sm:w-64 border border-[#E8E5DF] bg-[#FBF9F5] px-3 font-mono text-xs text-[#111111] outline-none placeholder:text-[#999999] focus:border-[#111111]"
                />
              </div>

              {/* Group A: On-Deck Physical Buffer */}
              <div className="mt-6">
                <div className="flex items-center justify-between border-b border-[#E8E5DF] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[#111111]" />
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#111111]">
                      On-Deck Staging Buffer (Top {dynamicBuffer})
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-[#30A46C] font-semibold">
                    Staged at Counters
                  </span>
                </div>

                <div className="mt-3 divide-y divide-[#E8E5DF]">
                  {filteredOnDeck.length === 0 ? (
                    <p className="py-6 text-center font-mono text-xs text-[#666666]">
                      {waitingTickets.length === 0 ? "The queue hopper is completely clear." : "No matching tickets in buffer."}
                    </p>
                  ) : (
                    filteredOnDeck.map((t, idx) => (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3.5 transition-colors hover:bg-[#FBF9F5]/70"
                      >
                        <div className="flex items-center gap-4">
                          <span className="font-mono text-xs text-[#666666] w-6">#{idx + 1}</span>
                          <span className="font-mono text-xl font-black text-[#111111]">
                            #{t.ticket_number}
                          </span>
                          <div>
                            <span className="font-mono text-sm font-semibold text-[#111111]">{t.full_name}</span>
                            <div className="flex items-center gap-2 font-mono text-xs text-[#666666]">
                              <span>{formatWait(t.created_at, now)}</span>
                              {t.strikes > 0 && (
                                <span className="text-[#E5484D] font-bold">
                                  ({t.strikes} strike{t.strikes > 1 ? "s" : ""})
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Inline Actions */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleAbsent(t.id, t.ticket_number, t.strikes)}
                            className="min-h-[44px] px-3.5 border border-[#E5484D] bg-[#FFFFFF] font-mono text-xs font-bold uppercase text-[#E5484D] hover:bg-[#E5484D]/10"
                          >
                            Absent
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleServe(t.id, t.ticket_number)}
                            className="min-h-[44px] px-4 bg-[#111111] font-mono text-xs font-bold uppercase text-[#FBF9F5] hover:bg-neutral-800"
                          >
                            Call & Serve →
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Group B: Off-Premise Roam */}
              {offPremiseRoam.length > 0 && (
                <div className="mt-8 border-t border-[#E8E5DF] pt-6">
                  <div className="flex items-center justify-between pb-2">
                    <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#666666]">
                      Off-Premise Roam ({offPremiseRoam.length} visitors)
                    </span>
                    <span className="font-mono text-[11px] text-[#666666]">
                      Advised to wait outside / push alerted
                    </span>
                  </div>

                  <div className="mt-3 divide-y divide-[#E8E5DF]">
                    {filteredRoam.map((t, idx) => (
                      <div
                        key={t.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3 font-mono text-xs opacity-75 hover:opacity-100"
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-[#666666] w-6">#{dynamicBuffer + idx + 1}</span>
                          <span className="font-bold text-[#111111]">#{t.ticket_number}</span>
                          <span className="text-[#111111]">{t.full_name}</span>
                          {t.strikes > 0 && (
                            <span className="text-[#E5484D] font-bold">
                              ({t.strikes} strike{t.strikes > 1 ? "s" : ""})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleServe(t.id, t.ticket_number)}
                            className="min-h-[38px] px-3 border border-[#E8E5DF] bg-[#FFFFFF] font-mono text-xs font-semibold hover:border-[#111111]"
                          >
                            Pull Early →
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* RIGHT COLUMN: Venue Controls, QR Poster & Telemetry */}
          <div className={`space-y-6 ${mobileTab === "queue" || mobileTab === "hub" ? "hidden md:block" : "block"}`}>
            {/* Venue QR Sign Card */}
            <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-[#E8E5DF] pb-3">
                <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#111111]">
                  Venue QR Signage
                </span>
                <button
                  type="button"
                  onClick={handleToggleIntake}
                  disabled={busy}
                  className={`font-mono text-xs font-bold uppercase px-2.5 py-1 ${
                    open ? "border border-[#30A46C] text-[#30A46C] bg-[#30A46C]/10" : "border border-[#F76B15] text-[#F76B15] bg-[#F76B15]/10"
                  }`}
                >
                  {open ? "Intake: Open" : "Intake: Paused"}
                </button>
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
                  disabled={!cleanQueueId || !queue}
                  onClick={() => queue && cleanQueueId && downloadVenuePoster(queue.title, joinUrl)}
                  className="min-h-[44px] w-full bg-[#111111] font-mono text-xs font-bold uppercase tracking-wider text-[#FBF9F5] transition-colors hover:bg-neutral-800 disabled:opacity-40"
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

            {/* Queue Engine Telemetry & Lease State */}
            <div className="border border-[#E8E5DF] bg-[#FFFFFF] p-6 shadow-sm">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#111111]">
                Queue Engine State
              </span>
              <dl className="mt-4 space-y-4 font-mono text-xs">
                {/* Intake Status Row with Interactive Toggle */}
                <div className="flex items-center justify-between border-b border-[#E8E5DF] pb-3">
                  <div>
                    <dt className="text-[#666666]">Intake Status</dt>
                    <dd className="mt-1 flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${open ? "bg-[#30A46C] animate-pulse" : "bg-[#F76B15]"}`} />
                      <span className={open ? "text-[#30A46C] font-bold" : "text-[#F76B15] font-bold"}>
                        {open ? "● OPEN" : "⏸ PAUSED"}
                      </span>
                    </dd>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleIntake}
                    disabled={busy}
                    className={`min-h-[36px] px-3 font-mono text-xs font-bold uppercase tracking-wider transition-colors disabled:opacity-40 ${
                      open
                        ? "border border-[#F76B15] bg-[#F76B15]/10 text-[#F76B15] hover:bg-[#F76B15]/20"
                        : "bg-[#111111] text-[#FBF9F5] hover:bg-neutral-800"
                    }`}
                  >
                    {open ? "Pause Intake" : "Resume Intake"}
                  </button>
                </div>

                <div className="flex justify-between border-b border-[#E8E5DF] pb-3">
                  <dt className="text-[#666666]">Active Operators</dt>
                  <dd className="text-[#111111] font-bold">
                    {onlineOps} Online
                  </dd>
                </div>

                {/* Dynamic Buffer Interactive Stepper */}
                <div className="border-b border-[#E8E5DF] pb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <dt className="text-[#666666]">Dynamic Staging Buffer</dt>
                      <dd className="mt-1 text-base font-bold text-[#111111]">Top {dynamicBuffer}</dd>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleBufferChange(dynamicBuffer - 1)}
                        disabled={busy || dynamicBuffer <= formulaFloor}
                        className="h-8 w-8 border border-[#E8E5DF] bg-[#FFFFFF] font-mono text-sm font-bold text-[#111111] hover:bg-[#F4F1EA] disabled:opacity-30 disabled:hover:bg-[#FFFFFF]"
                        title={dynamicBuffer <= formulaFloor ? `Locked at formula floor (${formulaFloor})` : "Decrease buffer"}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        onClick={() => handleBufferChange(dynamicBuffer + 1)}
                        disabled={busy || dynamicBuffer >= 30}
                        className="h-8 w-8 border border-[#E8E5DF] bg-[#FFFFFF] font-mono text-sm font-bold text-[#111111] hover:bg-[#F4F1EA] disabled:opacity-30 disabled:hover:bg-[#FFFFFF]"
                        title="Increase buffer (up to 30)"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-[10px] text-[#666666] leading-tight">
                    Floor: Top {formulaFloor} (Operators × 3 + 2). Scaling up is allowed; dropping below the floor is locked.
                  </p>
                </div>

                <div className="flex justify-between border-b border-[#E8E5DF] pb-2">
                  <dt className="text-[#666666]">24h Inactivity Lease</dt>
                  <dd className="text-[#111111] font-semibold">Active Renewal</dd>
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

      {/* All Queues Management Hub Modal (Desktop & Tablet) */}
      {showHubModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#111111]/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="w-full max-w-3xl border border-[#E8E5DF] bg-[#FFFFFF] p-6 sm:p-8 shadow-xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#E8E5DF] pb-4">
              <div>
                <h2 className="font-mono text-lg font-bold text-[#111111]">All Managed Queues</h2>
                <p className="font-mono text-xs text-[#666666] mt-0.5">
                  Overview of all queues you own or operate
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHubModal(false)}
                className="text-[#666666] hover:text-[#111111] font-mono text-xl leading-none p-1"
                aria-label="Close modal"
              >
                ×
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {myQueues.map((mq) => (
                <div
                  key={mq.queue_id}
                  className={`border p-5 flex flex-col justify-between ${
                    mq.queue_id === activeQueueId ? "border-[#111111] bg-[#FBF9F5]" : "border-[#E8E5DF] bg-[#FFFFFF]"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-mono text-base font-bold text-[#111111] truncate">{mq.title}</h3>
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider border border-[#E8E5DF] px-2 py-0.5 bg-[#FFFFFF]">
                        {mq.role}
                      </span>
                    </div>

                    <div className="mt-4 flex items-center gap-3 font-mono text-xs">
                      <span className="font-bold text-[#30A46C]">{mq.waiting_count} waiting</span>
                      <span className="text-[#666666]">|</span>
                      <span className="text-[#111111]">{mq.serving_count} serving</span>
                    </div>

                    <p className="font-mono text-[11px] text-[#666666] mt-2">
                      Last Active: {mq.last_activity_at ? new Date(mq.last_activity_at).toLocaleTimeString() : "Recently"}
                    </p>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-2 pt-3 border-t border-[#E8E5DF]">
                    <button
                      type="button"
                      onClick={() => {
                        switchQueue(mq.queue_id);
                        setShowHubModal(false);
                      }}
                      className="flex-1 bg-[#111111] py-2 font-mono text-xs font-bold text-[#FBF9F5] uppercase tracking-wider hover:bg-neutral-800"
                    >
                      {mq.queue_id === activeQueueId ? "Active Console" : "Open Console"}
                    </button>

                    <Link
                      to="/display/$queueId"
                      params={{ queueId: mq.queue_id }}
                      target="_blank"
                      className="px-3 py-2 border border-[#E8E5DF] bg-[#FFFFFF] font-mono text-xs font-semibold text-[#111111] hover:bg-[#F4F1EA]"
                    >
                      Lobby TV ↗
                    </Link>

                    {mq.role === "ADMIN" && (
                      <button
                        type="button"
                        onClick={() => handleDeleteQueue(mq.queue_id)}
                        className="px-3 py-2 border border-[#E5484D] text-[#E5484D] font-mono text-xs font-bold hover:bg-[#E5484D]/10"
                        title="Delete queue"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex justify-end gap-3 pt-4 border-t border-[#E8E5DF]">
              <button
                type="button"
                onClick={() => {
                  setShowHubModal(false);
                  setIsModalOpen(true);
                }}
                className="bg-[#111111] px-5 py-2.5 font-mono text-xs font-bold text-[#FBF9F5] uppercase tracking-wider hover:bg-neutral-800"
              >
                + Deploy Another Queue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Creation Modal */}
      <CreateQueueModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={(newId) => {
          loadMyQueues();
          if (newId) switchQueue(newId);
        }}
      />

      {/* Print-Only Poster Element */}
      <div className="print-poster-container hidden print:flex print:flex-col print:items-center print:justify-center print:min-h-screen print:p-8 print:bg-white text-black font-sans text-center">
        <div className="border-4 border-black p-8 rounded-2xl max-w-lg w-full flex flex-col items-center">
          {/* Header */}
          <div className="font-mono text-3xl font-black tracking-tight mb-2 uppercase">
            {queue?.title || "Virtual Queue"}
          </div>
          <div className="text-xs uppercase tracking-widest text-neutral-600 font-mono mb-8">
            Zero-Install Mobile Check-In
          </div>

          {/* Big QR Code */}
          <div className="p-4 bg-white border-2 border-black rounded-xl mb-8 flex items-center justify-center">
            {qr ? (
              <img
                src={qr}
                alt="Queue QR Code"
                className="w-72 h-72 object-contain"
              />
            ) : (
              <div className="w-72 h-72 bg-neutral-200" />
            )}
          </div>

          {/* Clear 3-Step Instructions */}
          <div className="text-left w-full space-y-3 font-mono text-xs border-t border-neutral-300 pt-6">
            <div className="flex items-start gap-3">
              <span className="font-bold text-sm bg-black text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                1
              </span>
              <span>Scan the QR code with your phone camera to take your position.</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-bold text-sm bg-black text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                2
              </span>
              <span>Keep your browser tab open; roam freely while waiting.</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="font-bold text-sm bg-black text-white rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                3
              </span>
              <span>Approach the desk when your ticket enters the physical line.</span>
            </div>
          </div>

          {/* Footer Direct Link */}
          <div className="mt-8 pt-4 text-[10px] text-neutral-500 font-mono">
            Direct Link: {joinUrl}
          </div>
        </div>
      </div>
    </main>
  );
}
