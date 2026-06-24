import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError } from "../game/runtime.js";
import { USERNAME_REQUIRED_TEXT } from "./E8T3.js";
import { sendCountdown } from "./E3T1.js";
import { completeRandomElimination } from "./E4T1.js";

const composer = new Composer<Ctx>();

composer.command("startimmediate", async (ctx) => {
  if (!ctx.chat || !ctx.from) {
    await ctx.reply("Unable to start: Telegram did not include chat or user details.");
    return;
  }

  try {
    const repository = await getGameRepository();

    if (!ctx.from.username) {
      await ctx.reply(USERNAME_REQUIRED_TEXT);
      return;
    }

    const canStart = await repository.canStartRound({
      groupId: ctx.chat.id,
      username: ctx.from.username,
    });

    if (!canStart) {
      await ctx.reply("Only the group creator can force-start a round with /startimmediate.");
      return;
    }

    const result = await repository.startRound({
      groupId: ctx.chat.id,
      username: ctx.from.username,
    });

    if (result.status === "not_creator") {
      await ctx.reply("Only the group creator can force-start a round with /startimmediate.");
      return;
    }

    if (result.status === "no_open_round") {
      await ctx.reply("No open round to start. Tap Join first.");
      return;
    }

    if (result.status === "not_enough_players") {
      await ctx.reply(
        `Need at least 2 players to start. Players joined: ${result.participantCount}.`,
      );
      return;
    }

    await ctx.reply(`Round started immediately. Players joined: ${result.participantCount}.`);
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

composer.callbackQuery("start:immediate", async (ctx) => {
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
      await ctx.editMessageText("Only the group creator can force-start the round.");
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

    await ctx.editMessageText(`Round started immediately. Players joined: ${result.participantCount}.`);
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