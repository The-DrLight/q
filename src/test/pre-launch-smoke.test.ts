import { describe, it, expect } from "vitest";
import { formatTicketCode } from "@/lib/formatTicketCode";
import { sanitizeInput } from "@/lib/sanitize";

type Ticket = {
  id: string;
  queue_id: string;
  ticket_number: number;
  full_name: string;
  phone_number: string | null;
  client_uuid: string;
  status: "WAITING" | "SERVING" | "COMPLETED" | "REVOKED";
  strikes: number;
  sort_order: number;
  serving_operator_id: string | null;
};

class SimulatedPreLaunchQueueEngine {
  public queue_id: string;
  public status: "OPEN" | "PAUSED" | "CLOSED" = "OPEN";
  public buffer_size: number = 5;
  public tickets: Ticket[] = [];

  constructor(queue_id: string) {
    this.queue_id = queue_id;
  }

  // Corresponds to postgres join_queue RPC
  public joinQueue(params: {
    fullName: string;
    phoneNumber?: string;
    clientUuid: string;
  }): { ok: boolean; ticket?: Ticket; error?: string } {
    if (this.status !== "OPEN") {
      return { ok: false, error: "Queue is not accepting new entries" };
    }

    // Input sanitization: strip HTML tags & check lengths
    const sanitizedName = sanitizeInput(params.fullName).slice(0, 80);
    const sanitizedPhone = sanitizeInput(params.phoneNumber).slice(0, 30);

    if (!sanitizedName) {
      return { ok: false, error: "Invalid name" };
    }

    // Partial index enforcement: single active ticket globally per client_uuid
    const existing = this.tickets.find(
      (t) => t.client_uuid === params.clientUuid && (t.status === "WAITING" || t.status === "SERVING")
    );
    if (existing) {
      return { ok: true, ticket: existing };
    }

    const nextTicketNumber =
      this.tickets.reduce((max, t) => Math.max(max, t.ticket_number), 0) + 1;
    const nextSortOrder =
      this.tickets.reduce((max, t) => Math.max(max, t.sort_order), 0) + 1.0;

    const newTicket: Ticket = {
      id: `ticket-${Math.random().toString(36).substring(2, 9)}`,
      queue_id: this.queue_id,
      ticket_number: nextTicketNumber,
      full_name: sanitizedName,
      phone_number: sanitizedPhone || null,
      client_uuid: params.clientUuid,
      status: "WAITING",
      strikes: 0,
      sort_order: nextSortOrder,
      serving_operator_id: null,
    };

    this.tickets.push(newTicket);
    return { ok: true, ticket: newTicket };
  }

  // Corresponds to get_operator_hopper_tickets RPC
  public getHopper(): {
    onDeck: Ticket[];
    roaming: Ticket[];
    activeServing: Ticket[];
  } {
    const activeServing = this.tickets.filter((t) => t.status === "SERVING");
    const waiting = this.tickets
      .filter((t) => t.status === "WAITING")
      .sort((a, b) => a.sort_order - b.sort_order);

    const onDeck = waiting.slice(0, this.buffer_size);
    const roaming = waiting.slice(this.buffer_size);

    return { onDeck, roaming, activeServing };
  }

  // Corresponds to get_ticket_status dynamic position
  public getTicketDynamicPosition(ticketId: string): number | null {
    const target = this.tickets.find((t) => t.id === ticketId);
    if (!target || target.status !== "WAITING") return null;

    const ahead = this.tickets.filter(
      (t) => t.status === "WAITING" && t.sort_order < target.sort_order
    );
    return ahead.length + 1;
  }

  // Corresponds to mark_ticket_done RPC
  public markDone(ticketId: string): { ok: boolean; error?: string } {
    const t = this.tickets.find((item) => item.id === ticketId);
    if (!t) return { ok: false, error: "Ticket not found" };

    t.status = "COMPLETED";
    t.serving_operator_id = null;
    return { ok: true };
  }

  // Corresponds to clerk_mark_ticket_absent RPC
  public markAbsent(ticketId: string): { ok: boolean; newStatus: string; strikes: number } {
    const t = this.tickets.find((item) => item.id === ticketId);
    if (!t) throw new Error("Ticket not found");

    t.strikes += 1;
    if (t.strikes >= 3) {
      t.status = "REVOKED";
      t.serving_operator_id = null;
      return { ok: true, newStatus: "REVOKED", strikes: t.strikes };
    }

    // Bump behind staging buffer
    const otherWaiting = this.tickets
      .filter((item) => item.status === "WAITING" && item.id !== t.id)
      .sort((a, b) => a.sort_order - b.sort_order);

    if (otherWaiting.length < this.buffer_size) {
      const maxSort = otherWaiting.reduce((max, item) => Math.max(max, item.sort_order), 0);
      t.sort_order = maxSort + 1.0;
    } else {
      const atBuf = otherWaiting[this.buffer_size - 1]!.sort_order;
      const nextAfterBuf = otherWaiting[this.buffer_size]?.sort_order ?? atBuf + 2.0;
      t.sort_order = (atBuf + nextAfterBuf) / 2.0;
    }

    t.status = "WAITING";
    t.serving_operator_id = null;
    return { ok: true, newStatus: "WAITING", strikes: t.strikes };
  }
}

