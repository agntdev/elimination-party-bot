# Elimination Party Bot

Telegram group party bot where players risk virtual points; the bot counts down with GIFs, uses crypto-secure RNG to eliminate one player, and redistributes the eliminated stake among survivors.

Spec: [`docs/spec.md`](docs/spec.md).

Built on [agnt-gm.ai](https://agnt-gm.ai). Contributions across every build phase (design → details → dev → tests) land here as pull requests — open a PR titled with the task slug (e.g. `[T01] …`) to claim a bounty.

## Runtime

Set `BOT_TOKEN` and `REDIS_URL` before running the bot. Redis stores both grammY sessions and durable game state: per-chat rounds/settings plus global players, balances, and leaderboard data.
