import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import type { GameRepository } from "../game/repository.js";
import { formatPayoutSummary } from "./E4T2.js";

const composer = new Composer<Ctx>();

export async function completeRandomElimination(
  ctx: Pick<Ctx, "chat" | "reply">,
  repository: Pick<GameRepository, "eliminateRandomPlayer">,
): Promise<void> {
  if (!ctx.chat) {
    await ctx.reply("Unable to eliminate: Telegram did not include chat details.");
    return;
  }

  const result = await repository.eliminateRandomPlayer({ groupId: ctx.chat.id });
  if (result.status === "no_countdown_round") {
    await ctx.reply("No countdown round is ready for elimination.");
    return;
  }

  if (result.status === "not_enough_players") {
    await ctx.reply(`Cannot eliminate without players. Players joined: ${result.participantCount}.`);
    return;
  }

  await ctx.reply(`Eliminated player: ${result.eliminatedUserId}.\n${formatPayoutSummary(result.payouts)}`);
}

export default composer;
