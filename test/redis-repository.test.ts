import { describe, expect, it } from "vitest";
import {
  RedisGameRepository,
  type RedisGameClient,
} from "../src/game/redis-repository.js";

class FakeRedis implements RedisGameClient {
  readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async set(key: string, value: string, ...args: string[]): Promise<unknown> {
    if (args.includes("NX") && this.store.has(key)) return null;
    this.store.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<unknown> {
    return this.store.delete(key) ? 1 : 0;
  }
}

const groupId = -1001;

function user(id: number, displayName: string, username = displayName.toLowerCase()) {
  return { id, displayName, username };
}

describe("RedisGameRepository", () => {
  it("starts the join window when the second player joins", async () => {
    const redis = new FakeRedis();
    const now = Date.parse("2026-06-23T12:00:00.000Z");
    const repository = new RedisGameRepository(redis, { now: () => now });

    await expect(
      repository.joinRound({ groupId, groupName: "Party chat", user: user(42, "Ada") }),
    ).resolves.toMatchObject({
      status: "joined",
      participantCount: 1,
      joinList: [42],
      joinWindowStarted: false,
    });

    await expect(
      repository.joinRound({ groupId, groupName: "Party chat", user: user(77, "Ben") }),
    ).resolves.toEqual({
      status: "joined",
      balance: 500,
      stakeAmount: 10,
      participantCount: 2,
      joinList: [42, 77],
      joinWindowStarted: true,
      joinWindowSeconds: 30,
      joinWindowStartedAt: "2026-06-23T12:00:00.000Z",
      joinWindowExpiresAt: "2026-06-23T12:00:30.000Z",
    });

    expect(redis.store.has("game:group:-1001")).toBe(true);
    expect(redis.store.has("game:lock:-1001")).toBe(false);
  });

  it("keeps a player from joining the same open round twice", async () => {
    const repository = new RedisGameRepository(new FakeRedis());

    await repository.joinRound({ groupId, user: user(42, "Ada") });

    await expect(repository.joinRound({ groupId, user: user(42, "Ada") })).resolves.toEqual({
      status: "already_joined",
      balance: 500,
      stakeAmount: 10,
      participantCount: 1,
      joinList: [42],
    });
  });

  it("removes a player from the current open round", async () => {
    const repository = new RedisGameRepository(new FakeRedis());
    await repository.joinRound({ groupId, user: user(42, "Ada") });
    await repository.joinRound({ groupId, user: user(77, "Ben") });

    await expect(repository.leaveRound({ groupId, userId: 42 })).resolves.toEqual({
      status: "left",
      participantCount: 1,
    });

    await expect(repository.leaveRound({ groupId, userId: 42 })).resolves.toEqual({
      status: "not_in_round",
    });
  });

  it("returns balance and current-round membership", async () => {
    const repository = new RedisGameRepository(new FakeRedis());

    await expect(
      repository.getBalance({ groupId, groupName: "Party chat", user: user(42, "Ada") }),
    ).resolves.toEqual({
      balance: 500,
      inCurrentRound: false,
    });

    await repository.joinRound({ groupId, user: user(42, "Ada") });

    await expect(repository.getBalance({ groupId, user: user(42, "Ada") })).resolves.toEqual({
      balance: 500,
      inCurrentRound: true,
    });
  });

  it("returns leaderboard entries with pagination state", async () => {
    const repository = new RedisGameRepository(new FakeRedis());

    await repository.joinRound({ groupId, user: user(3, "Cam") });
    await repository.joinRound({ groupId, user: user(1, "Ada") });
    await repository.joinRound({ groupId, user: user(2, "Ben") });

    await expect(repository.getLeaderboard({ groupId, page: 0, perPage: 2 })).resolves.toEqual({
      entries: [
        { userId: 1, displayName: "Ada", username: "ada", balance: 500 },
        { userId: 2, displayName: "Ben", username: "ben", balance: 500 },
      ],
      page: 0,
      perPage: 2,
      hasPrevious: false,
      hasNext: true,
    });

    await expect(repository.getLeaderboard({ groupId, page: 1, perPage: 2 })).resolves.toMatchObject({
      entries: [{ userId: 3, displayName: "Cam", username: "cam", balance: 500 }],
      page: 1,
      hasPrevious: true,
      hasNext: false,
    });
  });

  it("enforces creator permissions and start-round preconditions", async () => {
    const repository = new RedisGameRepository(new FakeRedis());

    await expect(repository.canStartRound({ groupId, userId: 42 })).resolves.toBe(true);
    await expect(repository.startRound({ groupId, userId: 42 })).resolves.toEqual({
      status: "no_open_round",
    });

    await repository.joinRound({ groupId, user: user(42, "Ada") });
    await expect(repository.canStartRound({ groupId, userId: 77 })).resolves.toBe(false);
    await expect(repository.startRound({ groupId, userId: 42 })).resolves.toEqual({
      status: "not_enough_players",
      participantCount: 1,
    });

    await repository.joinRound({ groupId, user: user(77, "Ben") });
    await expect(repository.startRound({ groupId, userId: 77 })).resolves.toEqual({
      status: "not_creator",
    });
  });

  it("rejects joins when the player balance is below the group stake", async () => {
    const repository = new RedisGameRepository(new FakeRedis());

    await repository.setStake({ groupId, userId: 42, amount: 1000 });

    await expect(repository.joinRound({ groupId, user: user(77, "Ben") })).resolves.toEqual({
      status: "insufficient_balance",
      balance: 500,
      stakeAmount: 1000,
    });
  });

  it("starts and completes an elimination with persisted balances", async () => {
    const redis = new FakeRedis();
    const repository = new RedisGameRepository(redis, {
      now: () => Date.parse("2026-06-23T12:00:00.000Z"),
      randomInt: () => 1,
    });

    await repository.joinRound({ groupId, user: user(42, "Ada") });
    await repository.joinRound({ groupId, user: user(77, "Ben") });
    await repository.joinRound({ groupId, user: user(99, "Cam") });

    await expect(repository.startRound({ groupId, userId: 42 })).resolves.toEqual({
      status: "started",
      participantCount: 3,
      gifPack: {},
    });

    await expect(repository.eliminateRandomPlayer({ groupId })).resolves.toEqual({
      status: "completed",
      eliminatedUserId: 77,
      participantCount: 3,
      stakeAmount: 10,
      payouts: [
        { userId: 42, amount: 5 },
        { userId: 99, amount: 5 },
      ],
    });

    await expect(repository.getLeaderboard({ groupId, page: 0, perPage: 10 })).resolves.toMatchObject({
      entries: [
        { userId: 42, displayName: "Ada", username: "ada", balance: 505 },
        { userId: 99, displayName: "Cam", username: "cam", balance: 505 },
        { userId: 77, displayName: "Ben", username: "ben", balance: 490 },
      ],
    });
  });

  it("stores creator-only stake changes in Redis", async () => {
    const repository = new RedisGameRepository(new FakeRedis());

    await expect(repository.setStake({ groupId, userId: 42, amount: 25 })).resolves.toEqual({
      status: "updated",
      stakeAmount: 25,
    });

    await expect(repository.setStake({ groupId, userId: 77, amount: 50 })).resolves.toEqual({
      status: "not_creator",
    });

    await expect(repository.joinRound({ groupId, user: user(77, "Ben") })).resolves.toMatchObject({
      status: "joined",
      stakeAmount: 25,
    });
  });

  it("rejects invalid stake amounts before touching Redis", async () => {
    const redis = new FakeRedis();
    const repository = new RedisGameRepository(redis);

    await expect(repository.setStake({ groupId, userId: 42, amount: 0 })).rejects.toThrow(
      "stake amount must be an integer greater than or equal to 1",
    );

    expect(redis.store.size).toBe(0);
  });

  it("reports when no countdown round is ready for elimination", async () => {
    const repository = new RedisGameRepository(new FakeRedis());

    await expect(repository.eliminateRandomPlayer({ groupId })).resolves.toEqual({
      status: "no_countdown_round",
    });
  });
});
