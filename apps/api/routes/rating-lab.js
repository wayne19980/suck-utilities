import { LadderRepo } from '../repositories/ladder-repo.js';
import { computeRatingLab } from '../lib/rating-lab.js';

export default async function ratingLabRoutes(fastify) {
  const repo = LadderRepo(fastify.db);
  let cache = null;
  let cachedAt = 0;

  // Read-only experiment: weighted Bradley-Terry overall, race-specific Glicko
  // boards and a highest-race-MMR view. Never used by the ladder or seed code.
  fastify.get('/rating-lab', async () => {
    if (cache && Date.now() - cachedAt < 60_000) return cache;
    const data = await repo.ratingLabData();
    cache = computeRatingLab(data);
    cachedAt = Date.now();
    return cache;
  });
}
