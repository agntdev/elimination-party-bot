import { describe, expect, it } from "vitest";
import { PostgresGameRepository } from "../src/game/repository.js";
import type { Queryable } from "../src/db/schema.js";

class ScriptedDb implements Queryable {
  readonly calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];

  constructor(private readonly rows: Array<Record<string, unknown>[]>) {}

  async query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }> {
    this.calls.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    const rows = this.rows.shift();
    if (!rows) throw new Error(`No scripted result for query: ${sql}`);
    return { rows };
  }
}

const joinInput = {
  groupId: -1001,
  groupName: "Party chat",
  user: { id: 42, username: "player", displayName: "Test Player" },
};

describe("PostgresGameRepository", () => {
  it("returns leaderboard entries sorted by balance with pagination state", async () => {
    const db = new ScriptedDb([
      [
        { user_id: 1, display_name: "Ada", username: "ada", balance: 900 },
        { user_id: 2, display_name: "Ben", username: null, balance: 800 },
        { user_id: 3, display_name: "Cam", username: "cam", balance: 700 },
      ],
    ]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.getLeaderboard({ groupId: -1001, page: 0, perPage: 2 })).resolves.toEqual({
      entries: [
        { userId: 1, displayName: "Ada", username: "ada", balance: 900 },
        { userId: 2, displayName: "Ben", username: undefined, balance: 800 },
      ],
      page: 0,
      perPage: 2,
      hasPrevious: false,
      hasNext: true,
    });

    expect(db.calls[0]?.params).toEqual([-1001, 3, 0]);
  });

  it("marks later leaderboard pages as having a previous page", async () => {
    const db = new ScriptedDb([[{ user_id: 3, display_name: "Cam", username: null, balance: 700 }]]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.getLeaderboard({ groupId: -1001, page: 1, perPage: 2 })).resolves.toMatchObject({
      page: 1,
      hasPrevious: true,
      hasNext: false,
    });

    expect(db.calls[0]?.params).toEqual([-1001, 3, 2]);
  });

  it("updates the group stake for the creator", async () => {
    const db = new ScriptedDb([[{ creator_id: 42 }], [{ stake_amount: 25 }]]);
    const repository = new PostgresGameRepository(db);

    await expect(
      repository.setStake({
        groupId: -1001,
        groupName: "Party chat",
        userId: 42,
        amount: 25,
      }),
    ).resolves.toEqual({
      status: "updated",
      stakeAmount: 25,
    });

    const update = db.calls.find((call) => call.sql.includes("SET stake_amount = $2"));
    expect(update?.params).toEqual([-1001, 25]);
  });

  it("refuses stake updates from non-creators", async () => {
    const db = new ScriptedDb([[{ creator_id: 77 }]]);
    const repository = new PostgresGameRepository(db);

    await expect(
      repository.setStake({
        groupId: -1001,
        userId: 42,
        amount: 25,
      }),
    ).resolves.toEqual({
      status: "not_creator",
    });

    expect(db.calls.some((call) => call.sql.includes("SET stake_amount = $2"))).toBe(false);
  });

  it("rejects invalid stake amounts before querying storage", async () => {
    const db = new ScriptedDb([]);
    const repository = new PostgresGameRepository(db);

    await expect(
      repository.setStake({
        groupId: -1001,
        userId: 42,
        amount: 0,
      }),
    ).rejects.toThrow("stake amount must be an integer greater than or equal to 1");

    expect(db.calls).toEqual([]);
  });

  it("returns player balance and current-round membership", async () => {
    const db = new ScriptedDb([[{ id: -1001 }], [{ balance: 500 }], [{ join_list: [42, 77] }]]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.getBalance(joinInput)).resolves.toEqual({
      balance: 500,
      inCurrentRound: true,
    });
  });

  it("returns not in round when there is no open round", async () => {
    const db = new ScriptedDb([[{ id: -1001 }], [{ balance: 500 }], []]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.getBalance(joinInput)).resolves.toEqual({
      balance: 500,
      inCurrentRound: false,
    });
  });

  it("adds a funded player to a new open round", async () => {
    const db = new ScriptedDb([
      [{ stake_amount: 10, join_window_seconds: 30 }],
      [{ balance: 500 }],
      [],
      [{ id: "round-1", join_list: [], join_window_started_at: null, join_window_expires_at: null }],
      [{ join_list: [42] }],
    ]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.joinRound(joinInput)).resolves.toEqual({
      status: "joined",
      balance: 500,
      stakeAmount: 10,
      participantCount: 1,
      joinList: [42],
      joinWindowStarted: false,
      joinWindowSeconds: 30,
    });

    expect(db.calls.some((call) => call.sql.includes("INSERT INTO groups"))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO players"))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO rounds"))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("jsonb_build_array"))).toBe(true);
  });

  it("starts the join window when the second player joins", async () => {
    const db = new ScriptedDb([
      [{ stake_amount: 10, join_window_seconds: 30 }],
      [{ balance: 500 }],
      [{ id: "round-1", join_list: [77], join_window_started_at: null, join_window_expires_at: null }],
      [{ join_list: [77, 42] }],
      [
        {
          join_window_started_at: "2026-06-23T12:00:00.000Z",
          join_window_expires_at: "2026-06-23T12:00:30.000Z",
        },
      ],
    ]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.joinRound(joinInput)).resolves.toEqual({
      status: "joined",
      balance: 500,
      stakeAmount: 10,
      participantCount: 2,
      joinList: [77, 42],
      joinWindowStarted: true,
      joinWindowSeconds: 30,
      joinWindowStartedAt: "2026-06-23T12:00:00.000Z",
      joinWindowExpiresAt: "2026-06-23T12:00:30.000Z",
    });

    const joinWindowUpdate = db.calls.find((call) => call.sql.includes("join_window_started_at = now()"));
    expect(joinWindowUpdate?.params).toEqual(["round-1", 30]);
  });

  it("does not add a player whose balance is below the group stake", async () => {
    const db = new ScriptedDb([[{ stake_amount: 10, join_window_seconds: 30 }], [{ balance: 5 }]]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.joinRound(joinInput)).resolves.toEqual({
      status: "insufficient_balance",
      balance: 5,
      stakeAmount: 10,
    });

    expect(db.calls.some((call) => call.sql.includes("INSERT INTO rounds"))).toBe(false);
    expect(db.calls.some((call) => call.sql.includes("UPDATE rounds"))).toBe(false);
  });

  it("keeps a player from joining the same open round twice", async () => {
    const db = new ScriptedDb([
      [{ stake_amount: 10, join_window_seconds: 30 }],
      [{ balance: 500 }],
      [{ id: "round-1", join_list: [42, 77], join_window_started_at: null, join_window_expires_at: null }],
    ]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.joinRound(joinInput)).resolves.toEqual({
      status: "already_joined",
      balance: 500,
      stakeAmount: 10,
      participantCount: 2,
      joinList: [42, 77],
    });

    expect(db.calls.some((call) => call.sql.includes("UPDATE rounds"))).toBe(false);
  });

  it("removes a player from the current open round", async () => {
    const db = new ScriptedDb([
      [{ id: "round-1", join_list: [42, 77] }],
      [{ join_list: [77] }],
    ]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.leaveRound({ groupId: -1001, userId: 42 })).resolves.toEqual({
      status: "left",
      participantCount: 1,
    });

    const update = db.calls.find((call) => call.sql.includes("UPDATE rounds"));
    expect(update?.params).toEqual(["round-1", "[77]"]);
  });

  it("does not update a round when the player has not joined", async () => {
    const db = new ScriptedDb([[{ id: "round-1", join_list: [77] }]]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.leaveRound({ groupId: -1001, userId: 42 })).resolves.toEqual({
      status: "not_in_round",
    });

    expect(db.calls.some((call) => call.sql.includes("UPDATE rounds"))).toBe(false);
  });

  it("allows the group creator to see Start Now", async () => {
    const db = new ScriptedDb([[{ creator_id: 42 }]]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.canStartRound({ groupId: -1001, userId: 42 })).resolves.toBe(true);
  });

  it("hides Start Now from non-creators", async () => {
    const db = new ScriptedDb([[{ creator_id: 77 }]]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.canStartRound({ groupId: -1001, userId: 42 })).resolves.toBe(false);
  });

  it("starts an open round for the group creator when at least two players joined", async () => {
    const db = new ScriptedDb([
      [{ creator_id: 42, gif_pack: { "3": "https://example.test/3.gif" } }],
      [{ id: "round-1", join_list: [42, 77] }],
      [],
    ]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.startRound({ groupId: -1001, userId: 42 })).resolves.toEqual({
      status: "started",
      participantCount: 2,
      gifPack: { "3": "https://example.test/3.gif" },
    });

    expect(db.calls.some((call) => call.sql.includes("SET state = 'countdown'"))).toBe(true);
  });

  it("refuses to start a round with fewer than two players", async () => {
    const db = new ScriptedDb([[{ creator_id: 42 }], [{ id: "round-1", join_list: [42] }]]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.startRound({ groupId: -1001, userId: 42 })).resolves.toEqual({
      status: "not_enough_players",
      participantCount: 1,
    });

    expect(db.calls.some((call) => call.sql.includes("SET state = 'countdown'"))).toBe(false);
  });

  it("refuses to start a round for non-creators", async () => {
    const db = new ScriptedDb([[{ creator_id: 77 }]]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.startRound({ groupId: -1001, userId: 42 })).resolves.toEqual({
      status: "not_creator",
    });

    expect(db.calls.some((call) => call.sql.includes("SELECT id, join_list"))).toBe(false);
  });

  it("completes a countdown round by eliminating a random joined player", async () => {
    const db = new ScriptedDb([
      [{ id: "round-1", stake: 10, join_list: [42, 77, 99, 123] }],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
    const repository = new PostgresGameRepository(db, (max) => {
      expect(max).toBe(4);
      return 1;
    });

    await expect(repository.eliminateRandomPlayer({ groupId: -1001 })).resolves.toEqual({
      status: "completed",
      eliminatedUserId: 77,
      participantCount: 4,
      stakeAmount: 10,
      payouts: [
        { userId: 42, amount: 4 },
        { userId: 99, amount: 3 },
        { userId: 123, amount: 3 },
      ],
    });

    const update = db.calls.find((call) => call.sql.includes("SET state = 'complete'"));
    expect(update?.params).toEqual(["round-1", 77]);
    expect(db.calls.some((call) => call.params?.includes("stake_lost"))).toBe(true);
    expect(db.calls.filter((call) => call.params?.includes("share_won")).map((call) => call.params)).toEqual([
      [-1001, 42, 4, "share_won", "round-1"],
      [-1001, 99, 3, "share_won", "round-1"],
      [-1001, 123, 3, "share_won", "round-1"],
    ]);
  });

  it("does not eliminate when there is no countdown round", async () => {
    const db = new ScriptedDb([[]]);
    const repository = new PostgresGameRepository(db, () => 0);

    await expect(repository.eliminateRandomPlayer({ groupId: -1001 })).resolves.toEqual({
      status: "no_countdown_round",
    });

    expect(db.calls.some((call) => call.sql.includes("SET state = 'complete'"))).toBe(false);
  });

  it("does not eliminate with fewer than two joined players", async () => {
    const db = new ScriptedDb([[{ id: "round-1", stake: 10, join_list: [42] }]]);
    const repository = new PostgresGameRepository(db, () => 0);

    await expect(repository.eliminateRandomPlayer({ groupId: -1001 })).resolves.toEqual({
      status: "not_enough_players",
      participantCount: 1,
    });

    expect(db.calls.some((call) => call.sql.includes("SET state = 'complete'"))).toBe(false);
  });
});
