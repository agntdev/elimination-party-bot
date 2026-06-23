# fix-ba799e5b3cb9c154 — E8T1 handler is an empty stub

**Weight:** 0.0000 (share of project budget)
**Reward:** 0 ELIM

`src/handlers/E8T1.ts` exports a bare `Composer` with no middleware, no commands, and no callbacks. While the database schema changes (replacing user_id with username fields in Groups, Players, Rounds, and Transactions) are already reflected in `redis-repository.ts`, the handler module itself is dead code that contributes nothing. Per the implementation contract, every handler must ship a "COMPLETE, working implementation — not a stub" with no "commented-out logic" or empty bodies. An empty Composer that registers zero behavior is effectively a stub file.

There are also no test files for E8T1 (`tests/specs/E8T1.json` and `tests/commands/E8T1.json` do not exist), so no test coverage exists for whatever schema migration or validation logic this handler was intended to provide.

## Dialog tests

This is a FIX task: the behavior it repairs is already covered by an existing spec under `tests/specs/`. Fix the code to make that existing spec pass — do NOT author a new `tests/specs/fix-ba799e5b3cb9c154.json` (a duplicate spec for the same behavior makes the tests-gate count it twice and it can never go green). Add a new spec file ONLY if you are introducing genuinely new user-facing behavior that no existing spec covers; if so, name it `tests/specs/fix-ba799e5b3cb9c154.json` (and any new command `tests/commands/fix-ba799e5b3cb9c154.json`).


## Handler module

This is a FIX task. Find the EXISTING handler under `src/handlers/` that implements the affected command/behavior and EDIT it in place. Do NOT create a new `src/handlers/fix-ba799e5b3cb9c154.ts` — a second `Composer` binding the same command conflicts with the original and breaks the bot. Create a new handler file ONLY if the affected command does not exist anywhere yet (then name it `src/handlers/fix-ba799e5b3cb9c154.ts` and default-export a grammY `Composer`; `buildBot()` auto-loads it). NEVER edit `src/bot.ts`; the global error boundary + unknown-command fallback already live in `buildBot()`.


## Implementation contract

Ship a COMPLETE, working implementation — not a stub. A task is INCOMPLETE (and will be rejected) even if it compiles and the dialog tests pass when it does any of these:
- **Stubbed code:** empty bodies, `TODO`/`FIXME`, commented-out logic, or `throw new Error("not implemented")`.
- **Fabricated data:** `Math.random()`, hardcoded sample arrays, or canned responses standing in for real computed or fetched values.
- **No in-memory data store:** a `Map`/array/module-level variable used as a database is a defect. Anything that must survive a restart (records, subscriptions, balances, schedules, settings) MUST use the toolkit's persistent storage (Redis-backed), not process memory. (The toolkit's auto-selected session storage is only for ephemeral conversation state.)
- **Broken integrations:** call external APIs against their real contract — correct endpoints, ids and params (e.g. a coin *id* like `the-open-network`, not a ticker like `TON`) — with credentials read from env. Do not invent endpoints or fake responses.
- **Dead code:** the feature's command/handler must be registered via its default-exported `Composer` in `src/handlers/<slug>.ts` (auto-loaded) and reachable from the bot's command surface.
If the spec is genuinely under-specified, implement the smallest REAL slice you can verify and note the gap — never fake behavior to make the PR look complete.
