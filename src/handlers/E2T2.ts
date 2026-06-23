import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError } from "../game/runtime.js";
import { USERNAME_REQUIRED_TEXT } from "./E8T3.js";

const composer = new Composer<Ctx>();
const USAGE_TEXT = "Usage: /setstake <amount>. Amount must be at least 1.";

function groupName(ctx: Ctx): string | undefined {
  const chat = ctx.chat as { title?: string; username?: string; first_name?: string } | undefined;
  return chat?.title ?? chat?.username ?? chat?.first_name;
}

function parseStakeAmount(match: unknown): number | undefined {
  if (typeof match !== "string") return undefined;
  const parts = match.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 1 || !/^\d+$/.test(parts[0] ?? "")) return undefined;
  const amount = Number(parts[0]);
  return Number.isSafeInteger(amount) ? amount : undefined;
}

function storageErrorText(err: unknown): string | undefined {
  if (isGameStorageConfigError(err)) {
    return "Stake storage is not configured. Set REDIS_URL before setting stakes.";
  }
  return undefined;
}

composer.command("setstake", async (ctx) => {
  const amount = parseStakeAmount(ctx.match);
  if (amount === undefined || amount < 1) {
    await ctx.reply(USAGE_TEXT);
    return;
  }

  if (!ctx.chat || !ctx.from) {
    await ctx.reply("Unable to set stake: Telegram did not include chat or user details.");
    return;
  }

  try {
    const repository = await getGameRepository();

    if (!ctx.from.username) {
      await ctx.reply(USERNAME_REQUIRED_TEXT);
      return;
    }

    const result = await repository.setStake({
      groupId: ctx.chat.id,
      groupName: groupName(ctx),
      username: ctx.from.username,
      amount,
    });

    if (result.status === "not_creator") {
      await ctx.reply("Only the group creator can set the stake.");
      return;
    }

    await ctx.reply(`Stake set to ${result.stakeAmount} points.`);
  } catch (err) {
    const text = storageErrorText(err);
    if (text) {
      await ctx.reply(text);
      return;
    }
    throw err;
  }
});

export default composer;
