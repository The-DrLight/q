// Supabase Edge Function: send-queue-push
// Triggered via Database Webhook on public.tickets AFTER UPDATE

import webpush from "npm:web-push@3.6.7";

interface WebhookPayload {
  type: "UPDATE" | "INSERT";
  table: string;
  schema: string;
  record: {
    id: string;
    queue_id: string;
    ticket_number: number;
    sort_order: number;
    status: string;
    push_subscription: {
      endpoint: string;
      keys?: {
        p256dh: string;
        auth: string;
      };
    } | null;
  };
  old_record: {
    id: string;
    sort_order: number;
    status: string;
  } | null;
}

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const payload: WebhookPayload = await req.json();
    const { record, old_record } = payload;

    if (!record || !record.push_subscription) {
      return new Response(JSON.stringify({ message: "No push subscription on record" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    let shouldNotify = false;
    let title = "Q: Your turn is approaching";
    let body = "Please proceed to the physical line immediately.";

    // Transition 1: Called to desk
    if (record.status === "SERVING" && old_record?.status !== "SERVING") {
      shouldNotify = true;
      title = "It's your turn!";
      body = "Please proceed to the counter immediately.";
    }

    // Transition 2: Waiting in line - caller or shift puts ticket into top buffer
    // (Edge function or webhook triggers when sort_order changes into buffer)
    if (record.status === "WAITING" && (!old_record || old_record.status !== "WAITING" || old_record.sort_order !== record.sort_order)) {
      shouldNotify = true;
    }

    if (!shouldNotify) {
      return new Response(JSON.stringify({ message: "No notification criteria met" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const pushPayload = JSON.stringify({
      title,
      body,
      url: `/ticket/${record.id}`,
    });

    await webpush.sendNotification(record.push_subscription, pushPayload);

    return new Response(JSON.stringify({ success: true, ticketId: record.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error sending push notification:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
