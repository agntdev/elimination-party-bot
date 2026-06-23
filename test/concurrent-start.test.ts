import { describe, expect, it } from "vitest";
import { FullRoundFixtureRepository } from "../src/handlers/E7T1.js";

function joinInput(userId: number) {
  return {
    groupId: 1,
    user: {
      id: userId,
      displayName: `Player ${userId}`,
    },
  };
}

describe("FullRoundFixtureRepository concurrent starts", () => {
  it("records only one successful start when two users start together", async () => {
    const repository = new FullRoundFixtureRepository();
    await repository.joinRound(joinInput(101));
    await repository.joinRound(joinInput(202));

    const results = await Promise.all([
      repository.startRound({ groupId: 1, userId: 101 }),
      repository.startRound({ groupId: 1, userId: 202 }),
    ]);

    expect(results.filter((result) => result.status === "started")).toHaveLength(1);
    expect(repository.getStartedRoundCount()).toBe(1);
  });
});
