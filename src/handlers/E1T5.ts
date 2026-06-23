import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError } from "../game/runtime.js";
import { inlineButton, inlineKeyboard, type InlineButton } from "../toolkit/ui/keyboard.js";
import type { LeaderboardResult } from "../game/repository.js";

const composer = new Composer<Ctx>();
const PER_PAGE = 10;

function formatLeaderboard(result: LeaderboardResult): string {
  if (result.entries.length === 0) {
    return "Global leaderboard is empty. Join a round to appear here.";
  }

  const startRank = result.page * result.perPage + 1;
  return [
    `Global leaderboard - page ${result.page + 1}`,
    ...result.entries.map(
      (entry, index) => `${startRank + index}. ${entry.displayName} - ${entry.balance} points`,
    ),
  ].join("\n");
}

function leaderboardKeyboard(result: LeaderboardResult) {
  const row: InlineButton[] = [];
  if (result.hasPrevious) {
    row.push(inlineButton("← Previous", `leaderboard:page:${result.page - 1}`));
  }
  if (result.hasNext) {
    row.push(inlineButton("Next →", `leaderboard:page:${result.page + 1}`));
  }
  return row.length > 0 ? inlineKeyboard([row]) : undefined;
}

function parsePage(data: string): number {
  const page = Number(data.split(":")[2]);
  return Number.isInteger(page) && page >= 0 ? page : 0;
}

async function loadLeaderboard(ctx: Ctx, page: number): Promise<LeaderboardResult> {
  if (!ctx.chat) {
    return { entries: [], page: 0, perPage: PER_PAGE, hasPrevious: false, hasNext: false };
  }
  const repository = await getGameRepository();
  return repository.getLeaderboard({ groupId: ctx.chat.id, page, perPage: PER_PAGE });
}

function storageErrorText(err: unknown): string | undefined {
  if (isGameStorageConfigError(err)) {
    return "Leaderboard storage is not configured. Set REDIS_URL before viewing standings.";
  }
  return undefined;
}

composer.command("leaderboard", async (ctx) => {
  try {
    const result = await loadLeaderboard(ctx, 0);
    if (!ctx.from?.username) {
      await ctx.reply("You need a Telegram username to use this command. Set one in Telegram Settings.");
      return;
    }
    await ctx.reply(formatLeaderboard(result), { reply_markup: leaderboardKeyboard(result) });
  } catch (err) {
    const text = storageErrorText(err);
    if (text) {
      await ctx.reply(text);
      return;
    }
    throw err;
  }
});

composer.callbackQuery("menu:leaderboard", async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const result = await loadLeaderboard(ctx, 0);
    if (!ctx.from?.username) {
      await ctx.editMessageText("You need a Telegram username to use this command. Set one in Telegram Settings.");
      return;
    }
    await ctx.editMessageText(formatLeaderboard(result), {
      reply_markup: leaderboardKeyboard(result),
    });
  } catch (err) {
    const text = storageErrorText(err);
    if (text) {
      await ctx.editMessageText(text);
      return;
    }
    throw err;
  }
});

composer.callbackQuery(/^leaderboard:page:\d+$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  try {
    const result = await loadLeaderboard(ctx, parsePage(ctx.callbackQuery.data));
    if (!ctx.from?.username) {
      await ctx.editMessageText("You need a Telegram username to use this command. Set one in Telegram Settings.");
      return;
    }
    await ctx.editMessageText(formatLeaderboard(result), {
      reply_markup: leaderboardKeyboard(result),
    });
  } catch (err) {
    const text = storageErrorText(err);
    if (text) {
      await ctx.editMessageText(text);
      return;
    }
    throw err;
  }
});

export default composer;
