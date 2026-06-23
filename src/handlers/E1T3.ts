import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository } from "../game/runtime.js";
import { sendCountdown } from "./E3T1.js";

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
      userId: ctx.from.id,
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
  } catch (err) {
    if (err instanceof Error && err.message.includes("DATABASE_URL")) {
      await ctx.editMessageText("Round storage is not configured. Set DATABASE_URL before starting rounds.");
      return;
    }
    throw err;
  }
});

export default composer;
