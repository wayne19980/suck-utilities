import { redirect } from "@sveltejs/kit";

// The ladder view now lives in /stats (MMR column, tier, recent games, MMR chart).
export function load() {
  throw redirect(307, "/stats");
}
