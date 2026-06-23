import { Composer } from "grammy";
import type { Ctx } from "../bot.js";

const composer = new Composer<Ctx>();

composer.command("start", async (ctx) => {
  await ctx.reply("Welcome! I am ready to help.");
});

export default composer;
