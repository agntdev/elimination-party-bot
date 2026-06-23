import { getDatabase } from "../db/client.js";
import { PostgresGameRepository, type GameRepository } from "./repository.js";

let repositoryOverride: GameRepository | undefined;
let repositoryPromise: Promise<GameRepository> | undefined;

export function setGameRepositoryForTests(repository: GameRepository | undefined): void {
  repositoryOverride = repository;
  repositoryPromise = undefined;
}

export async function getGameRepository(): Promise<GameRepository> {
  if (repositoryOverride) return repositoryOverride;
  repositoryPromise ??= getDatabase().then((db) => new PostgresGameRepository(db));
  return repositoryPromise;
}
