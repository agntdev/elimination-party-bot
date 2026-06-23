import { randomInt as cryptoRandomInt, randomUUID } from "node:crypto";
import type {
  BalanceInput,
  BalanceResult,
  CountdownGifPack,
  EliminateRandomPlayerInput,
  EliminateRandomPlayerResult,
  GameRepository,
  GroupUserInput,
  JoinRoundInput,
  JoinRoundResult,
  LeaderboardInput,
  LeaderboardResult,
  LeaveRoundInput,
  LeaveRoundResult,
  SetStakeInput,
  SetStakeResult,
  StakePayout,
  StartRoundResult,
} from "./repository.js";

export interface RedisGameClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: string[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

interface RedisPlayer {
  userId: number;
  username?: string;
  displayName: string;
  balance: number;
  firstSeen: string;
  lastSeen: string;
}

interface RedisRound {
  id: string;
  stake: number;
  state: "open" | "countdown" | "complete" | "cancelled";
  joinList: number[];
  joinWindowStartedAt?: string;
  joinWindowExpiresAt?: string;
  startedAt?: string;
  eliminatedUserId?: number;
  finishedAt?: string;
  createdAt: string;
}

interface RedisTransaction {
  id: string;
  userId: number;
  delta: number;
  reason: "stake_lost" | "share_won";
  groupId?: number;
  relatedRoundId?: string;
  createdAt: string;
}

interface RedisGroupState {
  id: number;
  name?: string;
  creatorId: number;
  stakeAmount: number;
  joinWindowSeconds: number;
  gifPack: CountdownGifPack;
  players: Record<string, RedisPlayer>;
  rounds: RedisRound[];
  transactions: RedisTransaction[];
  createdAt: string;
}

interface RedisGlobalState {
  players: Record<string, RedisPlayer>;
  transactions: RedisTransaction[];
  createdAt: string;
}

function parseGroup(value: string | null): RedisGroupState | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as RedisGroupState;
  return {
    ...parsed,
    players: parsed.players ?? {},
    rounds: parsed.rounds ?? [],
    transactions: parsed.transactions ?? [],
    stakeAmount: Number(parsed.stakeAmount ?? 10),
    joinWindowSeconds: Number(parsed.joinWindowSeconds ?? 30),
    gifPack: parsed.gifPack ?? {},
  };
}

function parseGlobal(value: string | null): RedisGlobalState | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as RedisGlobalState;
  return {
    ...parsed,
    players: parsed.players ?? {},
    transactions: parsed.transactions ?? [],
  };
}

function calculateStakePayouts(joinList: number[], eliminatedUserId: number, stake: number): StakePayout[] {
  const survivors = joinList.filter((userId) => userId !== eliminatedUserId);
  const baseAmount = Math.floor(stake / survivors.length);
  const remainder = stake % survivors.length;
  return survivors.map((userId, index) => ({
    userId,
    amount: baseAmount + (index < remainder ? 1 : 0),
  }));
}

function latestRound(rounds: RedisRound[], state: RedisRound["state"]): RedisRound | undefined {
  return rounds.filter((round) => round.state === state).at(-1);
}

export class RedisGameRepository implements GameRepository {
  constructor(
    private readonly redis: RedisGameClient,
    private readonly opts: {
      prefix?: string;
      randomInt?: (max: number) => number;
      now?: () => number;
      lockDelayMs?: number;
    } = {},
  ) {}

  async joinRound(input: JoinRoundInput): Promise<JoinRoundResult> {
    return this.withGameLock(async () => {
      const global = await this.loadOrCreateGlobal();
      const group = await this.loadOrCreateGroup(input.groupId, input.user.id, input.groupName);
      this.migrateLegacyPlayers(group, global);
      const player = this.ensurePlayer(global, input);
      const stakeAmount = group.stakeAmount;

      if (player.balance < stakeAmount) {
        await this.saveGroup(group);
        await this.saveGlobal(global);
        return { status: "insufficient_balance", balance: player.balance, stakeAmount };
      }

      let round = latestRound(group.rounds, "open");
      if (!round) {
        round = {
          id: randomUUID(),
          stake: stakeAmount,
          state: "open",
          joinList: [],
          createdAt: this.nowIso(),
        };
        group.rounds.push(round);
      }

      if (round.joinList.includes(input.user.id)) {
        await this.saveGroup(group);
        await this.saveGlobal(global);
        return {
          status: "already_joined",
          balance: player.balance,
          stakeAmount,
          participantCount: round.joinList.length,
          joinList: [...round.joinList],
          ...(round.joinWindowStartedAt ? { joinWindowStartedAt: round.joinWindowStartedAt } : {}),
          ...(round.joinWindowExpiresAt ? { joinWindowExpiresAt: round.joinWindowExpiresAt } : {}),
        };
      }

      round.joinList.push(input.user.id);
      let joinWindowStarted = false;
      if (round.joinList.length >= 2 && !round.joinWindowStartedAt) {
        const startedAtMs = this.now();
        round.joinWindowStartedAt = new Date(startedAtMs).toISOString();
        round.joinWindowExpiresAt = new Date(startedAtMs + group.joinWindowSeconds * 1000).toISOString();
        joinWindowStarted = true;
      }

      await this.saveGroup(group);
      await this.saveGlobal(global);
      return {
        status: "joined",
        balance: player.balance,
        stakeAmount,
        participantCount: round.joinList.length,
        joinList: [...round.joinList],
        joinWindowStarted,
        joinWindowSeconds: group.joinWindowSeconds,
        ...(round.joinWindowStartedAt ? { joinWindowStartedAt: round.joinWindowStartedAt } : {}),
        ...(round.joinWindowExpiresAt ? { joinWindowExpiresAt: round.joinWindowExpiresAt } : {}),
      };
    });
  }

