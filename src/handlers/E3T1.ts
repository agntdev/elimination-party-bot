import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import type { CountdownGifPack } from "../game/repository.js";

const composer = new Composer<Ctx>();
const COUNTDOWN_STEPS = [3, 2, 1] as const;
const GIF_KEYS: Record<(typeof COUNTDOWN_STEPS)[number], string[]> = {
  3: ["3", "three", "countdown3", "countdown_3"],
  2: ["2", "two", "countdown2", "countdown_2"],
  1: ["1", "one", "countdown1", "countdown_1"],
};

type DelayFn = (ms: number) => Promise<void>;
type CountdownContext = Pick<Ctx, "reply" | "replyWithAnimation">;

const defaultDelay: DelayFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let delay: DelayFn = defaultDelay;

export function setCountdownDelayForTests(nextDelay: DelayFn): void {
  delay = nextDelay;
}

export function resetCountdownDelayForTests(): void {
  delay = defaultDelay;
}

function gifUrlForStep(gifPack: CountdownGifPack, step: (typeof COUNTDOWN_STEPS)[number]): string | undefined {
  return GIF_KEYS[step].map((key) => gifPack[key]).find((url) => typeof url === "string" && url !== "");
}

export async function sendCountdown(ctx: CountdownContext, gifPack: CountdownGifPack): Promise<void> {
  let first = true;
  for (const step of COUNTDOWN_STEPS) {
    if (!first) {
      await delay(1000);
    }
    first = false;

    const gifUrl = gifUrlForStep(gifPack, step);
    if (gifUrl) {
      await ctx.replyWithAnimation(gifUrl, { caption: String(step) });
    } else {
      await ctx.reply(String(step));
    }
  }
}

export default composer;
