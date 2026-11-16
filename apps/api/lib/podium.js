// Tournament podium: champion and runner-up, split by bracket format.
//
// `matches.winner_id` already stores the *advancer*, not the game winner:
// classic SUCK ("败者晋级") advances the loser of the game, so the final's
// `winner_id` is the champion in both formats. The format only changes how the
// result should be presented / counted, never which id is the champion.

export function tournamentFormat(tournament) {
  const value = tournament?.loser_advances;
  if (value == null) return "loser_advances";
  return Number(value) === 0 ? "winner_advances" : "loser_advances";
}

function isDecidedFinal(match) {
  return (
    match &&
    match.round === 1 &&
    match.position === 1 &&
    match.winner_id &&
    (match.status === "completed" || match.status === "walkover")
  );
}

/**
 * One `{ champion, runner_up }` entry per completed tournament.
 *
 * @param {Array} tournaments rows with id/name/created_at/loser_advances
 * @param {Array} matches rows with tournament_id/round/position/status/winner_id/player1_id/player2_id
 */
export function computePodiums(tournaments = [], matches = []) {
  const finals = new Map();
  for (const match of matches) {
    if (isDecidedFinal(match)) finals.set(match.tournament_id, match);
  }

  const podiums = [];
  for (const tournament of tournaments) {
    // Match the tournament page's podium rule: only finished events count.
    if (tournament.status !== "completed") continue;
    const final = finals.get(tournament.id);
    if (!final) continue;

    const champion = final.winner_id;
    const runnerUp =
      champion === final.player1_id ? final.player2_id : final.player1_id;
    if (!champion) continue;

    podiums.push({
      tournament_id: tournament.id,
      tournament_name: tournament.name,
      created_at: tournament.created_at || null,
      format: tournamentFormat(tournament),
      champion,
      runner_up: champion === runnerUp ? null : runnerUp || null,
    });
  }
  return podiums;
}

/** `{ loser_advances: n, winner_advances: n, total: n }` counter. */
export function emptyPodiumCount() {
  return { loser_advances: 0, winner_advances: 0, total: 0 };
}

/** Apply podiums to per-player counters and tournament result markers. */
export function applyPodiums(podiums = [], playersById = new Map()) {
  const byPlayer = new Map();
  for (const podium of podiums) {
    for (const [playerId, place] of [
      [podium.champion, "champion"],
      [podium.runner_up, "runner_up"],
    ]) {
      if (!playerId) continue;
      if (playersById.size > 0 && !playersById.has(playerId)) continue;

      if (!byPlayer.has(playerId)) {
        byPlayer.set(playerId, {
          champion: emptyPodiumCount(),
          runner_up: emptyPodiumCount(),
          byTournament: new Map(),
        });
      }
      const entry = byPlayer.get(playerId);
      entry[place][podium.format] += 1;
      entry[place].total += 1;
      entry.byTournament.set(podium.tournament_id, {
        place,
        format: podium.format,
      });
    }
  }
  return byPlayer;
}
