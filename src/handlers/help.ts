import { Composer } from "grammy";
import type { Ctx } from "../bot.js";

const HELP_TEXT = [
  "Elimination Party Bot help",
  "",
  "Commands:",
  "/start - Show the main menu",
  "/help - Show this help",
  "/balance - Show your points and round status",
  "/leaderboard - Show the group leaderboard",
  "/setstake <amount> - Set the group stake",
  "",
  "Main menu buttons:",
  "Join - Enter the open round",
  "Leave - Leave before the countdown",
  "Start Now - Begin once enough players have joined",
  "Balance - Open your current score",
  "Leaderboard - Open the group standings",
  "Help - Open this guide",
  "",
  "Rules: join a round, survive the elimination, and share the eliminated player's stake.",
].join("\n");

const composer = new Composer<Ctx>();

composer.command("help", async (ctx) => {
  await ctx.reply(HELP_TEXT);
});

composer.callbackQuery("menu:help", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(HELP_TEXT);
});

export default composer;
