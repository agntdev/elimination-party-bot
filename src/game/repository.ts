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

export interface LeaveRoundInput {
  groupId: number;
  userId: number;
}

export type JoinRoundResult =
  | {
      status: "joined" | "already_joined";
      balance: number;
      stakeAmount: number;
      participantCount: number;
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

export interface GameRepository {
  joinRound(input: JoinRoundInput): Promise<JoinRoundResult>;
  leaveRound(input: LeaveRoundInput): Promise<LeaveRoundResult>;
}

function parseJoinList(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number);
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  }
  return [];
}

export class PostgresGameRepository implements GameRepository {
  constructor(private readonly db: Queryable) {}

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
      const group = await this.db.query<{ stake_amount: number }>(
        `INSERT INTO groups (id, name, creator_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, groups.name)
         RETURNING stake_amount`,
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
      const balance = Number(player.rows[0]?.balance ?? 0);

      if (balance < stakeAmount) {
        await this.db.query("COMMIT");
        return { status: "insufficient_balance", balance, stakeAmount };
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

      const round =
        openRound.rows[0] ??
        (
          await this.db.query<{ id: string; join_list: unknown }>(
            `INSERT INTO rounds (group_id, stake, state, join_list)
             VALUES ($1, $2, 'open', '[]'::jsonb)
             RETURNING id, join_list`,
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
        };
      }

      const updated = await this.db.query<{ join_list: unknown }>(
        `UPDATE rounds
         SET join_list = join_list || jsonb_build_array($2::bigint)
         WHERE id = $1
         RETURNING join_list`,
        [round?.id, input.user.id],
      );

      await this.db.query("COMMIT");
      return {
        status: "joined",
        balance,
        stakeAmount,
        participantCount: parseJoinList(updated.rows[0]?.join_list).length,
      };
    } catch (err) {
      await this.db.query("ROLLBACK");
      throw err;
    }
  }
}
