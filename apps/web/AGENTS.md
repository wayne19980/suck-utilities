# AI Guide: suck-tournament-web

## Role

`apps/suck-tournament-web` is the standalone StarCraft 2 tournament web app. It is an on-demand app: only develop or maintain it when explicitly requested. It is a SvelteKit SPA (SSR disabled, static adapter) using Svelte 5 runes, Tailwind CSS v4, shadcn-svelte, and `$lib/api.js` to talk to `suck-tournament-api`.

Read this guide before editing files under `apps/suck-tournament-web`.

- **Stay in scope**: this app is only worked on when explicitly requested; do not add suck UI to the Bangumi app.

## Startup Workflow

Follow the root `AGENTS.md` first. State lives at the repo root: read `feature_list.json` and `progress.md` for the active feature, then run the verification commands below. Do not create app-local state files.

## Hard Rules

- Use Svelte 5 runes for new code; the Svelte compiler runs with `runes: true`.
- Do not introduce `export let`, `$:` reactive labels, or Svelte 4 store patterns in new components.
- Keep `export const ssr = false` and `export const prerender = false` in `src/routes/+layout.js`; this is a client-only SPA.
- Call the backend through the `API` object in `$lib/api.js`. Do not call `fetch` directly from pages or components.
- Client identity is `localStorage`-backed and injected as headers by `$lib/api.js`: `x-player-id` and `x-qq-group`. Keep that behavior aligned with `$lib/user.svelte.js`.
- Use shadcn-svelte primitives from `$lib/components/ui`; install new ones only when needed.
- Use `@lucide/svelte` for icons.
- Do not add another UI framework.
- Minimum UI font size is **11px**: do not introduce `text-[9px]`/`text-[10px]` in normal pages. Only the 128-player mini bracket and the OBS overlay may go smaller (they use 7–10px intentionally).

## Project Shape

- Routes live in `src/routes` (`+page.svelte`, `tournament/[id]/`, `tournament/[id]/overlay/`, `overlay/` (caster-bound OBS source, `?user=<player_id>`), `players/`, `stats/`; `ladder/` only redirects to `/stats`).
- The OBS stage itself is `src/lib/components/TournamentOverlay.svelte` (a `tid` prop); both overlay routes are thin wrappers. Broadcast state lives in `$lib/broadcast.js` + `axsuck.broadcasts`, not in localStorage.
- Shared utilities live in `src/lib` (`api.js`, `utils.js`, `datetime.js`, `timezone.svelte.js`, `coalesced-refresh.js`).
- Tournament times are stored as Beijing time (`scheduled_time`); render them with `MatchTime.svelte` / `datetime.js` (`toInstant` + `formatInZone`), never with raw `toLocaleString`. BO is `tournament.best_of` (BO1 uses the “pick game winner” flow, BO3+ uses score entry).
- App state uses a class with `$state`, e.g. `src/lib/user.svelte.js`.
- UI primitives live in `src/lib/components/ui`.
- The dev server runs on port 5175 and proxies `/api` to `http://127.0.0.1:3100`.

## Verification Commands

- Lint/typecheck: none defined; the build below is the closest check.
- Tests: `pnpm --filter suck-tournament-web test` (`node --test`; pure helpers such as bracket/round labels).
- Build: `pnpm --filter suck-tournament-web build`
- Dev server: `pnpm dev:suck` (port 5175; proxies `/api` to `http://127.0.0.1:3100`)
- UI flow: verify routes with the Playwright CLI and skill when UI behavior changes.

## Definition of Done

This app's work is done only when:

- `pnpm --filter suck-tournament-web build` passes.
- UI changes were verified with the dev server and Playwright.
- The change matches the Hard Rules above and stays within on-demand scope.
- Evidence is recorded in the root `progress.md`, and the root `feature_list.json` status/evidence is updated.
