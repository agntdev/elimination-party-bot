import { createRequire } from "node:module";
import { applySchema, type Queryable } from "./schema.js";

interface PoolLike extends Queryable {
  end(): Promise<void>;
}

let poolPromise: Promise<PoolLike> | undefined;

async function createPool(connectionString: string): Promise<PoolLike> {
  const require = createRequire(import.meta.url);
  const pg = require("pg") as {
    Pool: new (config: { connectionString: string }) => PoolLike;
  };
  const pool = new pg.Pool({ connectionString });
  await applySchema(pool);
  return pool;
}

export async function getDatabase(): Promise<Queryable> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for persistent game data");
  }
  poolPromise ??= createPool(connectionString);
  return poolPromise;
}

export async function closeDatabase(): Promise<void> {
  const pool = await poolPromise;
  poolPromise = undefined;
  await pool?.end();
}
