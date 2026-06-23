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
  it("adds a funded player to a new open round", async () => {
    const db = new ScriptedDb([
      [{ stake_amount: 10 }],
      [{ balance: 500 }],
      [],
      [{ id: "round-1", join_list: [] }],
      [{ join_list: [42] }],
    ]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.joinRound(joinInput)).resolves.toEqual({
      status: "joined",
      balance: 500,
      stakeAmount: 10,
      participantCount: 1,
    });

    expect(db.calls.some((call) => call.sql.includes("INSERT INTO groups"))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO players"))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("INSERT INTO rounds"))).toBe(true);
    expect(db.calls.some((call) => call.sql.includes("jsonb_build_array"))).toBe(true);
  });

  it("does not add a player whose balance is below the group stake", async () => {
    const db = new ScriptedDb([[{ stake_amount: 10 }], [{ balance: 5 }]]);
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
      [{ stake_amount: 10 }],
      [{ balance: 500 }],
      [{ id: "round-1", join_list: [42, 77] }],
    ]);
    const repository = new PostgresGameRepository(db);

    await expect(repository.joinRound(joinInput)).resolves.toEqual({
      status: "already_joined",
      balance: 500,
      stakeAmount: 10,
      participantCount: 2,
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
});
