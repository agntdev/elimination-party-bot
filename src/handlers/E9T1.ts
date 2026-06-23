import { Composer } from "grammy";
import type { InlineQueryResultArticle } from "grammy/types";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard } from "../toolkit/ui/keyboard.js";

const composer = new Composer<Ctx>();

export const START_GAME_INLINE_RESULT_ID = "start-elimination-game";

export const START_GAME_INLINE_MESSAGE = [
  "Elimination Party",
  "",
  "Start a new elimination round in this chat.",
  "Players can join the round, then the creator can run it when everyone is ready.",
].join("\n");

export function startGameInlineResult(): InlineQueryResultArticle {
  return {
    type: "article",
    id: START_GAME_INLINE_RESULT_ID,
    title: "Start an elimination game",
    description: "Post a starter message in this chat.",
    input_message_content: {
      message_text: START_GAME_INLINE_MESSAGE,
    },
    reply_markup: inlineKeyboard([
      [inlineButton("Join", "join:round"), inlineButton("Run Round Now", "start:round")],
    ]),
  };
}

composer.inlineQuery(/^start$/i, async (ctx) => {
  await ctx.answerInlineQuery([startGameInlineResult()], {
    cache_time: 0,
    is_personal: true,
  });
});

composer.on("inline_query", async (ctx) => {
  await ctx.answerInlineQuery([], {
    cache_time: 0,
    is_personal: true,
  });
});

export default composer;
