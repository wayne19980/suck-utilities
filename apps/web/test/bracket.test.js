import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMatchOrder,
  displayRound,
  maxRound,
  playableMatchIds,
  recommendPendingMatches,
  roundLabel,
  roundShortLabel,
} from "../src/lib/bracket.js";

test("round labels count up from the first round", () => {
  // 16-player bracket: internal round 4 is the first round.
  assert.equal(roundLabel(4, 4), "第 1 轮");
  assert.equal(roundLabel(3, 4), "四分之一决赛");
  assert.equal(roundLabel(2, 4), "半决赛");
  assert.equal(roundLabel(1, 4), "总决赛");
  assert.equal(roundLabel(0, 4), "三四名决赛");

  // 8-player bracket: the first round is the quarterfinal.
  assert.equal(roundLabel(3, 3), "四分之一决赛");
  assert.equal(roundLabel(2, 3), "半决赛");
  assert.equal(roundLabel(1, 3), "总决赛");
});

test("128-player round labels stay in ascending display order", () => {
  // 128 players => 7 internal rounds; round 7 is the first round.
  assert.equal(roundLabel(7, 7), "第 1 轮");
  assert.equal(roundLabel(6, 7), "第 2 轮");
  assert.equal(roundLabel(5, 7), "第 3 轮");
  assert.equal(roundLabel(4, 7), "第 4 轮");
  assert.equal(roundLabel(3, 7), "四分之一决赛");
  assert.equal(roundLabel(2, 7), "半决赛");
  assert.equal(roundLabel(1, 7), "总决赛");
});

test("displayRound and roundShortLabel", () => {
  assert.equal(displayRound(4, 4), 1);
  assert.equal(displayRound(0, 4), 0);
  assert.equal(roundShortLabel(4, 4), "R1");
  assert.equal(roundShortLabel(3, 4), "QF");
  assert.equal(roundShortLabel(2, 4), "SF");
  assert.equal(roundShortLabel(1, 4), "F");
  assert.equal(roundShortLabel(0, 4), "3RD");
});

test("buildMatchOrder numbers first round first, stable across statuses", () => {
  const matches = [
    { id: 10, round: 2, position: 1 },
    { id: 11, round: 2, position: 2 },
    { id: 20, round: 1, position: 1 },
    { id: 30, round: 0, position: 1 },
  ];
  const order = buildMatchOrder(matches);
  assert.equal(order.get(10), 1);
  assert.equal(order.get(11), 2);
  assert.equal(order.get(20), 3);
  assert.equal(order.get(30), 4);

  // Completing a match must not renumber the remaining ones.
  const after = buildMatchOrder(matches.map((m) => (m.id === 10 ? { ...m, status: "completed" } : m)));
  assert.equal(after.get(10), 1);
  assert.equal(after.get(20), 3);
});

test("playableMatchIds skips TBD/completed matches and sorts by bracket order", () => {
  const matches = [
    { id: 10, round: 2, position: 1, status: "completed", player1_id: "a", player2_id: "b" },
    { id: 11, round: 2, position: 2, status: "pending", player1_id: "c", player2_id: "d" },
    { id: 20, round: 1, position: 1, status: "pending", player1_id: "a", player2_id: "c" },
    { id: 21, round: 1, position: 2, status: "pending", player1_id: "b", player2_id: null },
  ];
  assert.deepEqual(playableMatchIds(matches), [11, 20]);
});

test("maxRound ignores missing and zero rounds", () => {
  assert.equal(maxRound([]), 1);
  assert.equal(maxRound([{ round: 0 }, { round: 3 }, { round: 2 }]), 3);
});

test("recommendPendingMatches avoids back-to-back players when possible", () => {
  const matches = [
    { id: 1, round: 2, position: 1, status: "pending", player1_id: "a", player2_id: "b" },
    { id: 2, round: 2, position: 2, status: "pending", player1_id: "b", player2_id: "c" },
    { id: 3, round: 2, position: 3, status: "pending", player1_id: "d", player2_id: "e" },
  ];
  const ordered = recommendPendingMatches(matches);
  assert.deepEqual(ordered.map((m) => m.id), [1, 3, 2]);
});

test("recommendPendingMatches falls back when every match shares a player", () => {
  const matches = [
    { id: 1, round: 2, position: 1, status: "pending", player1_id: "a", player2_id: "b" },
    { id: 2, round: 2, position: 2, status: "pending", player1_id: "a", player2_id: "c" },
  ];
  const ordered = recommendPendingMatches(matches);
  assert.deepEqual(ordered.map((m) => m.id), [1, 2]);
});


test("buildMatchOrder skips hidden bye matches", () => {
  const matches = [
    { id: 1, round: 2, position: 1, status: "completed", winner_id: "a", player1_id: "a", player2_id: null },
    { id: 2, round: 2, position: 2, status: "pending", player1_id: "b", player2_id: "c" },
    { id: 3, round: 2, position: 3, status: "completed", winner_id: "d", player1_id: "d", player2_id: null },
    { id: 4, round: 2, position: 4, status: "pending", player1_id: "e", player2_id: "f" },
    { id: 5, round: 1, position: 1, status: "pending", player1_id: null, player2_id: null },
  ];
  const order = buildMatchOrder(matches);
  assert.equal(order.has(1), false);
  assert.equal(order.has(3), false);
  assert.equal(order.get(2), 1);
  assert.equal(order.get(4), 2);
  assert.equal(order.get(5), 3);
});

test("buildMatchOrder sorts a round by previous-round byes", () => {
  const bye = (id, position, seed) => ({
    id,
    round: 4,
    position,
    status: "completed",
    winner_id: seed,
    player1_id: seed,
    player2_id: null,
  });
  const matches = [
    bye("r1p1", 1, "seed1"),
    { id: "r1p2", round: 4, position: 2, status: "pending", player1_id: "欧布桑", player2_id: "EthanCheung" },
    bye("r1p3", 3, "seed8"),
    bye("r1p4", 4, "seed5"),
    bye("r1p5", 5, "seed4"),
    { id: "r1p6", round: 4, position: 6, status: "pending", player1_id: "Vermilion", player2_id: "Starshim" },
    bye("r1p7", 7, "seed3"),
    { id: "r1p8", round: 4, position: 8, status: "pending", player1_id: "老刀把子", player2_id: "Hip" },
    { id: "qf1", round: 3, position: 1, status: "pending", player1_id: "Buqun", player2_id: null },
    { id: "qf2", round: 3, position: 2, status: "pending", player1_id: "Sonde", player2_id: "wayne19980" },
    { id: "qf3", round: 3, position: 3, status: "pending", player1_id: "Crepuscule", player2_id: null },
    { id: "qf4", round: 3, position: 4, status: "pending", player1_id: "Sarutobi", player2_id: null },
    { id: "sf1", round: 2, position: 1, status: "pending", player1_id: null, player2_id: null },
    { id: "sf2", round: 2, position: 2, status: "pending", player1_id: null, player2_id: null },
    { id: "final", round: 1, position: 1, status: "pending", player1_id: null, player2_id: null },
  ];
  const order = buildMatchOrder(matches);
  assert.equal(order.get("r1p2"), 1);
  assert.equal(order.get("r1p6"), 2);
  assert.equal(order.get("r1p8"), 3);
  assert.equal(order.get("qf2"), 4);
  assert.equal(order.get("qf1"), 5);
  assert.equal(order.get("qf3"), 6);
  assert.equal(order.get("qf4"), 7);
  assert.equal(order.get("sf1"), 8);
  assert.equal(order.get("sf2"), 9);
  assert.equal(order.get("final"), 10);
});
