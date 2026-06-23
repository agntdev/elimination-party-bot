import type { Queryable } from "../db/schema.js";

export interface TelegramUserRef {
  id: number;
  username?: string;
  displayName: string;
}

export interface JoinRoundInput {
  groupId: number;
  groupName?: string;
  user: TelegramUserRef;
}

export type BalanceInput = JoinRoundInput;

export interface BalanceResult {
  balance: number;
  inCurrentRound: boolean;
}

export interface LeaveRoundInput {
  groupId: number;
  userId: number;
}

export interface GroupUserInput {
  groupId: number;
  userId: number;
}

export interface LeaderboardInput {
  groupId: number;
  page: number;
  perPage?: number;
}

export interface LeaderboardEntry {
  userId: number;
  displayName: string;
  username?: string;
  balance: number;
}

export interface LeaderboardResult {
  entries: LeaderboardEntry[];
  page: number;
  perPage: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface SetStakeInput {
  groupId: number;
  groupName?: string;
  userId: number;
  amount: number;
}

export type SetStakeResult =
  | {
      status: "updated";
      stakeAmount: number;
    }
  | {
      status: "not_creator";
    };

export type JoinRoundResult =
  | {
      status: "joined" | "already_joined";
      balance: number;
      stakeAmount: number;
      participantCount: number;
      joinList: number[];
      joinWindowStarted?: boolean;
      joinWindowSeconds?: number;
      joinWindowStartedAt?: string;
      joinWindowExpiresAt?: string;
    }
  | {
      status: "insufficient_balance";
      balance: number;
      stakeAmount: number;
    };

export type LeaveRoundResult =
  | {
      status: "left";
      participantCount: number;
    }
  | {
      status: "not_in_round";
    };

export type StartRoundResult =
  | {
      status: "started";
      participantCount: number;
    }
  | {
      status: "not_creator";
    }
  | {
      status: "no_open_round";
    }
  | {
      status: "not_enough_players";
      participantCount: number;
    };

export interface GameRepository {
  joinRound(input: JoinRoundInput): Promise<JoinRoundResult>;
  leaveRound(input: LeaveRoundInput): Promise<LeaveRoundResult>;
  canStartRound(input: GroupUserInput): Promise<boolean>;
  startRound(input: GroupUserInput): Promise<StartRoundResult>;
  getBalance(input: BalanceInput): Promise<BalanceResult>;
  getLeaderboard(input: LeaderboardInput): Promise<LeaderboardResult>;
  setStake(input: SetStakeInput): Promise<SetStakeResult>;
}

function parseJoinList(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  }
  return [];
}

interface RoundWindowRow extends Record<string, unknown> {
  join_window_started_at?: Date | string | null;
  join_window_expires_at?: Date | string | null;
}

function timestampString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function windowFields(row: RoundWindowRow | undefined): {
  joinWindowStartedAt?: string;
  joinWindowExpiresAt?: string;
} {
  const startedAt = timestampString(row?.join_window_started_at);
  const expiresAt = timestampString(row?.join_window_expires_at);
  return {
    ...(startedAt ? { joinWindowStartedAt: startedAt } : {}),
    ...(expiresAt ? { joinWindowExpiresAt: expiresAt } : {}),
  };
}

export class PostgresGameRepository implements GameRepository {
  constructor(private readonly db: Queryable) {}

  async getLeaderboard(input: LeaderboardInput): Promise<LeaderboardResult> {
    const perPage = Math.max(1, Math.floor(input.perPage ?? 10));
    const page = Math.max(0, Math.floor(input.page));
    const rows = await this.db.query<{
      user_id: number;
      display_name: string;
      username: string | null;
      balance: number;
    }>(
      `SELECT user_id, display_name, username, balance
       FROM players
       WHERE group_id = $1
       ORDER BY balance DESC, display_name ASC, user_id ASC
       LIMIT $2 OFFSET $3`,
      [input.groupId, perPage + 1, page * perPage],
    );

    return {
      entries: rows.rows.slice(0, perPage).map((row) => ({
        userId: Number(row.user_id),
        displayName: row.display_name,
        username: row.username ?? undefined,
        balance: Number(row.balance),
      })),
      page,
      perPage,
      hasPrevious: page > 0,
      hasNext: rows.rows.length > perPage,
    };
  }

  async setStake(input: SetStakeInput): Promise<SetStakeResult> {
    if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
      throw new Error("stake amount must be an integer greater than or equal to 1");
    }

