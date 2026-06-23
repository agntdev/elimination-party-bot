import { describe, expect, it } from "vitest";
import { completeRandomElimination } from "../src/handlers/E4T1.js";

type EliminationContext = Parameters<typeof completeRandomElimination>[0];
type EliminationRepository = Parameters<typeof completeRandomElimination>[1];

function fakeContext(messages: string[], chatId = -1001): EliminationContext {
  return {
    chat: { id: chatId },
    reply: async (text: string) => {
      messages.push(text);
      return undefined;
    },
  } as unknown as EliminationContext;
}

describe("completeRandomElimination", () => {
  it("announces the eliminated user", async () => {
    const messages: string[] = [];
    const repository: EliminationRepository = {
      eliminateRandomPlayer: async () => ({
        status: "completed",
        eliminatedUserId: 77,
        participantCount: 3,
        stakeAmount: 10,
        payouts: [
          { userId: 42, amount: 5 },
          { userId: 99, amount: 5 },
        ],
      }),
    };

    await completeRandomElimination(fakeContext(messages), repository);

    expect(messages).toEqual(["Eliminated player: 77.\nPayouts: 42 +5, 99 +5."]);
  });

  it("reports when no countdown round is ready", async () => {
    const messages: string[] = [];
    const repository: EliminationRepository = {
      eliminateRandomPlayer: async () => ({ status: "no_countdown_round" }),
    };

    await completeRandomElimination(fakeContext(messages), repository);

    expect(messages).toEqual(["No countdown round is ready for elimination."]);
  });
});
