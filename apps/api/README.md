# suck-tournament-api

Standalone StarCraft 2 tournament API: Fastify 5 on PostgreSQL (schema `axsuck`), with Postgrator migrations, SSE live updates, Swagger docs, and an optional Python SC2 replay parser.

This is an on-demand app in the Wayne-Monorepo; see the root `AGENTS.md`.

## Commands

Run from the repository root with pnpm:

- Dev server (`http://localhost:3100`, docs at `/docs`): `pnpm dev:suck` (with the web app) or run this package directly
- Migrations: `pnpm --filter suck-tournament-api migrate`
- Tests: `pnpm --filter suck-tournament-api test` (pure ladder/seed logic; no DB needed)
- Smoke test: `node scripts/test-api.js`

## Environment

- `DATABASE_URL` (required) - PostgreSQL connection string; migrations run on startup.
- `PORT` (optional) - defaults to `3100`.
- `STATIC_DIR` (optional) - serve a built frontend `index.html` fallback from this directory.

## Replay parser

`scripts/parse_replay.py` uses `sc2reader` + `spawningtool` (Python deps: `uv pip install sc2reader spawningtool`; the system Python may not ship `pip`).

- Some private lobbies contain observer slots that own units in tracker events. `sc2reader 1.9.0` then crashes with `'Observer' object has no attribute 'units'`, and `spawningtool` continues into `KeyError: <observer pid>`. The parser installs an observer-safe shim so these replays still yield map/winner/time/players; build orders may be empty for the side whose units were attributed to an observer slot.
- Team results come from `replay.teams`, and the file's `real_type` (not `type`) is the authoritative 1v1/2v2 label.

## Architecture

`Route -> Repository(dir) -> fastify.db.query`. See [AGENTS.md](./AGENTS.md) for the hard rules, database conventions, verification commands, and the app-level Definition of Done.
