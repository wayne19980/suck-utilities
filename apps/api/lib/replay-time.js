// Latest actual game end across a match's replays, as epoch seconds.
//
// `start_time` is the replay's in-game start (epoch seconds) and
// `game_length` is the game duration in seconds, so upload time is never used.

export function latestReplayEnd(replays = []) {
  let latest = null;
  for (const replay of replays) {
    if (!replay) continue;
    let parsed = replay.parsed_data;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        continue;
      }
    }
    const start = Number(parsed?.start_time);
    const length = Number(parsed?.game_length ?? replay.game_length);
    if (!Number.isFinite(start) || start <= 0) continue;
    const end = start + (Number.isFinite(length) && length > 0 ? length : 0);
    if (latest == null || end > latest) latest = end;
  }
  return latest;
}
