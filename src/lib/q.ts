export const DEMO_QUEUE_ID = "00000000-0000-0000-0000-00000000000a";
export const DEFAULT_BUFFER_SIZE = 5;
export const MAX_STRIKES = 3;

const CLIENT_KEY = "q_client_uuid";
const ACTIVE_TICKET_KEY = "q_global_active_ticket";
const activeKey = (queueId: string) => `q_active_ticket_${queueId}`;

export function getClientUuid(): string {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

export function getActiveTicket(queueId?: string) {
  if (queueId) {
    return localStorage.getItem(activeKey(queueId)) || localStorage.getItem(ACTIVE_TICKET_KEY);
  }
  return localStorage.getItem(ACTIVE_TICKET_KEY);
}

export function setActiveTicket(queueId: string, ticketId: string) {
  localStorage.setItem(activeKey(queueId), ticketId);
  localStorage.setItem(ACTIVE_TICKET_KEY, JSON.stringify({ queueId, ticketId }));
}

export function clearActiveTicket(queueId?: string) {
  if (queueId) {
    localStorage.removeItem(activeKey(queueId));
  }
  localStorage.removeItem(ACTIVE_TICKET_KEY);
}

/** Calculate dynamic staging buffer based on active operators */
export function calculateDynamicBuffer(activeOperators: number): number {
  return Math.max(1, activeOperators) * 3 + 2;
}

/** Clock in West Africa Time (UTC+1). */
export function formatLagosTime(d: Date) {
  return d.toLocaleTimeString("en-GB", {
    timeZone: "Africa/Lagos",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatWait(fromIso: string | null, now: number) {
  if (!fromIso) return "—";
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function notify(title: string, body: string) {
  try {
    navigator.vibrate?.([200, 100, 200, 100, 400]);
  } catch {
    /* ignore */
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag: "q-alert", requireInteraction: true } as NotificationOptions);
  } catch {
    navigator.serviceWorker?.ready.then((r) => r.showNotification(title, { body })).catch(() => {});
  }
}

/** Audio chime using Web Audio API for queue updates and desk calls */
export function playChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    const now = ctx.currentTime;
    // Two-tone bell: C6 (1046.5Hz) -> E6 (1318.5Hz)
    osc.frequency.setValueAtTime(1046.5, now);
    osc.frequency.setValueAtTime(1318.5, now + 0.12);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.6);
  } catch {
    /* ignore audio restrictions */
  }
}
