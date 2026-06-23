import { describe, expect, it } from "vitest";
import { formatPayoutSummary } from "../src/handlers/E4T2.js";

describe("formatPayoutSummary", () => {
  it("formats survivor payouts in order", () => {
    expect(
      formatPayoutSummary([
        { userId: 42, amount: 4 },
        { userId: 99, amount: 3 },
      ]),
    ).toBe("Payouts: 42 +4, 99 +3.");
  });

  it("handles an empty payout list", () => {
    expect(formatPayoutSummary([])).toBe("No survivor payouts.");
  });
});
