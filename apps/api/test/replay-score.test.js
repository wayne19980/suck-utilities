import assert from "node:assert/strict";
import { test } from "node:test";
import { computeReplaySeriesStats, summarizeSeries } from "../lib/replay-score.js";

const wayne = {
  id: "wayne",
  display_name: "wayne",
  battle_tags: "{}",
  bnet_ids: JSON.stringify([
    { id: "Wayne", url: "https://starcraft2.com/en-us/profile/5/1/9870396" },
  ]),
};

const opponent = {
  id: "opponent",
  display_name: "opponent",
  battle_tags: "{}",
  bnet_ids: "[]",
};

function game(winner) {
  const wayneResult = winner === "wayne" ? "Win" : "Loss";
  const oppResult = winner === "opponent" ? "Win" : "Loss";
  return {
    parsed_data: {
      teams: [
        {
          players: [
            {
              name: "Wayne",
              region_id: 5,
              subregion: 1,
              toon_id: 9870396,
              result: wayneResult,
            },
          ],
        },
        { players: [{ name: "opponent", result: oppResult }] },
      ],
    },
  };
}

test("sums game wins by Battle.net account, not display name", () => {
  const stats = computeReplaySeriesStats({
    replays: [game("wayne"), game("wayne"), game("opponent")],
    player1: wayne,
    player2: opponent,
  });
  assert.deepEqual(stats, { score1: 2, score2: 1, games: 3 });
});

test("accepts parsed_data as a JSON string and skips malformed rows", () => {
  const stats = computeReplaySeriesStats({
    replays: [
      { parsed_data: JSON.stringify(game("wayne").parsed_data) },
      { parsed_data: "not json" },
      { parsed_data: null },
    ],
    player1: wayne,
    player2: opponent,
  });
  assert.deepEqual(stats, { score1: 1, score2: 0, games: 3 });
});

test("returns zeros without replays or players", () => {
  assert.deepEqual(computeReplaySeriesStats(), { score1: 0, score2: 0, games: 0 });
  assert.deepEqual(
    computeReplaySeriesStats({ replays: [game("wayne")], player1: null, player2: opponent }),
    { score1: 0, score2: 0, games: 1 },
  );
});

test("BO3 series needs one side to reach two wins", () => {
  assert.deepEqual(summarizeSeries({ score1: 2, score2: 1, games: 3, bestOf: 3 }), {
    score1: 2,
    score2: 1,
    games: 3,
    best_of: 3,
    target: 2,
    complete: true,
  });
  assert.equal(summarizeSeries({ score1: 1, score2: 0, games: 1, bestOf: 3 }).complete, false);
  assert.equal(summarizeSeries({ score1: 1, score2: 1, games: 2, bestOf: 3 }).complete, false);
  assert.equal(summarizeSeries({ score1: 0, score2: 0, games: 0, bestOf: 3 }).complete, false);
});

test("BO1 completes with a single game and defaults an unknown best-of to BO1", () => {
  assert.equal(summarizeSeries({ score1: 1, score2: 0, games: 1, bestOf: 1 }).complete, true);
  assert.deepEqual(summarizeSeries({ score1: 1, score2: 0, games: 1 }), {
    score1: 1,
    score2: 0,
    games: 1,
    best_of: 1,
    target: 1,
    complete: true,
  });
});