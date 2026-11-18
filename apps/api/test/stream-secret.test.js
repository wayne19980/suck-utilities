import assert from "node:assert/strict";
import { test } from "node:test";
import {
  initStreamSecret,
  resetStreamSecretCache,
  signStreamKey,
  streamKeySecret,
  verifyStreamKey,
} from "../lib/stream-key.js";

// Each test starts from a cold cache and no configured env override.
function withCleanState(fn) {
  return async () => {
    const previous = process.env.STREAM_KEY_SECRET;
    delete process.env.STREAM_KEY_SECRET;
    resetStreamSecretCache();
    try {
      await fn();
    } finally {
      if (previous === undefined) delete process.env.STREAM_KEY_SECRET;
      else process.env.STREAM_KEY_SECRET = previous;
      resetStreamSecretCache();
    }
  };
}

function fakeDb(initial = []) {
  const rows = initial.map((value) => ({ value }));
  const state = { selects: 0, inserts: 0 };
  return {
    state,
    query: async (sql, params) => {
      if (sql.includes("SELECT value")) {
        state.selects += 1;
        return { rows: rows.slice() };
      }
      if (sql.includes("INSERT")) {
        state.inserts += 1;
        if (rows.length === 0) rows.push({ value: params[1] });
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

test(
  "initStreamSecret generates a secret once and reuses it",
  withCleanState(async () => {
    const db = fakeDb();
    const secret = await initStreamSecret(db);
    assert.ok(secret.length >= 32);
    assert.equal(db.state.inserts, 1);
    assert.equal(streamKeySecret(), secret);

    const again = await initStreamSecret(db);
    assert.equal(again, secret);
    assert.equal(db.state.inserts, 1);
  }),
);

test(
  "initStreamSecret reads an existing database value without inserting",
  withCleanState(async () => {
    const db = fakeDb(["stored-secret"]);
    assert.equal(await initStreamSecret(db), "stored-secret");
    assert.equal(db.state.inserts, 0);
    assert.equal(streamKeySecret(), "stored-secret");
  }),
);

test(
  "STREAM_KEY_SECRET overrides the database and is never persisted",
  withCleanState(async () => {
    process.env.STREAM_KEY_SECRET = "env-secret";
    let queried = false;
    const db = {
      query: async () => {
        queried = true;
        return { rows: [] };
      },
    };
    assert.equal(await initStreamSecret(db), "env-secret");
    assert.equal(queried, false);
    assert.equal(streamKeySecret(), "env-secret");
  }),
);

test(
  "keys signed with the generated secret survive an app restart",
  withCleanState(async () => {
    const db = fakeDb();
    await initStreamSecret(db);
    const token = signStreamKey("wayne19980");

    // Fresh process: cache empty, but the database still returns the secret.
    resetStreamSecretCache();
    assert.equal(await initStreamSecret(db), streamKeySecret());
    assert.equal(verifyStreamKey(token).playerId, "wayne19980");
  }),
);