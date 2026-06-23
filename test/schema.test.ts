import { describe, expect, it } from "vitest";
import { applySchema, schemaSql, schemaStatements, type Queryable } from "../src/db/schema.js";

describe("database schema", () => {
  it("creates the required game tables and indexed lookup fields", () => {
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS groups");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS players");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS rounds");
    expect(schemaSql).toContain("CREATE TABLE IF NOT EXISTS transactions");

    expect(schemaSql).toContain("stake_amount integer");
    expect(schemaSql).toContain("join_window_seconds integer");
    expect(schemaSql).toContain("gif_pack jsonb");
    expect(schemaSql).toContain("balance integer");
    expect(schemaSql).toContain("state text");
    expect(schemaSql).toContain("join_list jsonb");
    expect(schemaSql).toContain("join_window_started_at timestamptz");
    expect(schemaSql).toContain("join_window_expires_at timestamptz");
    expect(schemaSql).toContain("ADD COLUMN IF NOT EXISTS join_window_started_at");
    expect(schemaSql).toContain("ADD COLUMN IF NOT EXISTS join_window_expires_at");
    expect(schemaSql).toContain("eliminated_user_id bigint");
    expect(schemaSql).toContain("delta integer");
    expect(schemaSql).toContain("related_round_id uuid");

    expect(schemaSql).toContain("idx_players_group_id");
    expect(schemaSql).toContain("idx_players_user_id");
    expect(schemaSql).toContain("idx_rounds_group_state");
    expect(schemaSql).toContain("idx_transactions_group_id");
    expect(schemaSql).toContain("idx_transactions_user_id");
  });

  it("applies each schema statement in order", async () => {
    const calls: string[] = [];
    const db: Queryable = {
      async query(sql: string) {
        calls.push(sql);
      },
    };

    await applySchema(db);

    expect(calls).toEqual(schemaStatements);
  });
});
