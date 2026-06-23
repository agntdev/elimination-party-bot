import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/ui/keyboard.js";

const composer = new Composer<Ctx>();

const mainMenu = inlineKeyboard([
  [inlineButton("Join", "join:round"), inlineButton("Leave", "leave:round")],
  [inlineButton("Start now", "start:round")],
  [inlineButton("Balance", "menu:balance"), inlineButton("Leaderboard", "menu:leaderboard")],
  [inlineButton("Help", "menu:help")],
]);

composer.command("start", async (ctx) => {
  await ctx.reply("Welcome! I am ready to help.");
  await ctx.reply(
    [
      "Main menu",
      "",
      "Join an elimination round, start one now, or check scores.",
      "Commands: /balance, /leaderboard, /help",
    ].join("\n"),
    { reply_markup: mainMenu },
  );
});

export default composer;
