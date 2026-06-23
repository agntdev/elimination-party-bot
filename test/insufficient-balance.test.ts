import { describe, expect, it } from "vitest";
import { insufficientBalanceReplyMarkup } from "../src/handlers/E6T1.js";

describe("insufficientBalanceReplyMarkup", () => {
  it("links users to the balance callback", () => {
    expect(insufficientBalanceReplyMarkup()).toEqual({
      inline_keyboard: [[{ text: "/balance", callback_data: "menu:balance" }]],
    });
  });
});
