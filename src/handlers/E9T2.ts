import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { START_GAME_INLINE_RESULT_ID } from "./E9T1.js";
import { storeInlineMessageCreator } from "../game/inline-state.js";
import { inlineButton, inlineKeyboard } from "../toolkit/ui/keyboard.js";

const DEFAULT_STAKE = 10;

const composer = new Composer<Ctx>();

composer.on("chosen_inline_result", async (ctx) => {
  const result = ctx.chosenInlineResult;
  if (result.result_id !== START_GAME_INLINE_RESULT_ID) return;
  if (!result.inline_message_id) return;

  await ctx.api.editMessageTextInline(
    result.inline_message_id,
    `Elimination Party\n\nParticipants: 0\nStake: ${DEFAULT_STAKE} points`,
  );

  await storeInlineMessageCreator(result.inline_message_id, result.from.id, result.from.username);

  await ctx.api.editMessageReplyMarkupInline(
    result.inline_message_id,
    {
      reply_markup: inlineKeyboard([
        [inlineButton("Join", "join:round"), inlineButton("Run Round Now", "start:round")],
      ]),
    },
  );
});

export default composer;