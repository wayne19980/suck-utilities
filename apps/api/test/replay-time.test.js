import assert from "node:assert/strict";
import { test } from "node:test";
import { latestReplayEnd } from "../lib/replay-time.js";

test("latestReplayEnd uses the latest in-game end, not upload time", () => {
  const replays = [
    { parsed_data: JSON.stringify({ start_time: 1000, game_length: 600 }) },
    { parsed_data: JSON.stringify({ start_time: 2000, game_length: 500 }) },
    { parsed_data: "not-json" },
    { parsed_data: { start_time: 3000, game_length: 60 } },
  ];
  assert.equal(latestReplayEnd(replays), 3060);
});

test("latestReplayEnd falls back to the game_length column", () => {
  const replays = [{ parsed_data: JSON.stringify({ start_time: 100 }), game_length: 50 }];
  assert.equal(latestReplayEnd(replays), 150);
});

test("latestReplayEnd returns null without a start time", () => {
  assert.equal(latestReplayEnd([{ parsed_data: JSON.stringify({ game_length: 600 }) }]), null);
});
