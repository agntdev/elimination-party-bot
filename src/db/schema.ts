export interface Queryable {
  query(sql: string): Promise<unknown>;
}

export const schemaStatements = [
  `CREATE EXTENSION IF NOT EXISTS pgcrypto`,
  `CREATE TABLE IF NOT EXISTS groups (
    id bigint PRIMARY KEY,
    name text,
    creator_id bigint NOT NULL,
    stake_amount integer NOT NULL DEFAULT 10 CHECK (stake_amount >= 1),
    join_window_seconds integer NOT NULL DEFAULT 30 CHECK (join_window_seconds >= 1),
    gif_pack jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    group_id bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id bigint NOT NULL,
    username text,
    display_name text NOT NULL,
    balance integer NOT NULL DEFAULT 500 CHECK (balance >= 0),
    first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS rounds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    stake integer NOT NULL CHECK (stake >= 1),
    state text NOT NULL CHECK (state IN ('open', 'countdown', 'complete', 'cancelled')),
    join_list jsonb NOT NULL DEFAULT '[]'::jsonb,
    started_at timestamptz,
    eliminated_user_id bigint,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id bigint NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id bigint NOT NULL,
    delta integer NOT NULL,
    reason text NOT NULL CHECK (reason IN ('stake_lost', 'share_won')),
    related_round_id uuid REFERENCES rounds(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (group_id, user_id) REFERENCES players(group_id, user_id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_players_group_id ON players(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rounds_group_id ON rounds(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rounds_state ON rounds(state)`,
  `CREATE INDEX IF NOT EXISTS idx_rounds_group_state ON rounds(group_id, state)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_group_id ON transactions(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_related_round_id ON transactions(related_round_id)`,
];

export const schemaSql = schemaStatements.map((statement) => `${statement};`).join("\n\n");

export async function applySchema(db: Queryable): Promise<void> {
  for (const statement of schemaStatements) {
    await db.query(statement);
  }
}
