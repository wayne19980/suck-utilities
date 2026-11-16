# AI Guide: suck-tournament-api

## Role

`apps/suck-tournament-api` is the standalone StarCraft 2 tournament API. It is an on-demand app: only develop or maintain it when explicitly requested. It uses Fastify 5, PostgreSQL via `@fastify/postgres`, Postgrator migrations, SSE (`@fastify/sse`), Swagger, and an optional Python SC2 replay parser.

Read this guide before editing files under `apps/suck-tournament-api`.

- **Stay in scope**: this app is only worked on when explicitly requested; do not add suck routes to other apps.

## Startup Workflow

Follow the root `AGENTS.md` first. State lives at the repo root: read `feature_list.json` and `progress.md` for the active feature, then run the verification commands below. Do not create app-local state files.

## Hard Rules

- Use ESM modules.
- Use parameterized SQL only.
- All tables live in the `axsuck` schema. Qualify table names as `axsuck.<table>` in SQL.
- Routes are plain async functions and must not be wrapped with `fastify-plugin`.
- `plugins/database.js` is the shared plugin; it decorates `fastify.db` (aliased to `fastify.pg`) and runs migrations on startup.
- Repositories are factory functions named `XxxRepo(db)` under `repositories/`.
- Add `do` and `undo` migrations together for every schema change.
- Use `fastify.httpErrors` (from `@fastify/sensible`) for HTTP errors.
- Client identity comes from the `x-player-id` and `x-qq-group` request headers, not JWT.
- Do not add suck endpoints to `apps/api-fastify`; the integration is cancelled.
- This app is a root pnpm workspace package. Do not add a local `pnpm-lock.yaml` or `pnpm-workspace.yaml`; run installs from the repository root.

## Architecture

```text
Route (routes/*.js)
  -> Repository factory (repositories/*-repo.js)
    -> fastify.db.query(...)
```

- Routes live in `routes/`.
- Repositories live in `repositories/`.
- Migrations live in `migrations/` (`{NNN}.do.description.sql` + `{NNN}.undo.description.sql`).
- Utility and migration scripts live in `scripts/`.
- The API is served under the `/api` prefix; Swagger UI is at `/docs`.

## Database

- Schema: `axsuck` (with `search_path = axsuck, public`).
- Primary keys are `TEXT` unless an existing table says otherwise.
- Timestamps use `TIMESTAMPTZ DEFAULT NOW()`.
- `DATABASE_URL` is required and read from `.env`.

## Verification Commands

- Lint/typecheck: none defined.
- Tests: `pnpm --filter suck-tournament-api test` (`node --test`, no DB needed); smoke test `node scripts/test-api.js` (manual, needs a reachable `DATABASE_URL`).
- Build: none (plain ESM Node, `node app.js`).
- Dev server: `pnpm --filter suck-tournament-api dev` (port 3100); web + API via `pnpm dev:suck`.
- Migrations: `pnpm --filter suck-tournament-api migrate`
- Env: `DATABASE_URL` is required and read from `.env`.
- Swagger docs: `http://localhost:3100/docs`

## Definition of Done

This app's work is done only when:

- The smoke test or an equivalent manual API check passes against a real database.
- New or changed `do` migrations have a matching `undo` migration.
- The change follows the Hard Rules and architecture above and stays within on-demand scope.
- Evidence is recorded in the root `progress.md`, and the root `feature_list.json` status/evidence is updated.
