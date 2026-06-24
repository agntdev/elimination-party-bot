import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError } from "../game/runtime.js";
import { storeRoundSession } from "../game/round-session.js";
import { inlineButton, inlineKeyboard } from "../toolkit/ui/keyboard.js";
import { scheduleAutoStartTimer } from "./E10T2.js";

const composer = new Composer<Ctx>();

export function insufficientBalanceReplyMarkup() {
  return inlineKeyboard([[inlineButton("/balance", "menu:balance")]]);
}

function displayName(ctx: Ctx): string {
  return [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "Player";
}

function groupName(ctx: Ctx): string | undefined {
  const chat = ctx.chat as { title?: string; username?: string; first_name?: string } | undefined;
  return chat?.title ?? chat?.username ?? chat?.first_name;
}

composer.command("join", async (ctx) => {
  if (!ctx.chat || !ctx.from) {
    await ctx.reply("Unable to join: Telegram did not include chat or user details.");
    return;
  }

  try {
    const repository = await getGameRepository();

    if (!ctx.from.username) {
      await ctx.reply("You need a Telegram username to use this command. Set one in Telegram Settings.");
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
      await ctx.reply(`Not enough points! Current balance: ${result.balance}`, {
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

    if (result.joinWindowStarted) {
      const expiresAtMs = result.joinWindowExpiresAt
        ? new Date(result.joinWindowExpiresAt).getTime()
        : Date.now() + (result.joinWindowSeconds ?? 30) * 1000;
      const delayMs = Math.max(0, expiresAtMs - Date.now());
      scheduleAutoStartTimer(ctx.chat.id, delayMs);
    }

    if (result.status === "already_joined") {
      await ctx.reply(`You are already in this round. Players joined: ${result.participantCount}.`);
      return;
    }

    const joinWindow = result.joinWindowStarted
      ? ` Join window: ${result.joinWindowSeconds}s.`
      : "";
    await ctx.reply(
      `Joined the round. Stake: ${result.stakeAmount} points. Players joined: ${result.participantCount}.${joinWindow}`,
    );
  } catch (err) {
    if (isGameStorageConfigError(err)) {
      await ctx.reply("Round storage is not configured. Set REDIS_URL before joining rounds.");
      return;
    }
    throw err;
  }
});

export default composer;
