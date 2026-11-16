export const PLAYER_ACTIVE_DAYS = 365;

/**
 * "Active" mirrors the ladder page: a completed game within the last year.
 * Players who have never played fall back to their account age so newcomers
 * still show up in the quick pickers.
 */
export function isRecentlyActive(player, now = Date.now()) {
  const p = typeof player === "string" ? { last_game_at: player } : player || {};
  const stamp = p.last_game_at || p.created_at;
  if (!stamp) return false;
  const time = new Date(stamp).getTime();
  if (!Number.isFinite(time)) return false;
  return now - time <= PLAYER_ACTIVE_DAYS * 24 * 60 * 60 * 1000;
}

export function activityLabel(player) {
  const p = typeof player === "string" ? { last_game_at: player } : player || {};
  if (p.last_game_at) {
    return `最近对局: ${new Date(p.last_game_at).toLocaleDateString("zh-CN")}`;
  }
  return p.created_at ? "暂无对局记录（新选手）" : "无对局记录";
}
