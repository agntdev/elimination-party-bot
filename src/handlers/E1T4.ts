import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError } from "../game/runtime.js";

const composer = new Composer<Ctx>();

function displayName(ctx: Ctx): string {
  return [ctx.from?.first_name, ctx.from?.last_name].filter(Boolean).join(" ") || "Player";
}

function groupName(ctx: Ctx): string | undefined {
  const chat = ctx.chat as { title?: string; username?: string; first_name?: string } | undefined;
  return chat?.title ?? chat?.username ?? chat?.first_name;
}

function formatBalance(balance: number, inCurrentRound: boolean): string {
  return `Balance: ${balance} points | In current round: ${inCurrentRound ? "Yes" : "No"}`;
}

async function loadBalanceText(ctx: Ctx): Promise<string> {
  if (!ctx.chat || !ctx.from) {
    return "Unable to show balance: Telegram did not include chat or user details.";
  }

  const repository = await getGameRepository();
  const result = await repository.getBalance({
    groupId: ctx.chat.id,
    groupName: groupName(ctx),
    user: {
      id: ctx.from.id,
      username: ctx.from.username,
      displayName: displayName(ctx),
    },
  });

  return formatBalance(result.balance, result.inCurrentRound);
}

async function storageErrorText(err: unknown): Promise<string | undefined> {
  if (isGameStorageConfigError(err)) {
    return "Balance storage is not configured. Set REDIS_URL before checking balance.";
  }
  return undefined;
}

composer.command("balance", async (ctx) => {
  try {
    await ctx.reply(await loadBalanceText(ctx));
  } catch (err) {
    const text = await storageErrorText(err);
    if (text) {
      await ctx.reply(text);
      return;
    }
    throw err;
  }
});

composer.callbackQuery("menu:balance", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    await ctx.editMessageText(await loadBalanceText(ctx));
  } catch (err) {
    const text = await storageErrorText(err);
    if (text) {
      await ctx.editMessageText(text);
      return;
    }
    throw err;
  }
});

export default composer;
