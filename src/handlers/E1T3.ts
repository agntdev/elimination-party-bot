import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError } from "../game/runtime.js";
import { sendCountdown } from "./E3T1.js";
import { completeRandomElimination } from "./E4T1.js";

const composer = new Composer<Ctx>();

composer.callbackQuery("start:round", async (ctx) => {
  await ctx.answerCallbackQuery();

  if (!ctx.chat || !ctx.from) {
    await ctx.editMessageText("Unable to start: Telegram did not include chat or user details.");
    return;
  }

  try {
    const repository = await getGameRepository();

    const result = await repository.startRound({
      groupId: ctx.chat.id,
      username: ctx.from.username ?? String(ctx.from.id),
    });

    if (result.status === "not_creator") {
      await ctx.editMessageText("Only the group creator can start the round.");
      return;
    }

    if (result.status === "no_open_round") {
      await ctx.editMessageText("No open round to start. Tap Join first.");
      return;
    }

    if (result.status === "not_enough_players") {
      await ctx.editMessageText(
        `Need at least 2 players to start. Players joined: ${result.participantCount}.`,
      );
      return;
    }

    await ctx.editMessageText(`Round started. Players joined: ${result.participantCount}.`);
    await sendCountdown(ctx, result.gifPack);
    await completeRandomElimination(ctx, repository);
  } catch (err) {
    if (isGameStorageConfigError(err)) {
      await ctx.editMessageText("Round storage is not configured. Set REDIS_URL before starting rounds.");
      return;
    }
    throw err;
  }
});

export default composer;
