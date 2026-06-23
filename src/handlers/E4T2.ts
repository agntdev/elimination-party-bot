import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import type { StakePayout } from "../game/repository.js";

const composer = new Composer<Ctx>();

export function formatPayoutSummary(payouts: StakePayout[]): string {
  if (payouts.length === 0) {
    return "No survivor payouts.";
  }
  return `Payouts: ${payouts.map((payout) => `${payout.userId} +${payout.amount}`).join(", ")}.`;
}

export default composer;
