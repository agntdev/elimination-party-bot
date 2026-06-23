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
      [{ creator_id: 42 }],
      [{ id: "round-1", join_list: [42, 77] }],
      [],
    ]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.startRound({ groupId: -1001, userId: 42 })).resolves.toEqual({
      status: "started",
      participantCount: 2,
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
});