  async leaveRound(input: LeaveRoundInput): Promise<LeaveRoundResult> {
    return this.withGameLock(async () => {
      const group = await this.loadGroup(input.groupId);
      const round = group ? latestRound(group.rounds, "open") : undefined;
      if (!group || !round || !round.joinList.includes(input.userId)) {
        return { status: "not_in_round" };
      }

      round.joinList = round.joinList.filter((userId) => userId !== input.userId);
      await this.saveGroup(group);
      return { status: "left", participantCount: round.joinList.length };
    });
  }

  async canStartRound(input: GroupUserInput): Promise<boolean> {
    const group = await this.loadGroup(input.groupId);
    return group === undefined || group.creatorId === input.userId;
  }

  async startRound(input: GroupUserInput): Promise<StartRoundResult> {
    return this.withGameLock(async () => {
      const group = await this.loadGroup(input.groupId);
      if (!group) return { status: "no_open_round" };
      if (group.creatorId !== input.userId) return { status: "not_creator" };

      const round = latestRound(group.rounds, "open");
      if (!round) return { status: "no_open_round" };
      if (round.joinList.length < 2) {
        return { status: "not_enough_players", participantCount: round.joinList.length };
      }

      round.state = "countdown";
      round.startedAt = this.nowIso();
      await this.saveGroup(group);
      return {
        status: "started",
        participantCount: round.joinList.length,
        gifPack: group.gifPack,
      };
    });
  }

  async eliminateRandomPlayer(input: EliminateRandomPlayerInput): Promise<EliminateRandomPlayerResult> {
    return this.withGameLock(async () => {
      const group = await this.loadGroup(input.groupId);
      const round = group ? latestRound(group.rounds, "countdown") : undefined;
      if (!group || !round) return { status: "no_countdown_round" };
      if (round.joinList.length < 2) {
        return { status: "not_enough_players", participantCount: round.joinList.length };
      }

      const global = await this.loadOrCreateGlobal();
      this.migrateLegacyPlayers(group, global);
      const eliminatedUserId = round.joinList[this.randomInt(round.joinList.length)]!;
      const payouts = calculateStakePayouts(round.joinList, eliminatedUserId, round.stake);
      const eliminated = global.players[String(eliminatedUserId)];
      if (eliminated) {
        eliminated.balance -= round.stake;
        eliminated.lastSeen = this.nowIso();
      }
      global.transactions.push({
        id: randomUUID(),
        userId: eliminatedUserId,
        delta: -round.stake,
        reason: "stake_lost",
        groupId: input.groupId,
        relatedRoundId: round.id,
        createdAt: this.nowIso(),
      });

      for (const payout of payouts) {
        const player = global.players[String(payout.userId)];
        if (player) {
          player.balance += payout.amount;
          player.lastSeen = this.nowIso();
        }
        global.transactions.push({
          id: randomUUID(),
          userId: payout.userId,
          delta: payout.amount,
          reason: "share_won",
          groupId: input.groupId,
          relatedRoundId: round.id,
          createdAt: this.nowIso(),
        });
      }

      round.state = "complete";
      round.eliminatedUserId = eliminatedUserId;
      round.finishedAt = this.nowIso();
      await this.saveGroup(group);
      await this.saveGlobal(global);
      return {
        status: "completed",
        eliminatedUserId,
        participantCount: round.joinList.length,
        stakeAmount: round.stake,
        payouts,
      };
    });
  }

  async getBalance(input: BalanceInput): Promise<BalanceResult> {
    return this.withGameLock(async () => {
      const global = await this.loadOrCreateGlobal();
      const group = await this.loadOrCreateGroup(input.groupId, input.user.id, input.groupName);
      this.migrateLegacyPlayers(group, global);
      const player = this.ensurePlayer(global, input);
      const round = latestRound(group.rounds, "open");
      await this.saveGroup(group);
      await this.saveGlobal(global);
      return {
        balance: player.balance,
        inCurrentRound: Boolean(round?.joinList.includes(input.user.id)),
      };
    });
  }

