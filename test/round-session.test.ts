import { describe, expect, it } from "vitest";
import { storeRoundSession, type RoundSessionContainer } from "../src/game/round-session.js";

describe("storeRoundSession", () => {
  it("stores a serializable round snapshot in session state", () => {
    const session: RoundSessionContainer = {};
    const joinList = [77, 42];

    storeRoundSession(session, {
      groupId: -1001,
      stake: 10,
      state: "open",
      joinList,
      joinWindowStartedAt: "2026-06-23T12:00:00.000Z",
      joinWindowExpiresAt: "2026-06-23T12:00:30.000Z",
    });
    joinList.push(99);

    expect(session.currentRound).toEqual({
      groupId: -1001,
      stake: 10,
      state: "open",
      joinList: [77, 42],
      joinWindowStartedAt: "2026-06-23T12:00:00.000Z",
      joinWindowExpiresAt: "2026-06-23T12:00:30.000Z",
    });
  });
});
