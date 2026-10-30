import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { clearActiveTicket, getActiveTicket, getClientUuid, setActiveTicket } from "@/lib/q";

export const Route = createFileRoute("/join/$queueId")({
  head: () => ({
    meta: [
      { title: "Take your spot — Q" },
      { name: "description", content: "Join the virtual line and roam freely until it's your turn." },
      { property: "og:title", content: "Take your spot — Q" },
      { property: "og:description", content: "Join the virtual line and roam freely until it's your turn." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: JoinPage,
});

type Queue = { id: string; venue_name: string; title: string; status: string };

// Helper utility to convert base64 VAPID key
function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerPushSubscription(): Promise<PushSubscription | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const vapidPublicKey = import.meta.env["VITE_VAPID_PUBLIC_KEY"];
  if (!vapidPublicKey) {
    console.warn("VAPID Public Key missing; falling back to in-tab notification permission.");
    await Notification.requestPermission();
    return null;
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  return subscription;
}

function JoinPage() {
  const { queueId } = Route.useParams();
  const navigate = useNavigate();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [alerts, setAlerts] = useState(false);
  const [pushSubscription, setPushSubscription] = useState<PushSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!queueId) {
      setLoadErr(true);
      return;
    }

    const cleanId = queueId.trim();

    const existing = getActiveTicket(cleanId);
    if (existing) {
      supabase.rpc("get_ticket_status", { p_ticket_id: existing }).then(({ data }) => {
        const t = data?.[0];
        if (t && (t.status === "WAITING" || t.status === "SERVING")) {
          navigate({ to: "/ticket/$ticketId", params: { ticketId: existing }, replace: true });
        } else clearActiveTicket(cleanId);
      });
    }

    async function fetchQueue() {
      // 1. Attempt direct select from public.queues
      const { data, error } = await supabase
        .from("queues")
        .select("id,venue_name,title,status")
        .eq("id", cleanId)
        .maybeSingle();

      if (data) {
        setQueue({
          ...data,
          status: data.status || "OPEN",
        });
        return;
      }

      console.error("Join queue direct fetch error/empty:", error, "queueId:", cleanId);

      // 2. Fallback to RPC get_queue_for_visitor
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: rpcData, error: rpcError } = await (supabase.rpc as any)(
          "get_queue_for_visitor",
          { p_queue_id: cleanId }
        );

        if (rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
          const q = rpcData[0];
          setQueue({
            id: q.id,
            venue_name: q.venue_name || q.title,
            title: q.title,
            status: q.status || "OPEN",
          });
          return;
        }

        if (rpcError) {
          console.error("Join queue RPC fetch error:", rpcError, "queueId:", cleanId);
        }
      } catch (err) {
        console.error("RPC fallback exception:", err);
      }

      setLoadErr(true);
    }

    fetchQueue();

    if (typeof Notification !== "undefined") setAlerts(Notification.permission === "granted");
  }, [queueId, navigate]);

  async function toggleAlerts() {
    if (typeof Notification === "undefined") return setErr("This browser doesn't support alerts.");
    if (alerts) {
      setAlerts(false);
      setPushSubscription(null);
      return;
    }

    try {
      const sub = await registerPushSubscription();
      if (sub) {
        setPushSubscription(sub);
        setAlerts(true);
      } else {
        const p = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        setAlerts(p === "granted");
      }
    } catch (e) {
      console.error("Push registration error:", e);
      const p = await Notification.requestPermission();
      setAlerts(p === "granted");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);

    const subscriptionPayload = pushSubscription ? JSON.parse(JSON.stringify(pushSubscription)) : null;

    const { data, error } = await supabase.rpc("join_queue", {
      p_queue_id: queueId,
      p_full_name: name.trim().slice(0, 80),
      p_phone_number: phone.trim().slice(0, 30),
      p_client_uuid: getClientUuid(),
      p_push_subscription: subscriptionPayload,
    });
    setBusy(false);
    if (error || !data) return setErr(error?.message ?? "Could not join the line.");
    setActiveTicket(queueId, data);
    navigate({ to: "/ticket/$ticketId", params: { ticketId: data } });
  }

  const open = queue?.status === "OPEN";

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-8 pt-10">
        <header className="border-b pb-6">
          <p className="eyebrow">{queue?.venue_name ?? (loadErr ? "Queue not found" : "Loading…")}</p>
          <h1 className="mt-2 text-3xl font-semibold">{queue?.title ?? " "}</h1>
          {queue && (
            <span
              className={`mt-4 inline-flex items-center gap-2 border px-3 py-1 text-xs font-medium ${
                open ? "border-success text-success" : "border-warning text-warning"
              }`}
            >
              {open ? "● Queue Open" : queue.status === "PAUSED" ? "⏸ Queue Paused" : "○ Queue Closed"}
            </span>
          )}
        </header>

        {!open && queue && (
          <div className="mt-6 border border-warning/40 bg-warning/10 p-4 font-mono text-xs text-warning">
            Intake is temporarily paused by operators. Please check back shortly.
          </div>
        )}

        <form onSubmit={submit} className="flex flex-1 flex-col pt-10">
          <label className="eyebrow" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            autoFocus
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-2 border-0 border-b border-input bg-transparent pb-3 text-2xl outline-none placeholder:text-muted-foreground/50 focus:border-foreground"
            placeholder="Ada Obi"
          />

          <label className="eyebrow mt-10" htmlFor="phone">
            Phone <span className="normal-case tracking-normal">(optional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            maxLength={30}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-2 border-0 border-b border-input bg-transparent pb-3 text-xl outline-none placeholder:text-muted-foreground/50 focus:border-foreground"
            placeholder="+234 …"
          />

          <button
            type="button"
            onClick={toggleAlerts}
            className="mt-10 flex items-start gap-4 border p-4 text-left"
            aria-pressed={alerts}
          >
            <span
              className={`mt-0.5 flex h-5 w-9 shrink-0 items-center border p-0.5 transition-colors ${
                alerts ? "justify-end border-primary bg-primary" : "justify-start border-input"
              }`}
            >
              <span className={`h-3.5 w-3.5 ${alerts ? "bg-primary-foreground" : "bg-muted-foreground"}`} />
            </span>
            <span className="text-sm">Enable alerts to receive notice when you are near the front.</span>
          </button>

          {err && <p className="mt-4 text-sm text-destructive">{err}</p>}

          <div className="flex-1" />
          <button
            type="submit"
            disabled={busy || !open || !name.trim()}
            className="mt-10 h-16 w-full bg-primary text-lg font-medium text-primary-foreground transition-opacity disabled:opacity-40"
          >
            {busy ? "Saving your spot…" : open || !queue ? "Take My Spot" : "Intake paused"}
          </button>
        </form>
      </div>
    </main>
  );
}
