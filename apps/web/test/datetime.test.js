import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countdown,
  formatInZone,
  offsetLabel,
  parseStored,
  toInstant,
  zoneOffsetMinutes,
} from "../src/lib/datetime.js";

test("parseStored reads the legacy Beijing-time format", () => {
  assert.deepEqual(parseStored("2026-10-22 (周四) 20:30"), {
    y: 2026,
    m: 10,
    d: 22,
    hh: 20,
    mm: 30,
  });
  assert.deepEqual(parseStored("2026-10-22T20:30"), {
    y: 2026,
    m: 10,
    d: 22,
    hh: 20,
    mm: 30,
  });
  assert.equal(parseStored(""), null);
});

test("toInstant treats the stored time as Asia/Shanghai", () => {
  const instant = toInstant("2026-10-22 (周四) 20:30");
  assert.equal(instant.toISOString(), "2026-10-22T12:30:00.000Z");
});

test("formatInZone converts to the viewer's zone", () => {
  const instant = toInstant("2026-10-22 (周四) 20:30");
  assert.equal(formatInZone(instant, "Asia/Shanghai"), "2026/10/22 周四 20:30");
  assert.equal(formatInZone(instant, "Asia/Tokyo"), "2026/10/22 周四 21:30");
  assert.equal(formatInZone(instant, "America/New_York"), "2026/10/22 周四 08:30");
});

test("zone offsets include half-hour zones", () => {
  const instant = toInstant("2026-10-22 (周四) 20:30");
  assert.equal(zoneOffsetMinutes(instant, "Asia/Kolkata"), 330);
  assert.equal(offsetLabel(330), "UTC+5:30");
  assert.equal(offsetLabel(-240), "UTC-4");
});

test("countdown reports time before and after the start", () => {
  const target = new Date("2026-10-22T12:30:00.000Z");
  assert.deepEqual(countdown(target, new Date("2026-10-20T08:29:51Z")), {
    phase: "before",
    text: "2 天 04:00:09",
  });
  assert.deepEqual(countdown(target, new Date("2026-10-22T13:35:00Z")), {
    phase: "after",
    text: "已开赛 1 小时 5 分",
  });
});
