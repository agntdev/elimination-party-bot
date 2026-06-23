import { createRequire } from "node:module";
import type { RedisLike } from "../toolkit/session/redis.js";

let redisClient: RedisLike | undefined;

export function setInlineStateClient(client: RedisLike | undefined): void {
  redisClient = client;
}

function getRedisClient(): RedisLike | undefined {
  if (redisClient) return redisClient;
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return undefined;
  const require = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ioredis: any = require("ioredis");
  const Redis = ioredis.default ?? ioredis.Redis ?? ioredis;
  redisClient = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false }) as RedisLike;
  return redisClient;
}

export interface InlineMessageCreator {
  userId: number;
  usernameKey: string;
}

export async function storeInlineMessageCreator(
  inlineMessageId: string,
  userId: number,
  username?: string,
): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  await client.set(
    `inline:creator:${inlineMessageId}`,
    JSON.stringify({ userId, usernameKey: username ?? String(userId) }),
  );
}

export async function getInlineMessageCreator(
  inlineMessageId: string,
): Promise<InlineMessageCreator | undefined> {
  const client = getRedisClient();
  if (!client) return;
  const val = await client.get(`inline:creator:${inlineMessageId}`);
  if (!val) return undefined;
  try {
    return JSON.parse(val) as InlineMessageCreator;
  } catch {
    return undefined;
  }
}