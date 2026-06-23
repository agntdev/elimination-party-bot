import { afterEach, describe, expect, it } from "vitest";
import {
  resetCountdownDelayForTests,
  sendCountdown,
  setCountdownDelayForTests,
} from "../src/handlers/E3T1.js";

type CountdownContext = Parameters<typeof sendCountdown>[0];

function fakeContext(events: string[]): CountdownContext {
  return {
    replyWithAnimation: async (animation: string, options?: { caption?: string }) => {
      events.push(`animation:${animation}:${options?.caption ?? ""}`);
      return undefined;
    },
    reply: async (text: string) => {
      events.push(`text:${text}`);
      return undefined;
    },
  } as unknown as CountdownContext;
}

describe("sendCountdown", () => {
  afterEach(() => {
    resetCountdownDelayForTests();
  });

  it("sends configured GIFs for 3, 2, 1 with delays between messages", async () => {
    const events: string[] = [];
    setCountdownDelayForTests(async (ms) => {
      events.push(`delay:${ms}`);
    });

    await sendCountdown(fakeContext(events), {
      three: "https://example.test/three.gif",
      "2": "https://example.test/two.gif",
      countdown_1: "https://example.test/one.gif",
    });

    expect(events).toEqual([
      "animation:https://example.test/three.gif:3",
      "delay:1000",
      "animation:https://example.test/two.gif:2",
      "delay:1000",
      "animation:https://example.test/one.gif:1",
    ]);
  });

  it("falls back to text for countdown steps without configured GIFs", async () => {
    const events: string[] = [];
    setCountdownDelayForTests(async (ms) => {
      events.push(`delay:${ms}`);
    });

    await sendCountdown(fakeContext(events), {
      "3": "https://example.test/three.gif",
    });

    expect(events).toEqual([
      "animation:https://example.test/three.gif:3",
      "delay:1000",
      "text:2",
      "delay:1000",
      "text:1",
    ]);
  });
});
