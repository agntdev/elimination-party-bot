import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError } from "../game/runtime.js";
import {
  inlineButton,
  inlineKeyboard,
  type InlineButton,
  type InlineKeyboardMarkup,
} from "../toolkit/ui/keyboard.js";

const composer = new Composer<Ctx>();

async function canShowStartNow(ctx: Ctx): Promise<boolean> {
  if (!ctx.chat || !ctx.from || !ctx.from.username) return false;
  try {
    const repository = await getGameRepository();
    return repository.canStartRound({ groupId: ctx.chat.id, username: ctx.from.username });
  } catch (err) {
    if (isGameStorageConfigError(err)) return false;
    throw err;
  }
}

async function mainMenu(ctx: Ctx): Promise<InlineKeyboardMarkup> {
  const rows: InlineButton[][] = [
    [inlineButton("Join", "join:round"), inlineButton("Leave", "leave:round")],
  ];

  if (await canShowStartNow(ctx)) {
    rows.push([inlineButton("Start Now", "start:round")]);
  }

  rows.push(
    [inlineButton("Balance", "menu:balance"), inlineButton("Leaderboard", "menu:leaderboard")],
    [inlineButton("Help", "menu:help")],
  );

  return inlineKeyboard(rows);
}

composer.command("start", async (ctx) => {
  await ctx.reply("Welcome! I am ready to help.");
  await ctx.reply(
    [
      "Main menu",
      "",
      "Join an elimination round, start one now, or check scores.",
      "Commands: /balance, /leaderboard, /help",
    ].join("\n"),
    { reply_markup: await mainMenu(ctx) },
  );
});

export default composer;
