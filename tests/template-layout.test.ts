import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBot } from "../src/bot.js";
import { parseBotSpec, runSpecs } from "../src/toolkit/index.js";

const requiredTemplatePaths = [
  "src/handlers/.gitkeep",
  "tests/specs/.gitkeep",
  "tests/commands/.gitkeep",
];

describe("starter template layout", () => {
  it("keeps per-feature handler, spec, and command directories present", () => {
    for (const path of requiredTemplatePaths) {
      expect(existsSync(new URL(`../${path}`, import.meta.url)), path).toBe(true);
    }
  });

  it("boots buildBot and auto-loads the shipped /start handler", async () => {
    const bot = await buildBot("test-token");
    expect(typeof bot.start).toBe("function");

    const suite = await runSpecs(() => buildBot("test-token"), [
      parseBotSpec({
        name: "T01 /start is loaded from src/handlers/start.ts",
        steps: [
          {
            send: { text: "/start" },
            expect: [
              {
                method: "sendMessage",
                payload: { text: "Welcome! I am ready to help." },
              },
            ],
          },
        ],
      }),
    ]);

    expect(suite.failed).toBe(0);
    expect(suite.passed).toBe(1);
  });
});
