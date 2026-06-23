Summary

Elimination Party Bot is a Telegram group-game bot where players join rounds with virtual points (no real money). Once at least 2 players join a round, the bot counts down 3…2…1 (sending a GIF each second) and then picks one player to eliminate using a cryptographically secure PRNG. The eliminated player loses the group-stake they risked for the round; that stake is split equally among the survivors. Each group has a per-group leaderboard (players ranked by current point balance). Default stake is 10 points; the group creator can change it.

Audience

- Telegram group chats that want a simple, repeatable party elimination game for entertainment and bragging rights.

Core entities

- Group (chat): id, name, creator_id, stake_amount, join_window_seconds, gif_pack, created_at
- Player (per-group): user_id, username, display_name, balance (int), joined_at (first seen), last_seen
- Round: id, group_id, stake, state (open/countdown/complete/cancelled), join_list [user_id order], started_at, eliminated_user_id, finished_at
- Audit/Transaction: id, group_id, user_id, delta (int), reason (stake_lost/share_won), related_round_id, created_at

Integrations & notification targets

- Telegram Bot API (main integration; messages live in the group chat)
- Optional: error/usage logging to Sentry or a webhook (configurable via env var)
- No external RNG service (crypto PRNG built into the runtime). No payment processors.

Interaction flows

Commands and buttons

- /join (button: Join) — join the currently open round in this group. Requires balance >= group stake.
- /leave (button: Leave) — leave an open round before countdown begins.
- /startround (button: Start now) — manually start the join window or start immediately (creator only). If a join window is ongoing, start immediately.
- /setstake <amount> — group creator only; sets the uniform stake for the group (integer >=1).
- /balance — show the caller's current balance in this group and whether they are in the open round.
- /leaderboard — show the group's leaderboard (top 10 by balance, with pagination).
- /help — usage and rules.

Round lifecycle (default behavior)

- Creating an open round: A group open round is created when someone sends /startround or when any user initiates a join and no open round exists. When the 2nd player joins an open round, a join window of 30 seconds is started automatically to allow more players to join (configurable per-group). The creator can override with /startround to start immediately.
- Join: When a user presses Join or sends /join, the bot verifies balance >= stake and adds them to the round's join_list (preserves order). Users can only be in one round per group at a time.
- Countdown: After the join window expires or someone starts the round manually (or the creator forces start), the bot sends three countdown messages (3, 2, 1) spaced ~1s apart; each countdown message includes the configured GIF for that step. GIF URLs are stored in the group's gif_pack.
- Elimination: After countdown, the bot selects one player uniformly at random from the join_list using a crypto-secure RNG and marks that player eliminated.
- Payout: The eliminated player's balance is reduced by stake. The eliminated player's stake (an integer) is split equally among the survivors (n-1); each survivor receives floor(stake/(n-1)) points; any remainder is distributed +1 point to survivors in join order until exhausted. Survivors keep their own stakes (stakes are only lost by the eliminated player). All balance changes are recorded as transactions.
- Post-round: The bot reports the eliminated player, new balances for participants, and updates the group leaderboard. The round closes and is archived.

Edge cases

- If a player doesn't have stake when trying to /join: reject with explanation and show /balance.
- If someone leaves mid-join-window: removed from join_list.
- If a player is removed from the group or blocks the bot during a round: treat them as having left before countdown if they left before start; if they are still present at the moment of elimination they are eligible. If the eliminated player cannot be credited/debited (user account missing) the bot still records the event and their balance becomes floored at 0.
- Concurrency: Group-level locking prevents overlapping rounds in the same group.

Persistence

Primary store: PostgreSQL (relational schema for Groups, Players, Rounds, Transactions). Suggested indexes: group_id + user_id on Players; group_id + state on Rounds; user_id on Transactions.

Short example schema (implementation detail):
- groups(id bigint PK, creator_id bigint, stake int, join_window_seconds int, gif_pack jsonb, created_at timestamptz)
- players(group_id bigint, user_id bigint, username text, balance int, first_seen timestamptz, primary key (group_id,user_id))
- rounds(id uuid PK, group_id bigint, stake int, state text, join_list jsonb, started_at timestamptz, eliminated_user_id bigint, finished_at timestamptz)
- transactions(id uuid PK, group_id bigint, user_id bigint, delta int, reason text, round_id uuid, created_at timestamptz)

Implementation notes

- Bot runs behind an HTTPS webhook (recommended for production); fallback to long polling for dev.
- Environment variables: TELEGRAM_BOT_TOKEN, DATABASE_URL, SENTRY_DSN (optional), WEBHOOK_URL, PORT, NODE_ENV.
- RNG: use secure built-in crypto.randomInt to select eliminated index.
- GIFs: bundle a default gif_pack (3 GIF URLs mapped to countdown 3,2,1). Provide an admin command /setgifs to set custom GIF URLs (creator only).
- Testing: unit tests for payout math and concurrency, integration tests for Telegram flows.

Payments

- None. All points are virtual. No purchases, no payouts, no real-money integrations.

Non-goals

- No real-money wagering, deposits, withdrawals, or cashout flows.
- No cross-group/global economy (leaderboards are per-group only). Global leaderboard is out of scope.
- No external RNG services (per owner decision).

## Assumptions & defaults

- Default stake = 10 points: sensible, small round risk to keep many quick rounds.
- Starting balance per new player = 500 points: provided by owner earlier; gives room for multiple rounds.
- RNG = built-in crypto PRNG: chosen by owner; no external keys required.
- Round auto-start behavior = 30s join window after 2nd player joins: balances open-to-join participation and avoids immediate auto-start that would block additional players.
- Stake handling = eliminated player loses stake; survivors receive stake split equally (integer floor with remainder distributed by join order): matches spec and keeps arithmetic deterministic.
- Group creator is defined as the first user who creates an open round in a group; only that user can call /setstake and /setgifs (keeps permissions simple when Telegram admin metadata is not available). Rationale: explicit creator tracking prevents permission ambiguity.

If you want any of the defaults changed (join window length, how remainder is distributed, webhook vs polling, or who can change stake), tell me which one and I will adapt before I start the build.