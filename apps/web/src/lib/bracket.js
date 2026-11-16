// Bracket display helpers.
//
// Internal round numbering is reversed: `round = 1` is the final, `round = max`
// is the first round. The UI must show rounds the other way around (Round 1,
// quarterfinals, ... final), which is what the helpers here do.

export function maxRound(matches = []) {
  let max = 1;
  for (const m of matches) {
    if (m && m.round > max) max = m.round;
  }
  return max;
}

/** 1-based round number counted from the first round (final = totalRounds). */
export function displayRound(round, totalRounds) {
  if (round === 0) return 0;
  return totalRounds - round + 1;
}

export function roundLabel(round, totalRounds) {
  if (round === 0) return "三四名决赛";
  const d = displayRound(round, totalRounds);
  if (d === totalRounds) return "总决赛";
  if (d === totalRounds - 1) return "半决赛";
  if (d === totalRounds - 2) return "四分之一决赛";
  return `第 ${d} 轮`;
}

/** Compact label for overlay tickers/badges: R1, QF, SF, F, 3rd. */
export function roundShortLabel(round, totalRounds) {
  if (round === 0) return "3RD";
  const d = displayRound(round, totalRounds);
  if (d === totalRounds) return "F";
  if (d === totalRounds - 1) return "SF";
  if (d === totalRounds - 2) return "QF";
  return `R${d}`;
}

/**
 * Challonge-style bracket numbers (1..N), first round first.
 * Hidden bye matches are not numbered. Settled matches keep their static
 * number. Pending matches take the remaining numbers ordered by round, then by
 * the number of byes in their child matches (more byes first), then position.
 */
export function buildMatchOrder(matches = []) {
  const order = new Map();
  const main = matches
    .filter((m) => m && m.round > 0 && !isByeMatch(m))
    .sort((a, b) => b.round - a.round || a.position - b.position || a.id - b.id);
  const third = matches
    .filter((m) => m && m.round === 0 && !isByeMatch(m))
    .sort((a, b) => a.position - b.position || a.id - b.id);
  const all = [...main, ...third];
  all.forEach((match, index) => order.set(match.id, index + 1));

  const settledIds = new Set(all.filter((m) => isSettled(m)).map((m) => m.id));
  const settledSlots = new Set(
    all.filter((m) => settledIds.has(m.id)).map((m) => order.get(m.id)),
  );
  const available = all
    .map((m) => order.get(m.id))
    .filter((slot) => !settledSlots.has(slot));

  const byesBefore = (match) => {
    if (!match || match.round <= 0) return 0;
    const childRound = match.round + 1;
    const positions = [match.position * 2 - 1, match.position * 2];
    return positions.reduce((count, position) => {
      const child = matches.find(
        (m) => m && m.round === childRound && m.position === position,
      );
      return count + (child && isByeMatch(child) ? 1 : 0);
    }, 0);
  };

  const pendingMain = main.filter((m) => !settledIds.has(m.id));
  const pendingThird = third.filter((m) => !settledIds.has(m.id));
  const ordered = [...pendingMain].sort((a, b) => {
    if (a.round !== b.round) return b.round - a.round;
    const aByes = byesBefore(a);
    const bByes = byesBefore(b);
    if (aByes !== bByes) return bByes - aByes;
    return a.position - b.position || a.id - b.id;
  });

  [...ordered, ...pendingThird].forEach((match, index) => {
    const slot = available[index];
    if (slot != null) order.set(match.id, slot);
  });
  return order;
}

function isByeMatch(match) {
  return Boolean(
    match &&
      match.status === "completed" &&
      match.winner_id &&
      (!match.player1_id || !match.player2_id),
  );
}

function isSettled(match) {
  return Boolean(match && ["completed", "walkover"].includes(match.status));
}

/** Pending, playable matches in recommended order. */
export function playableMatchIds(matches = [], order = buildMatchOrder(matches)) {
  return matches
    .filter((m) => m.status === "pending" && m.player1_id && m.player2_id)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    .map((m) => m.id);
}

/**
 * Pending matches in recommended play order: top-to-bottom by static bracket
 * number, but avoid scheduling the same player in two consecutive matches when
 * another match is available. Large brackets benefit most.
 */
export function recommendPendingMatches(matches = [], order = buildMatchOrder(matches)) {
  const remaining = matches
    .filter((m) => m.status === "pending" && m.player1_id && m.player2_id)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (remaining.length < 2) return remaining;

  const result = [];
  let previous = new Set();
  while (remaining.length) {
    const index = remaining.findIndex(
      (m) => !previous.has(m.player1_id) && !previous.has(m.player2_id),
    );
    const [match] = remaining.splice(index >= 0 ? index : 0, 1);
    result.push(match);
    previous = new Set([match.player1_id, match.player2_id]);
  }
  return result;
}
