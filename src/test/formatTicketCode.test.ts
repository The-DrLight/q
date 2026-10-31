import { describe, expect, it } from "vitest";
import { formatTicketCode } from "@/lib/formatTicketCode";

describe("Alphanumeric ticket code formatting", () => {
  it("handles empty or invalid ticket numbers", () => {
    expect(formatTicketCode(null)).toBe("---");
    expect(formatTicketCode(undefined)).toBe("---");
    expect(formatTicketCode(0)).toBe("---");
    expect(formatTicketCode(-5)).toBe("---");
  });

  it("formats cycle A (1-99)", () => {
    expect(formatTicketCode(1)).toBe("A01");
    expect(formatTicketCode(2)).toBe("A02");
    expect(formatTicketCode(9)).toBe("A09");
    expect(formatTicketCode(10)).toBe("A10");
    expect(formatTicketCode(99)).toBe("A99");
  });

  it("formats cycle B (100-198)", () => {
    expect(formatTicketCode(100)).toBe("B01");
    expect(formatTicketCode(101)).toBe("B02");
    expect(formatTicketCode(198)).toBe("B99");
  });

  it("formats cycle C (199-297)", () => {
    expect(formatTicketCode(199)).toBe("C01");
  });

  it("formats cycle Z and wraps around correctly", () => {
    // 26 letters: 26 * 99 = 2574
    // 2574 is Z99
    expect(formatTicketCode(2574)).toBe("Z99");
    // 2575 wraps to A01
    expect(formatTicketCode(2575)).toBe("A01");
  });
});
