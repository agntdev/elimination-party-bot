import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError } from "../game/runtime.js";
import { storeRoundSession } from "../game/round-session.js";
import { insufficientBalanceReplyMarkup } from "./E6T1.js";
import { USERNAME_REQUIRED_TEXT } from "./E8T3.js";

const composer = new Composer<Ctx>();

function displayName(ctx: Ctx): string {
  return [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "Player";
}

function groupName(ctx: Ctx): string | undefined {
  const chat = ctx.chat as { title?: string; username?: string; first_name?: string } | undefined;
  return chat?.title ?? chat?.username ?? chat?.first_name;
}

composer.callbackQuery("join:round", async (ctx) => {
  await ctx.answerCallbackQuery();

  if (!ctx.chat || !ctx.from) {
    await ctx.editMessageText("Unable to join: Telegram did not include chat or user details.");
    return;
  }

  try {
    const repository = await getGameRepository();

    if (!ctx.from.username) {
      await ctx.editMessageText(USERNAME_REQUIRED_TEXT);
      return;
    }

    const result = await repository.joinRound({
      groupId: ctx.chat.id,
      groupName: groupName(ctx),
      user: {
        id: ctx.from.id,
        username: ctx.from.username,
        displayName: displayName(ctx),
      },
    });

    if (result.status === "insufficient_balance") {
      await ctx.editMessageText(`Not enough points! Current balance: ${result.balance}`, {
        reply_markup: insufficientBalanceReplyMarkup(),
      });
      return;
    }

    storeRoundSession(ctx.session, {
      groupId: ctx.chat.id,
      stake: result.stakeAmount,
      state: "open",
      joinList: result.joinList,
      ...(result.joinWindowStartedAt ? { joinWindowStartedAt: result.joinWindowStartedAt } : {}),
      ...(result.joinWindowExpiresAt ? { joinWindowExpiresAt: result.joinWindowExpiresAt } : {}),
    });

    if (result.status === "already_joined") {
      await ctx.editMessageText(
        `You are already in this round. Players joined: ${result.participantCount}.`,
      );
      return;
    }

    const joinWindow = result.joinWindowStarted
      ? ` Join window: ${result.joinWindowSeconds}s.`
      : "";
    await ctx.editMessageText(
      `Joined the round. Stake: ${result.stakeAmount} points. Players joined: ${result.participantCount}.${joinWindow}`,
    );
  } catch (err) {
    if (isGameStorageConfigError(err)) {
      await ctx.editMessageText("Round storage is not configured. Set REDIS_URL before joining rounds.");
      return;
    }
    throw err;
  }
});

export default composer;
