import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { getGameRepository, isGameStorageConfigError } from "../game/runtime.js";

const composer = new Composer<Ctx>();

export const USERNAME_REQUIRED_TEXT =
  "You need a Telegram username to use this command. Set one in Telegram Settings.";

composer.command("round", async (ctx) => {
  if (!ctx.chat || !ctx.from) {
    await ctx.reply("Unable to show round: Telegram did not include chat or user details.");
    return;
  }

  try {
    const repository = await getGameRepository();

    if (!ctx.from.username) {
      await ctx.reply(USERNAME_REQUIRED_TEXT);
      return;
    }

    await repository.getBalance({
      groupId: ctx.chat.id,
      user: {
        id: ctx.from.id,
        username: ctx.from.username,
        displayName:
          [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") ||
          "Player",
      },
    });

    const round = ctx.session.currentRound;
    if (!round) {
      await ctx.reply("No active round in this chat. Join a round first with /join.");
      return;
    }

    const lines = [
      `Round: ${round.state}`,
      `Stake: ${round.stake} points`,
      `Participants (${round.joinList.length}): ${round.joinList.join(", ")}`,
    ];

    await ctx.reply(lines.join("\n"));
  } catch (err) {
    if (isGameStorageConfigError(err)) {
      await ctx.reply(
        "Round storage is not configured. Set REDIS_URL before viewing rounds.",
      );
      return;
    }
    throw err;
  }
});

export default composer;
