import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError } from "../game/runtime.js";
import { sendCountdown } from "./E3T1.js";
import { completeRandomElimination } from "./E4T1.js";
import { activeE2EStartedRoundCount } from "./E7T1.js";

const composer = new Composer<Ctx>();

if (process.env.AGNTDEV_SPECS_FILE || process.env.AGNTDEV_GATE_NONCE) {
  composer.callbackQuery("e2e:start-count", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`Started rounds: ${activeE2EStartedRoundCount() ?? 0}.`);
  });
}

composer.command("startround", async (ctx) => {
  if (!ctx.chat || !ctx.from) {
    await ctx.reply("Unable to start: Telegram did not include chat or user details.");
    return;
  }

  try {
    const repository = await getGameRepository();
    const result = await repository.startRound({
      groupId: ctx.chat.id,
      userId: ctx.from.id,
    });

    if (result.status === "not_creator") {
      await ctx.reply("Only the group creator can start the round.");
      return;
    }

    if (result.status === "no_open_round") {
      await ctx.reply("No open round to start. Tap Join first.");
      return;
    }

    if (result.status === "not_enough_players") {
      await ctx.reply(`Need at least 2 players to start. Players joined: ${result.participantCount}.`);
      return;
    }

    await ctx.reply(`Round started. Players joined: ${result.participantCount}.`);
    await sendCountdown(ctx, result.gifPack);
    await completeRandomElimination(ctx, repository);
  } catch (err) {
    if (isGameStorageConfigError(err)) {
      await ctx.reply("Round storage is not configured. Set REDIS_URL before starting rounds.");
      return;
    }
    throw err;
  }
});

export default composer;
