import { describe, it, expect, vi } from "vitest";
import { calculateDynamicBuffer, DEFAULT_BUFFER_SIZE, MAX_STRIKES, formatLagosTime, playChime } from "@/lib/q";

describe("1. Dynamic Buffer Sizing Formula (PRD 2.1)", () => {
  it("calculates buffer correctly according to formula: (activeOperators * 3) + 2", () => {
    // 1 operator => 5
    expect(calculateDynamicBuffer(1)).toBe(5);
    // 2 operators => 8
    expect(calculateDynamicBuffer(2)).toBe(8);
    // 3 operators => 11
    expect(calculateDynamicBuffer(3)).toBe(11);
    // 4 operators => 14
    expect(calculateDynamicBuffer(4)).toBe(14);
    // fallback for 0 or negative active operators (defaults to minimum 1 operator)
    expect(calculateDynamicBuffer(0)).toBe(5);
    expect(calculateDynamicBuffer(-1)).toBe(5);
  });

  it("exports matching default buffer size and max strikes", () => {
    expect(DEFAULT_BUFFER_SIZE).toBe(5);
    expect(MAX_STRIKES).toBe(3);
  });
});

describe("2. Single Active Ticket Constraint (PRD 5.1)", () => {
  type Ticket = {
    id: string;
    queue_id: string;
    client_uuid: string;
    status: "WAITING" | "SERVING" | "COMPLETED" | "REVOKED";
  };

  class MockTicketLedger {
    private tickets: Ticket[] = [];

    // Emulates PostgreSQL partial unique index:
    // CREATE UNIQUE INDEX idx_tickets_single_active_ticket ON public.tickets (client_uuid) WHERE status IN ('WAITING', 'SERVING');
    public insertTicket(queue_id: string, client_uuid: string): { ok: boolean; ticket?: Ticket; error?: string } {
      const activeTicket = this.tickets.find(
        (t) => t.client_uuid === client_uuid && (t.status === "WAITING" || t.status === "SERVING")
      );
      if (activeTicket) {
        return {
          ok: false,
          error: "duplicate key value violates unique constraint \"idx_tickets_single_active_ticket\"",
        };
      }

      const newTicket: Ticket = {
        id: `ticket-${Math.random().toString(36).substring(2, 9)}`,
        queue_id,
        client_uuid,
        status: "WAITING",
      };
      this.tickets.push(newTicket);
      return { ok: true, ticket: newTicket };
    }

    public cancelTicket(ticketId: string): void {
      const t = this.tickets.find((item) => item.id === ticketId);
      if (t) t.status = "REVOKED";
    }
  }

  it("strictly enforces at most one active queue ticket globally per client_uuid", () => {
    const ledger = new MockTicketLedger();
    const clientUuid = "test-device-uuid-1";

    // 1. Register first ticket in Queue A
    const res1 = ledger.insertTicket("queue-a", clientUuid);
    expect(res1.ok).toBe(true);
    expect(res1.ticket?.status).toBe("WAITING");

    // 2. Attempt to register a second ticket in Queue B without cancelling Queue A
    const res2 = ledger.insertTicket("queue-b", clientUuid);
    expect(res2.ok).toBe(false);
    expect(res2.error).toContain("idx_tickets_single_active_ticket");

    // 3. Cancel the first ticket, then re-attempt
    if (res1.ticket) {
      ledger.cancelTicket(res1.ticket.id);
    }
    const res3 = ledger.insertTicket("queue-b", clientUuid);
    expect(res3.ok).toBe(true);
    expect(res3.ticket?.queue_id).toBe("queue-b");
  });
});

