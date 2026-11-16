import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPodiums,
  computePodiums,
  tournamentFormat,
} from "../lib/podium.js";

const tournaments = [
  {
    id: "classic",
    name: "SUCK#1",
    status: "completed",
    created_at: "2026-01-01T12:00:00Z",
    loser_advances: 1,
  },
  {
    id: "normal",
    name: "SUCK#2",
    status: "completed",
    created_at: "2026-02-01T12:00:00Z",
    loser_advances: 0,
  },
];

const matches = [
  // Classic: player2 won the game, so player1 (the loser) advances and is champion.
  {
    tournament_id: "classic",
    round: 1,
    position: 1,
    status: "completed",
    player1_id: "p1",
    player2_id: "p2",
    score1: 1,
    score2: 0,
    winner_id: "p2",
  },
  // Normal: player1 won the game and is champion.
  {
    tournament_id: "normal",
    round: 1,
    position: 1,
    status: "completed",
    player1_id: "p1",
    player2_id: "p2",
    score1: 1,
    score2: 0,
    winner_id: "p1",
  },
];

test("loser-advances final crowns the game loser via winner_id", () => {
  const podiums = computePodiums(tournaments, matches);
  const classic = podiums.find((p) => p.tournament_id === "classic");
  assert.deepEqual(classic, {
    tournament_id: "classic",
    tournament_name: "SUCK#1",
    created_at: "2026-01-01T12:00:00Z",
    format: "loser_advances",
    champion: "p2",
    runner_up: "p1",
  });
});

test("winner-advances final crowns the game winner via winner_id", () => {
  const podiums = computePodiums(tournaments, matches);
  const normal = podiums.find((p) => p.tournament_id === "normal");
  assert.equal(normal.format, "winner_advances");
  assert.equal(normal.champion, "p1");
  assert.equal(normal.runner_up, "p2");
});

test("undecided finals and tournaments without a final are skipped", () => {
  const podiums = computePodiums(
    [...tournaments, { id: "pending", name: "SUCK#3", status: "in_progress", loser_advances: 1 }],
    [
      ...matches,
      {
        tournament_id: "pending",
        round: 1,
        position: 1,
        status: "pending",
        player1_id: "p1",
        player2_id: "p2",
        winner_id: null,
      },
    ]
  );
  assert.deepEqual(
    podiums.map((p) => p.tournament_id),
    ["classic", "normal"]
  );
});

test("winner_id, not score, decides the champion in both formats", () => {
  const podiums = computePodiums(tournaments, [
    { ...matches[0], winner_id: "p1" },
    { ...matches[1], winner_id: "p2" },
  ]);
  assert.equal(podiums.find((p) => p.tournament_id === "classic").champion, "p1");
  assert.equal(podiums.find((p) => p.tournament_id === "normal").champion, "p2");
});

test("only completed tournaments count", () => {
  const podiums = computePodiums(
    [{ ...tournaments[0], status: "in_progress" }],
    matches
  );
  assert.equal(podiums.length, 0);
});

test("null loser_advances defaults to the classic format", () => {
  assert.equal(tournamentFormat({ loser_advances: null }), "loser_advances");
  assert.equal(tournamentFormat({ loser_advances: 0 }), "winner_advances");
});

test("podium counts are split by format for each player", () => {
  const podiums = computePodiums(tournaments, matches);
  const byPlayer = applyPodiums(
    podiums,
    new Map(["p1", "p2"].map((id) => [id, { id }]))
  );

  assert.deepEqual(byPlayer.get("p1").champion, {
    loser_advances: 0,
    winner_advances: 1,
    total: 1,
  });
  assert.deepEqual(byPlayer.get("p1").runner_up, {
    loser_advances: 1,
    winner_advances: 0,
    total: 1,
  });
  assert.deepEqual(byPlayer.get("p2").champion, {
    loser_advances: 1,
    winner_advances: 0,
    total: 1,
  });
  assert.deepEqual(byPlayer.get("p2").runner_up, {
    loser_advances: 0,
    winner_advances: 1,
    total: 1,
  });
  assert.deepEqual(byPlayer.get("p1").byTournament.get("classic"), {
    place: "runner_up",
    format: "loser_advances",
  });
});
