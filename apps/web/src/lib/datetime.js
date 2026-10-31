// Match-time helpers. Stored match times are Beijing time (UTC+8), in the
// legacy display format "2026-10-22 (周四) 20:30" (a missing time means 20:00).

export const SOURCE_TIME_ZONE = "Asia/Shanghai";
export const SOURCE_OFFSET_MINUTES = 8 * 60;
export const SOURCE_LABEL = "北京时间";

const pad = (n) => String(n).padStart(2, "0");

/**
 * Parse a stored match time into its Beijing-time parts. Accepts the legacy
 * display form, "YYYY-MM-DD HH:mm" and "YYYY-MM-DDTHH:mm".
 * Returns { y, m, d, hh, mm } or null.
 */
export function parseStored(value) {
  const m = String(value ?? "").match(
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[^\d]*(\d{1,2}):(\d{2}))?/,
  );
  if (!m) return null;
  return {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    hh: m[4] == null ? 20 : Number(m[4]),
    mm: m[5] == null ? 0 : Number(m[5]),
  };
}

/** The real moment of a stored Beijing time, or null. */
export function toInstant(value) {
  const p = parseStored(value);
  if (!p) return null;
  return new Date(
    Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm) - SOURCE_OFFSET_MINUTES * 60000,
  );
}

/** Viewer's IANA time zone, e.g. "Asia/Tokyo"; undefined if unknown. */
export function viewerTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const EN_WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function zoneParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const out = {};
  for (const part of fmt.formatToParts(date)) out[part.type] = part.value;
  return out;
}

/** "2026/11/01 周日 21:30" for `date` as seen in `timeZone` (default: viewer's). */
export function formatInZone(date, timeZone = undefined) {
  const p = zoneParts(date, timeZone);
  return `${p.year}/${p.month}/${p.day} ${WEEKDAYS[EN_WEEKDAYS[p.weekday]]} ${p.hour}:${p.minute}`;
}

/** UTC offset of `timeZone` at `date`, in minutes. */
export function zoneOffsetMinutes(date, timeZone = undefined) {
  const p = zoneParts(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

/** "UTC+9", "UTC-4:30". */
export function offsetLabel(minutes) {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${pad(m)}` : ""}`;
}

/**
 * Live countdown text. Returns { phase: "before" | "after", text } where text
 * is "3 天 04:12:09" / "04:12:09" before the start and "已开赛 1 小时 5 分" after.
 */
export function countdown(target, now = new Date()) {
  const diff = target.getTime() - now.getTime();
  if (diff > 0) {
    const total = Math.floor(diff / 1000);
    const days = Math.floor(total / 86400);
    const clock = `${pad(Math.floor((total % 86400) / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
    return { phase: "before", text: days > 0 ? `${days} 天 ${clock}` : clock };
  }
  const mins = Math.floor(-diff / 60000);
  const text =
    mins < 60
      ? `已开赛 ${mins} 分钟`
      : `已开赛 ${Math.floor(mins / 60)} 小时 ${mins % 60} 分`;
  return { phase: "after", text };
}