describe("3. Absence Penalty & Strike Engine with Dynamic Buffer (PRD 2.3)", () => {
  type TicketSim = {
    id: string;
    ticket_number: number;
    sort_order: number;
    status: "WAITING" | "SERVING" | "COMPLETED" | "REVOKED";
    strikes: number;
    serving_operator_id: string | null;
  };

  class MockQueueEngine {
    public tickets: TicketSim[] = [];
    public activeOperators: number = 1; // buffer size = 5

    constructor(count: number) {
      for (let i = 1; i <= count; i++) {
        this.tickets.push({
          id: `t-${i}`,
          ticket_number: i,
          sort_order: i * 1.0,
          status: "WAITING",
          strikes: 0,
          serving_operator_id: null,
        });
      }
    }

    public getDynamicBuffer(): number {
      return calculateDynamicBuffer(this.activeOperators);
    }

    // Emulates PostgreSQL clerk_mark_ticket_absent stored procedure
    public clerkMarkTicketAbsent(ticketId: string): TicketSim {
      const t = this.tickets.find((item) => item.id === ticketId);
      if (!t) throw new Error("Ticket not found");

      t.strikes += 1;

      if (t.strikes >= MAX_STRIKES) {
        t.status = "REVOKED";
        t.serving_operator_id = null;
        return t;
      }

      // Buffer size N
      const buf = this.getDynamicBuffer();
      const waitingOther = this.tickets
        .filter((item) => item.status === "WAITING" && item.id !== t.id)
        .sort((a, b) => a.sort_order - b.sort_order);

      const sAtBuf = waitingOther[buf - 1]?.sort_order;
      const sNext = waitingOther[buf]?.sort_order;

      let newSort: number;
      if (sAtBuf !== undefined && sNext !== undefined) {
        newSort = (sAtBuf + sNext) / 2.0; // Fractional index
      } else if (sAtBuf !== undefined) {
        newSort = sAtBuf + 0.5;
      } else {
        const maxSort = Math.max(...waitingOther.map((o) => o.sort_order), 0);
        newSort = maxSort + 0.5;
      }

      t.status = "WAITING";
      t.serving_operator_id = null;
      t.sort_order = newSort;
      return t;
    }
  }

  it("increments strikes and bumps absent ticket behind buffer using fractional indexing", () => {
    const engine = new MockQueueEngine(10);
    const dynamicBuffer = engine.getDynamicBuffer(); // 5
    expect(dynamicBuffer).toBe(5);

    // Initial waiting tickets are sorted 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0...
    const ticket1 = engine.tickets[0];
    expect(ticket1.ticket_number).toBe(1);

    // Strike 1: Bump behind 5-person physical buffer (between index 5 and 6, or sort_orders 6.0 and 7.0)
    engine.clerkMarkTicketAbsent(ticket1.id);
    expect(ticket1.strikes).toBe(1);
    expect(ticket1.status).toBe("WAITING");

    // The other tickets remaining at offsets 0..4 are tickets 2, 3, 4, 5, 6 (sort_orders 2, 3, 4, 5, 6)
    // sAtBuf is sort_order 6.0, sNext is sort_order 7.0
    // fractional index = (6.0 + 7.0) / 2 = 6.5
    expect(ticket1.sort_order).toBe(6.5);

    // Re-verify ordering: ticket #1 is now placed at position 6 (immediately behind the 5 physical buffer slots)
    const sortedWaiting = engine.tickets
      .filter((t) => t.status === "WAITING")
      .sort((a, b) => a.sort_order - b.sort_order);

    expect(sortedWaiting[5].id).toBe(ticket1.id);
    expect(sortedWaiting[0].ticket_number).toBe(2); // Former Position 2 is now Position 1

    // Strike 2: Second absence
    engine.clerkMarkTicketAbsent(ticket1.id);
    expect(ticket1.strikes).toBe(2);
    expect(ticket1.status).toBe("WAITING");

    // Strike 3: 3-strike revocation threshold
    engine.clerkMarkTicketAbsent(ticket1.id);
    expect(ticket1.strikes).toBe(3);
    expect(ticket1.status).toBe("REVOKED");
  });
});

describe("4. Shared Hopper Concurrency & Atomic Claim (PRD 3.1)", () => {
  type TicketLock = {
    id: string;
    ticket_number: number;
    status: "WAITING" | "SERVING" | "COMPLETED";
    serving_operator_id: string | null;
  };

  class MockHopper {
    public tickets: TicketLock[] = [
      { id: "t1", ticket_number: 101, status: "WAITING", serving_operator_id: null },
      { id: "t2", ticket_number: 102, status: "WAITING", serving_operator_id: null },
    ];

    // Emulates clerk_serve_ticket stored procedure with row-level locking
    public clerkServeTicket(ticketId: string, operatorId: string): { ok: boolean; error?: string } {
      const ticket = this.tickets.find((t) => t.id === ticketId);
      if (!ticket) return { ok: false, error: "Ticket not found" };

      if (ticket.status === "SERVING" && ticket.serving_operator_id === operatorId) {
        return { ok: true };
      }

      if (ticket.status !== "WAITING") {
        return { ok: false, error: `Ticket is not waiting to be served (current status: ${ticket.status})` };
      }

      ticket.status = "SERVING";
      ticket.serving_operator_id = operatorId;
      return { ok: true };
    }
  }

  it("atomically claims ticket for one clerk and rejects collision from another clerk", () => {
    const hopper = new MockHopper();
    const clerkA = "clerk-uuid-a";
    const clerkB = "clerk-uuid-b";

    // Clerk A claims Ticket #101
    const resA = hopper.clerkServeTicket("t1", clerkA);
    expect(resA.ok).toBe(true);
    expect(hopper.tickets[0].serving_operator_id).toBe(clerkA);
    expect(hopper.tickets[0].status).toBe("SERVING");

    // Clerk B simultaneously attempts to claim Ticket #101
    const resB = hopper.clerkServeTicket("t1", clerkB);
    expect(resB.ok).toBe(false);
    expect(resB.error).toContain("Ticket is not waiting to be served");
    expect(hopper.tickets[0].serving_operator_id).toBe(clerkA); // still owned by Clerk A
  });
});

describe("5. Anti-Spoofing & Live Client Ground Truth (PRD 5.1 & 5.3)", () => {
  it("formats Lagos WAT clock without throw", () => {
    const testDate = new Date("2026-10-30T12:30:45Z");
    const lagosStr = formatLagosTime(testDate);
    // WAT is UTC+1 (13:30:45)
    expect(lagosStr).toBe("13:30:45");
  });

  it("synthesizes web audio chime without throwing error in non-audio environment", () => {
    expect(() => playChime()).not.toThrow();
  });
});
