import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository } from "../game/runtime.js";

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
      await ctx.editMessageText(`Not enough points! Current balance: ${result.balance}`);
      return;
    }

    if (result.status === "already_joined") {
      await ctx.editMessageText(
        `You are already in this round. Players joined: ${result.participantCount}.`,
      );
      return;
    }

    await ctx.editMessageText(
      `Joined the round. Stake: ${result.stakeAmount} points. Players joined: ${result.participantCount}.`,
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("DATABASE_URL")) {
      await ctx.editMessageText("Round storage is not configured. Set DATABASE_URL before joining rounds.");
      return;
    }
    throw err;
  }
});

export default composer;
