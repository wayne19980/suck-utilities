// Reusable Glicko-2 core. The ladder and the read-only rating lab share this
// implementation so parameter experiments cannot drift from production math.
export const GLICKO_SCALE = 173.7178;
export const GLICKO_TAU = 0.5;
export const INITIAL_RD = 350;
export const INITIAL_VOLATILITY = 0.06;
export const MAX_RD = 350;
export const MIN_RD = 30;

function glickoG(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function glickoE(mu, opponentMu, opponentPhi) {
  return 1 / (1 + Math.exp(-glickoG(opponentPhi) * (mu - opponentMu)));
}

function glickoVolatility(phi, sigma, v, delta) {
  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    return (
      (ex * (delta * delta - phi * phi - v - ex)) /
        (2 * (phi * phi + v + ex) ** 2) -
      (x - a) / (GLICKO_TAU * GLICKO_TAU)
    );
  };
  let A = a;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * GLICKO_TAU) < 0) k += 1;
    B = a - k * GLICKO_TAU;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > 0.000001) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

/** One Glicko-2 update for `state` against `opponent`; `score` is 1/0. */
export function glickoUpdate(state, opponent, score) {
  const mu = (state.rating - 1500) / GLICKO_SCALE;
  const phi = state.rd / GLICKO_SCALE;
  const opponentMu = (opponent.rating - 1500) / GLICKO_SCALE;
  const opponentPhi = opponent.rd / GLICKO_SCALE;
  const g = glickoG(opponentPhi);
  const e = Math.min(1 - 1e-9, Math.max(1e-9, glickoE(mu, opponentMu, opponentPhi)));
  const v = 1 / (g * g * e * (1 - e));
  const deltaSum = g * (score - e);
  const delta = v * deltaSum;
  const sigmaPrime = glickoVolatility(phi, state.volatility, v, delta);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const rating = 1500 + GLICKO_SCALE * (mu + phiPrime * phiPrime * deltaSum);
  return {
    rating,
    rd: Math.max(MIN_RD, GLICKO_SCALE * phiPrime),
    volatility: sigmaPrime
  };
}

function timestampOf(value) {
  if (!value) return 0;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Inflate RD for the gap since the state's last game. */
export function inflateRd(
  state,
  playedAtMs,
  { periodDays = 1, maxRd = MAX_RD } = {}
) {
  const last = timestampOf(state.last_game_at);
  if (!last || !playedAtMs || playedAtMs <= last) return;
  const periods = (playedAtMs - last) / 86400000 / periodDays;
  if (!(periods > 0)) return;
  const variance =
    state.rd * state.rd +
    (GLICKO_SCALE * state.volatility) ** 2 * periods;
  state.rd = Math.min(maxRd, Math.sqrt(variance));
}

export function initialGlickoState(overrides = {}) {
  return {
    rating: 3000,
    rd: INITIAL_RD,
    volatility: INITIAL_VOLATILITY,
    last_game_at: null,
    ...overrides
  };
}
