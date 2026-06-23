import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository } from "../game/runtime.js";

const composer = new Composer<Ctx>();

composer.callbackQuery("leave:round", async (ctx) => {
  await ctx.answerCallbackQuery();

  if (!ctx.chat || !ctx.from) {
    await ctx.editMessageText("Unable to leave: Telegram did not include chat or user details.");
    return;
  }

  try {
    const repository = await getGameRepository();
    const result = await repository.leaveRound({
      groupId: ctx.chat.id,
      userId: ctx.from.id,
    });

    if (result.status === "not_in_round") {
      await ctx.editMessageText("You are not in the current open round.");
      return;
    }

    await ctx.editMessageText(`You left the round. Players joined: ${result.participantCount}.`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("DATABASE_URL")) {
      await ctx.editMessageText("Round storage is not configured. Set DATABASE_URL before leaving rounds.");
      return;
    }
    throw err;
  }
});

export default composer;
