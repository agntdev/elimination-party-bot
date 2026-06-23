import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { START_GAME_INLINE_RESULT_ID } from "./E9T1.js";
import { inlineButton, inlineKeyboard } from "../toolkit/ui/keyboard.js";

const composer = new Composer<Ctx>();

composer.on("chosen_inline_result", async (ctx) => {
  const result = ctx.chosenInlineResult;
  if (result.result_id !== START_GAME_INLINE_RESULT_ID) return;
  if (!result.inline_message_id) return;

  await ctx.api.editMessageTextInline(
    result.inline_message_id,
    `Elimination Party\n\nParticipants: 0`,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Join", "join:round")],
      ]),
    },
  );
});

export default composer;