    await this.db.query("BEGIN");
    try {
      const group = await this.db.query<{ creator_id: number }>(
        `INSERT INTO groups (id, name, creator_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, groups.name)
         RETURNING creator_id`,
        [input.groupId, input.groupName ?? null, input.userId],
      );
      const creatorId = group.rows[0]?.creator_id;
      if (creatorId !== undefined && Number(creatorId) !== input.userId) {
        await this.db.query("COMMIT");
        return { status: "not_creator" };
      }

      const updated = await this.db.query<{ stake_amount: number }>(
        `UPDATE groups
         SET stake_amount = $2
         WHERE id = $1
         RETURNING stake_amount`,
        [input.groupId, input.amount],
      );

      await this.db.query("COMMIT");
      return {
        status: "updated",
        stakeAmount: Number(updated.rows[0]?.stake_amount ?? input.amount),
      };
    } catch (err) {
      await this.db.query("ROLLBACK");
      throw err;
    }
  }

  async getBalance(input: BalanceInput): Promise<BalanceResult> {
    const group = await this.db.query(
      `INSERT INTO groups (id, name, creator_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET
         name = COALESCE(EXCLUDED.name, groups.name)
       RETURNING id`,
      [input.groupId, input.groupName ?? null, input.user.id],
    );

    const player = await this.db.query<{ balance: number }>(
      `INSERT INTO players (group_id, user_id, username, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, user_id) DO UPDATE SET
         username = EXCLUDED.username,
         display_name = EXCLUDED.display_name,
         last_seen = now()
       RETURNING balance`,
      [input.groupId, input.user.id, input.user.username ?? null, input.user.displayName],
    );

    const openRound = await this.db.query<{ join_list: unknown }>(
      `SELECT join_list
       FROM rounds
       WHERE group_id = $1 AND state = 'open'
       ORDER BY created_at DESC
       LIMIT 1`,
      [group.rows[0]?.id ?? input.groupId],
    );

    return {
      balance: Number(player.rows[0]?.balance ?? 0),
      inCurrentRound: parseJoinList(openRound.rows[0]?.join_list).includes(input.user.id),
    };
  }

  async canStartRound(input: GroupUserInput): Promise<boolean> {
    const group = await this.db.query<{ creator_id: number }>(
      `SELECT creator_id
       FROM groups
       WHERE id = $1`,
      [input.groupId],
    );
    const creatorId = group.rows[0]?.creator_id;
    return creatorId === undefined || Number(creatorId) === input.userId;
  }

  async startRound(input: GroupUserInput): Promise<StartRoundResult> {
    await this.db.query("BEGIN");
    try {
      const group = await this.db.query<{ creator_id: number }>(
        `SELECT creator_id
         FROM groups
         WHERE id = $1
         FOR UPDATE`,
        [input.groupId],
      );
      const creatorId = group.rows[0]?.creator_id;
      if (creatorId !== undefined && Number(creatorId) !== input.userId) {
        await this.db.query("COMMIT");
        return { status: "not_creator" };
      }

      const openRound = await this.db.query<{ id: string; join_list: unknown }>(
        `SELECT id, join_list
         FROM rounds
         WHERE group_id = $1 AND state = 'open'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [input.groupId],
      );
      const round = openRound.rows[0];
      if (!round) {
        await this.db.query("COMMIT");
        return { status: "no_open_round" };
      }

      const participantCount = parseJoinList(round.join_list).length;
      if (participantCount < 2) {
        await this.db.query("COMMIT");
        return { status: "not_enough_players", participantCount };
      }

      await this.db.query(
        `UPDATE rounds
         SET state = 'countdown',
             started_at = now()
         WHERE id = $1 AND state = 'open'`,
        [round.id],
      );

      await this.db.query("COMMIT");
      return { status: "started", participantCount };
    } catch (err) {
      await this.db.query("ROLLBACK");
      throw err;
    }
  }

  async leaveRound(input: LeaveRoundInput): Promise<LeaveRoundResult> {
    await this.db.query("BEGIN");
    try {
      const openRound = await this.db.query<{ id: string; join_list: unknown }>(
        `SELECT id, join_list
         FROM rounds
         WHERE group_id = $1 AND state = 'open'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [input.groupId],
      );
      const round = openRound.rows[0];
      if (!round) {
        await this.db.query("COMMIT");
        return { status: "not_in_round" };
      }

      const joinList = parseJoinList(round.join_list);
      if (!joinList.includes(input.userId)) {
        await this.db.query("COMMIT");
        return { status: "not_in_round" };
      }

      const nextJoinList = joinList.filter((id) => id !== input.userId);
      const updated = await this.db.query<{ join_list: unknown }>(
        `UPDATE rounds
         SET join_list = $2::jsonb
         WHERE id = $1 AND state = 'open'
         RETURNING join_list`,
        [round.id, JSON.stringify(nextJoinList)],
      );

      await this.db.query("COMMIT");
      return {
        status: "left",
        participantCount: parseJoinList(updated.rows[0]?.join_list).length,
      };
    } catch (err) {
      await this.db.query("ROLLBACK");
      throw err;
    }
  }

  async joinRound(input: JoinRoundInput): Promise<JoinRoundResult> {
    await this.db.query("BEGIN");
    try {
      const group = await this.db.query<{ stake_amount: number; join_window_seconds: number }>(
        `INSERT INTO groups (id, name, creator_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, groups.name)
         RETURNING stake_amount, join_window_seconds`,
        [input.groupId, input.groupName ?? null, input.user.id],
      );

      const player = await this.db.query<{ balance: number }>(
        `INSERT INTO players (group_id, user_id, username, display_name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id, user_id) DO UPDATE SET
           username = EXCLUDED.username,
           display_name = EXCLUDED.display_name,
           last_seen = now()
         RETURNING balance`,
        [input.groupId, input.user.id, input.user.username ?? null, input.user.displayName],
      );

      const stakeAmount = Number(group.rows[0]?.stake_amount ?? 10);
      const joinWindowSeconds = Number(group.rows[0]?.join_window_seconds ?? 30);
      const balance = Number(player.rows[0]?.balance ?? 0);

      if (balance < stakeAmount) {
        await this.db.query("COMMIT");
        return { status: "insufficient_balance", balance, stakeAmount };
      }

      const openRound = await this.db.query<{
        id: string;
        join_list: unknown;
        join_window_started_at: Date | string | null;
        join_window_expires_at: Date | string | null;
      }>(
        `SELECT id, join_list, join_window_started_at, join_window_expires_at
         FROM rounds
         WHERE group_id = $1 AND state = 'open'
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [input.groupId],
      );

      const round =
        openRound.rows[0] ??
        (
          await this.db.query<{
            id: string;
            join_list: unknown;
            join_window_started_at: Date | string | null;
            join_window_expires_at: Date | string | null;
          }>(
            `INSERT INTO rounds (group_id, stake, state, join_list)
             VALUES ($1, $2, 'open', '[]'::jsonb)
             RETURNING id, join_list, join_window_started_at, join_window_expires_at`,
            [input.groupId, stakeAmount],
          )
        ).rows[0];

      const joinList = parseJoinList(round?.join_list);
      if (joinList.includes(input.user.id)) {
        await this.db.query("COMMIT");
        return {
          status: "already_joined",
          balance,
          stakeAmount,
          participantCount: joinList.length,
          joinList,
          ...windowFields(round),
        };
      }

      const updated = await this.db.query<{ join_list: unknown }>(
        `UPDATE rounds
         SET join_list = join_list || jsonb_build_array($2::bigint)
         WHERE id = $1
         RETURNING join_list`,
        [round?.id, input.user.id],
      );
      const updatedJoinList = parseJoinList(updated.rows[0]?.join_list);
      const participantCount = updatedJoinList.length;
      let joinWindowStarted = false;
      let windowRow: RoundWindowRow | undefined = round;
      if (participantCount >= 2 && !round?.join_window_started_at) {
        const joinWindow = await this.db.query<RoundWindowRow>(
          `UPDATE rounds
           SET join_window_started_at = now(),
               join_window_expires_at = now() + ($2::text || ' seconds')::interval
           WHERE id = $1 AND join_window_started_at IS NULL
           RETURNING join_window_started_at, join_window_expires_at`,
          [round?.id, joinWindowSeconds],
        );
        windowRow = joinWindow.rows[0] ?? windowRow;
        joinWindowStarted = Boolean(joinWindow.rows[0]);
      }

      await this.db.query("COMMIT");
      return {
        status: "joined",
        balance,
        stakeAmount,
        participantCount,
        joinList: updatedJoinList,
        joinWindowStarted,
        joinWindowSeconds,
        ...windowFields(windowRow),
      };
    } catch (err) {
      await this.db.query("ROLLBACK");
      throw err;
    }
  }
}
