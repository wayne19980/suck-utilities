import { browser } from "$app/environment";

const STORAGE_KEY = "suck.timezone";

let override = $state(
  browser ? localStorage.getItem(STORAGE_KEY) || "" : "",
);

/** Empty means "follow the browser's time zone". */
export function timeZoneOverride() {
  return override;
}

export function setTimeZoneOverride(value) {
  override = value || "";
  if (!browser) return;
  if (override) localStorage.setItem(STORAGE_KEY, override);
  else localStorage.removeItem(STORAGE_KEY);
}

export function effectiveTimeZone() {
  if (override) return override;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
