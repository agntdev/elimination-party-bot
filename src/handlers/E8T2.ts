import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError } from "../game/runtime.js";

const composer = new Composer<Ctx>();

composer.command("leave", async (ctx) => {
  if (!ctx.chat || !ctx.from) {
    await ctx.reply("Unable to leave: Telegram did not include chat or user details.");
    return;
  }

  try {
    const repository = await getGameRepository();

    if (!ctx.from.username) {
      await ctx.reply("You need a Telegram username to use this command. Set one in Telegram Settings.");
      return;
    }

    const result = await repository.leaveRound({
      groupId: ctx.chat.id,
      username: ctx.from.username,
    });

    if (result.status === "not_in_round") {
      await ctx.reply("You are not in the current open round.");
      return;
    }

    await ctx.reply(`You left the round. Players joined: ${result.participantCount}.`);
  } catch (err) {
    if (isGameStorageConfigError(err)) {
      await ctx.reply("Round storage is not configured. Set REDIS_URL before leaving rounds.");
      return;
    }
    throw err;
  }
});

export default composer;