  async getLeaderboard(input: LeaderboardInput): Promise<LeaderboardResult> {
    return this.withGameLock(async () => {
      const perPage = Math.max(1, Math.floor(input.perPage ?? 10));
      const page = Math.max(0, Math.floor(input.page));
      const group = await this.loadGroup(input.groupId);
      const global = await this.loadOrCreateGlobal();
      if (group) {
        this.migrateLegacyPlayers(group, global);
        await this.saveGroup(group);
      }
      await this.saveGlobal(global);

      const entries = Object.values(global.players)
        .sort((a, b) => b.balance - a.balance || a.displayName.localeCompare(b.displayName) || a.userId - b.userId)
        .slice(page * perPage, page * perPage + perPage + 1)
        .map((player) => ({
          userId: player.userId,
          displayName: player.displayName,
          username: player.username,
          balance: player.balance,
        }));

      return {
        entries: entries.slice(0, perPage),
        page,
        perPage,
        hasPrevious: page > 0,
        hasNext: entries.length > perPage,
      };
    });
  }

  async setStake(input: SetStakeInput): Promise<SetStakeResult> {
    if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
      throw new Error("stake amount must be an integer greater than or equal to 1");
    }

    return this.withGameLock(async () => {
      const group = await this.loadOrCreateGroup(input.groupId, input.userId, input.groupName);
      if (group.creatorId !== input.userId) return { status: "not_creator" };
      group.stakeAmount = input.amount;
      await this.saveGroup(group);
      return { status: "updated", stakeAmount: group.stakeAmount };
    });
  }

  private async withGameLock<T>(fn: () => Promise<T>): Promise<T> {
    const lockKey = this.globalLockKey();
    const token = randomUUID();
    const attempts = 50;
    for (let i = 0; i < attempts; i++) {
      const acquired = await this.redis.set(lockKey, token, "PX", "5000", "NX");
      if (acquired === "OK" || acquired === true) {
        try {
          return await fn();
        } finally {
          if ((await this.redis.get(lockKey)) === token) {
            await this.redis.del(lockKey);
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, this.opts.lockDelayMs ?? 10));
    }
    throw new Error("timed out waiting for Redis game state lock");
  }

  private async loadGroup(groupId: number): Promise<RedisGroupState | undefined> {
    return parseGroup(await this.redis.get(this.groupKey(groupId)));
  }

  private async loadGlobal(): Promise<RedisGlobalState | undefined> {
    return parseGlobal(await this.redis.get(this.globalKey()));
  }

  private async loadOrCreateGlobal(): Promise<RedisGlobalState> {
    return (
      (await this.loadGlobal()) ?? {
        players: {},
        transactions: [],
        createdAt: this.nowIso(),
      }
    );
  }

  private async loadOrCreateGroup(
    groupId: number,
    creatorId: number,
    groupName?: string,
  ): Promise<RedisGroupState> {
    const existing = await this.loadGroup(groupId);
    if (existing) {
      if (groupName) existing.name = groupName;
      return existing;
    }

    return {
      id: groupId,
      ...(groupName ? { name: groupName } : {}),
      creatorId,
      stakeAmount: 10,
      joinWindowSeconds: 30,
      gifPack: {},
      players: {},
      rounds: [],
      transactions: [],
      createdAt: this.nowIso(),
    };
  }

  private ensurePlayer(global: RedisGlobalState, input: JoinRoundInput): RedisPlayer {
    const key = String(input.user.id);
    const existing = global.players[key];
    if (existing) {
      existing.username = input.user.username;
      existing.displayName = input.user.displayName;
      existing.lastSeen = this.nowIso();
      return existing;
    }

    const player: RedisPlayer = {
      userId: input.user.id,
      username: input.user.username,
      displayName: input.user.displayName,
      balance: 500,
      firstSeen: this.nowIso(),
      lastSeen: this.nowIso(),
    };
    global.players[key] = player;
    return player;
  }

  private migrateLegacyPlayers(group: RedisGroupState, global: RedisGlobalState): void {
    for (const [key, player] of Object.entries(group.players)) {
      if (!global.players[key]) {
        global.players[key] = { ...player };
      }
    }
  }

  private async saveGroup(group: RedisGroupState): Promise<void> {
    await this.redis.set(this.groupKey(group.id), JSON.stringify(group));
  }

  private async saveGlobal(global: RedisGlobalState): Promise<void> {
    await this.redis.set(this.globalKey(), JSON.stringify(global));
  }

  private groupKey(groupId: number): string {
    return `${this.prefix}:group:${groupId}`;
  }

  private globalKey(): string {
    return `${this.prefix}:global`;
  }

  private globalLockKey(): string {
    return `${this.prefix}:lock:global`;
  }

  private get prefix(): string {
    return this.opts.prefix ?? "game";
  }

  private randomInt(max: number): number {
    return (this.opts.randomInt ?? cryptoRandomInt)(max);
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }
}
