import assert from "node:assert/strict";
import { test } from "node:test";
import { computeMatchRaces, replayPickRace, replayRace } from "../lib/match-races.js";

function replay(matchId, p1, p2) {
  return {
    match_id: matchId,
    parsed_data: {
      teams: [
        { players: [p1] },
        { players: [p2] },
      ],
    },
  };
}

const wayne = {
  id: "wayne19980",
  display_name: "wayne19980",
  battle_tags: JSON.stringify({ cn: ["wayne19980#5974"] }),
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

const wayneReplayPlayer = {
  name: "Wayne",
  race: "T",
  region_id: 5,
  subregion: 1,
  toon_id: 9870396,
  bnet_url: "https://starcraft2.com/en-us/profile/5/1/9870396",
};

test("renamed account resolves by Battle.net URL", () => {
  const races = computeMatchRaces({
    matches: [{ id: 1, player1_id: "wayne19980", player2_id: "opponent" }],
    replays: [replay(1, wayneReplayPlayer, { name: "opponent", race: "P" })],
    players: [wayne, opponent],
  });
  assert.equal(races.get(1).get("wayne19980").race, "T");
  assert.equal(races.get(1).get("opponent").race, "P");
});

test("unlinked opponent is inferred from the other side of a 1v1 replay", () => {
  const smurf = { id: "Sonde", display_name: "Sonde", battle_tags: "{}", bnet_ids: "[]" };
  const races = computeMatchRaces({
    matches: [{ id: 2, player1_id: "wayne19980", player2_id: "Sonde" }],
    replays: [replay(2, wayneReplayPlayer, { name: "SmurfAccount", race: "Z" })],
    players: [wayne, smurf],
  });
  assert.equal(races.get(2).get("wayne19980").race, "T");
  assert.equal(races.get(2).get("Sonde").race, "Z");
});

test("majority race across a series wins", () => {
  const races = computeMatchRaces({
    matches: [{ id: 3, player1_id: "wayne19980", player2_id: "opponent" }],
    replays: [
      replay(3, wayneReplayPlayer, { name: "opponent", race: "P" }),
      replay(3, wayneReplayPlayer, { name: "opponent", race: "P" }),
      replay(3, { ...wayneReplayPlayer, race: "P", play_race: "P" }, { name: "opponent", race: "Z" }),
    ],
    players: [wayne, opponent],
  });
  const counts = races.get(3).get("wayne19980").counts;
  assert.equal(races.get(3).get("wayne19980").race, "T");
  assert.deepEqual(counts, { T: 2, P: 1 });
});

test("unresolvable sides stay unknown instead of guessing", () => {
  const a = { id: "a", display_name: "a", battle_tags: "{}", bnet_ids: "[]" };
  const b = { id: "b", display_name: "b", battle_tags: "{}", bnet_ids: "[]" };
  const races = computeMatchRaces({
    matches: [{ id: 4, player1_id: "a", player2_id: "b" }],
    replays: [replay(4, { name: "x", race: "T" }, { name: "y", race: "P" })],
    players: [a, b],
  });
  assert.equal(races.size, 0);
});

test("random pick keeps R while the actual play race stays separate", () => {
  const randomPlayer = {
    name: "Wayne",
    pick_race: "R",
    race: "Z",
    play_race: "Z",
    region_id: 5,
    subregion: 1,
    toon_id: 9870396,
  };
  const races = computeMatchRaces({
    matches: [{ id: 5, player1_id: "wayne19980", player2_id: "opponent" }],
    replays: [
      replay(5, randomPlayer, { name: "opponent", race: "P" }),
      replay(5, { ...randomPlayer, race: "Z", play_race: "Z" }, { name: "opponent", race: "P" }),
      replay(5, { ...randomPlayer, race: "T", play_race: "T" }, { name: "opponent", race: "Z" }),
    ],
    players: [wayne, opponent],
  });
  const info = races.get(5).get("wayne19980");
  assert.equal(info.pick_race, "R");
  assert.equal(info.play_race, "Z");
  assert.equal(info.race, "Z");
  assert.deepEqual(info.pick_counts, { R: 3 });
  assert.deepEqual(info.play_counts, { Z: 2, T: 1 });
});

test("replayRace prefers the race actually played", () => {
  assert.equal(replayRace({ play_race: "Z", race: "T", pick_race: "R" }), "Z");
  assert.equal(replayRace({ race: "?", pick_race: "P" }), "P");
  assert.equal(replayRace({}), null);
});

test("replayPickRace prefers the selected race", () => {
  assert.equal(replayPickRace({ play_race: "Z", race: "Z", pick_race: "R" }), "R");
  assert.equal(replayPickRace({ race: "?", play_race: "P" }), "P");
  assert.equal(replayPickRace({}), null);
});