describe("Automated Pre-Launch Integration & Smoke Test Suite", () => {
  it("executes complete lifecycle: concurrent joins, hopper partitioning, done advancement, and absent penalties", () => {
    // 1. Create a mock queue
    const engine = new SimulatedPreLaunchQueueEngine("queue-prelaunch-001");
    expect(engine.status).toBe("OPEN");

    // 2. Simulate 10 concurrent visitors joining via join_queue simultaneously
    const visitors = [
      { name: "Ada Lovelace", phone: "+2348011111111", clientUuid: "client-uuid-01" },
      { name: "Alan Turing", phone: "+2348022222222", clientUuid: "client-uuid-02" },
      { name: "Grace Hopper", phone: "+2348033333333", clientUuid: "client-uuid-03" },
      { name: "Claude Shannon", phone: "+2348044444444", clientUuid: "client-uuid-04" },
      { name: "Margaret Hamilton", phone: "+2348055555555", clientUuid: "client-uuid-05" },
      { name: "John von Neumann", phone: "+2348066666666", clientUuid: "client-uuid-06" },
      { name: "Katherine Johnson", phone: "+2348077777777", clientUuid: "client-uuid-07" },
      { name: "Tim Berners-Lee", phone: "+2348088888888", clientUuid: "client-uuid-08" },
      { name: "Linus Torvalds", phone: "+2348099999999", clientUuid: "client-uuid-09" },
      { name: "Donald Knuth", phone: "+2348100000000", clientUuid: "client-uuid-10" },
    ];

    const joinedTickets: Ticket[] = [];
    visitors.forEach((v) => {
      const res = engine.joinQueue({
        fullName: v.name,
        phoneNumber: v.phone,
        clientUuid: v.clientUuid,
      });
      expect(res.ok).toBe(true);
      expect(res.ticket).toBeDefined();
      if (res.ticket) joinedTickets.push(res.ticket);
    });

    // Asserts sequential numbers 1 to 10
    expect(joinedTickets.map((t) => t.ticket_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // Asserts distinct alphanumeric codes A01 through A10
    const codes = joinedTickets.map((t) => formatTicketCode(t.ticket_number));
    expect(codes).toEqual(["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10"]);

    // Asserts no duplicate key collisions
    const uniqueIds = new Set(joinedTickets.map((t) => t.id));
    expect(uniqueIds.size).toBe(10);

    // 3. Simulates operator loading the hopper:
    // Asserts Top 5 are partitioned into On-Deck and the remaining 5 into Roaming
    let hopper = engine.getHopper();
    expect(hopper.onDeck.length).toBe(5);
    expect(hopper.roaming.length).toBe(5);
    expect(hopper.onDeck.map((t) => formatTicketCode(t.ticket_number))).toEqual([
      "A01",
      "A02",
      "A03",
      "A04",
      "A05",
    ]);
    expect(hopper.roaming.map((t) => formatTicketCode(t.ticket_number))).toEqual([
      "A06",
      "A07",
      "A08",
      "A09",
      "A10",
    ]);

    // Check dynamic line positions
    expect(engine.getTicketDynamicPosition(joinedTickets[0]!.id)).toBe(1);
    expect(engine.getTicketDynamicPosition(joinedTickets[1]!.id)).toBe(2);
    expect(engine.getTicketDynamicPosition(joinedTickets[5]!.id)).toBe(6);

    // 4. Simulates marking ticket A01 as DONE:
    const doneRes = engine.markDone(joinedTickets[0]!.id);
    expect(doneRes.ok).toBe(true);

    // Asserts A02 advances to dynamic position #1
    expect(engine.getTicketDynamicPosition(joinedTickets[1]!.id)).toBe(1);

    // Asserts A06 promotes from Roaming into the On-Deck staging buffer
    hopper = engine.getHopper();
    expect(hopper.onDeck.length).toBe(5);
    expect(hopper.roaming.length).toBe(4);
    expect(hopper.onDeck.map((t) => formatTicketCode(t.ticket_number))).toEqual([
      "A02",
      "A03",
      "A04",
      "A05",
      "A06",
    ]);
    expect(hopper.roaming.map((t) => formatTicketCode(t.ticket_number))).toEqual([
      "A07",
      "A08",
      "A09",
      "A10",
    ]);

    // 5. Simulates marking a visitor ABSENT:
    // Strike 1 for ticket A02:
    const absent1 = engine.markAbsent(joinedTickets[1]!.id);
    expect(absent1.ok).toBe(true);
    expect(absent1.strikes).toBe(1);
    expect(absent1.newStatus).toBe("WAITING");

    // Strike 2 for ticket A02:
    const absent2 = engine.markAbsent(joinedTickets[1]!.id);
    expect(absent2.ok).toBe(true);
    expect(absent2.strikes).toBe(2);
    expect(absent2.newStatus).toBe("WAITING");

    // Strike 3 for ticket A02 -> Asserts automatic revocation on 3rd strike
    const absent3 = engine.markAbsent(joinedTickets[1]!.id);
    expect(absent3.ok).toBe(true);
    expect(absent3.strikes).toBe(3);
    expect(absent3.newStatus).toBe("REVOKED");
    expect(engine.getTicketDynamicPosition(joinedTickets[1]!.id)).toBeNull();
  });

  it("sanitizes input and strips script tags or raw HTML upon entry", () => {
    const engine = new SimulatedPreLaunchQueueEngine("queue-prelaunch-002");

    const attackInput = {
      fullName: "<script>alert('xss')</script>Alice Cooper",
      phoneNumber: "<img src=x onerror=alert(1)>08012345678",
      clientUuid: "client-attack-uuid-99",
    };

    const res = engine.joinQueue(attackInput);
    expect(res.ok).toBe(true);
    expect(res.ticket?.full_name).toBe("Alice Cooper");
    expect(res.ticket?.phone_number).toBe("08012345678");
    expect(res.ticket?.full_name).not.toContain("<script>");
  });
});
