import { createRequire } from "node:module";
import { RedisGameRepository, type RedisGameClient } from "./redis-repository.js";
import type { GameRepository } from "./repository.js";

let repositoryOverride: GameRepository | undefined;
let repositoryPromise: Promise<GameRepository> | undefined;

function createRedisClient(url: string): RedisGameClient {
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ioredis: any = require("ioredis");
  const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false }) as RedisGameClient;
}

export function setGameRepositoryForTests(repository: GameRepository | undefined): void {
  repositoryOverride = repository;
  repositoryPromise = undefined;
}

export function isGameStorageConfigError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("REDIS_URL");
}

export async function getGameRepository(): Promise<GameRepository> {
  if (repositoryOverride) return repositoryOverride;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for persistent game data");
  }
  repositoryPromise ??= Promise.resolve(new RedisGameRepository(createRedisClient(redisUrl)));
  return repositoryPromise;
}
