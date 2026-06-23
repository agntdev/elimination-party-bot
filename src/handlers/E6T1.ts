import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository } from "../game/runtime.js";
import { storeRoundSession } from "../game/round-session.js";
import { inlineButton, inlineKeyboard } from "../toolkit/ui/keyboard.js";

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
    if (err instanceof Error && err.message.includes("DATABASE_URL")) {
      await ctx.reply("Round storage is not configured. Set DATABASE_URL before joining rounds.");
      return;
    }
    throw err;
  }
});

export default composer;
