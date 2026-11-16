import assert from "node:assert/strict";
import { test } from "node:test";
import { computeRatingLab } from "../lib/rating-lab.js";

function baseInput(overrides = {}) {
  const players = new Map([
    ["a", { display_name: "Alpha", flag: "cn", team: "A" }],
    ["b", { display_name: "Beta", flag: "kr", team: "B" }]
  ]);
  return {
    players,
    games: [
      {
        id: 1,
        player1_id: "a",
        player2_id: "b",
        score1: 2,
        score2: 0,
        played_at: "2026-01-01T00:00:00Z"
      }
    ],
    races: new Map([
      [
        1,
        new Map([
          ["a", { pick_race: "P", play_race: "P", race: "P" }],
          ["b", { pick_race: "T", play_race: "T", race: "T" }]
        ])
      ]
    ]),
    ...overrides
  };
}

test("rating lab returns an overall BT board and race boards", () => {
  const result = computeRatingLab(baseInput());
  assert.equal(result.meta.games_total, 1);
  assert.equal(result.meta.games_with_race, 1);
  assert.equal(result.overall.length, 2);
  assert.equal(result.overall[0].id, "a");
  assert.equal(result.overall[0].display_name, "Alpha");
  assert.equal(result.races.P[0].id, "a");
  assert.equal(result.races.T[0].id, "b");
  assert.equal(result.races.Z.length, 0);
  assert.equal(result.best_race.length, 0);
});

test("Random games go to the actual race, not a Random board", () => {
  const result = computeRatingLab(
    baseInput({
      races: new Map([
        [
          1,
          new Map([
            ["a", { pick_race: "R", play_race: "Z", race: "Z" }],
            ["b", { pick_race: "P", play_race: "T", race: "T" }]
          ])
        ]
      ])
    })
  );
  assert.equal(result.races.Z[0].id, "a");
  assert.equal(result.races.T[0].id, "b");
  assert.equal(result.races.P.length, 0);
  assert.equal(result.overall.find((p) => p.id === "a").main_race, "R");
});

test("main race override and minimum race samples feed best race", () => {
  const games = [];
  const byMatch = new Map();
  for (let i = 1; i <= 5; i += 1) {
    games.push({
      id: i,
      player1_id: "a",
      player2_id: "b",
      score1: 1,
      score2: 0,
      played_at: `2026-01-0${i}T00:00:00Z`
    });
    byMatch.set(
      i,
      new Map([
        ["a", { pick_race: "T", play_race: "T", race: "T" }],
        ["b", { pick_race: "P", play_race: "P", race: "P" }]
      ])
    );
  }
  const result = computeRatingLab({
    ...baseInput(),
    games,
    races: byMatch,
    mainRaceOverrides: { a: "P" }
  });
  assert.equal(result.overall.find((p) => p.id === "a").main_race, "P");
  assert.equal(result.best_race[0].id, "a");
  assert.equal(result.best_race[0].race, "T");
  assert.equal(result.best_race[0].games, 5);
});
