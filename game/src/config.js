// Sky Courier tuning, missions and seeded random.
// Every number here is a design choice for how the plane should feel:
// lift that needs speed, a stall you can feel, drag that punishes hard
// manoeuvres, and wind that keeps a sortie honest.

export const CONFIG = {
  worldSize: 4800, // metres, terrain spans -2400..2400 on x and z
  gridCells: 88, // terrain mesh resolution per side
  gravity: 9.81,
  // Flight model
  minFlySpeed: 26, // m/s: below this the wing stops flying and the nose drops
  stallSpeed: 30, // m/s: stall warning starts here
  maxSpeed: 95, // m/s at full throttle, level flight
  takeoffSpeed: 30, // m/s: rotation speed on the runway
  accel: 14, // m/s^2 at full throttle on the ground
  dragBase: 0.012,
  dragInduced: 0.05, // extra drag while banked hard
  pitchRate: 0.85, // rad/s at full elevator
  rollRate: 1.9, // rad/s at full aileron
  yawRate: 0.35, // rad/s at full rudder
  turnFactor: 0.55, // how much bank turns the heading
  maxPitch: 0.62,
  maxRoll: 1.15,
  fuelBurn: 0.55, // fuel units per second at full throttle
  fuelCapacity: 100,
  // Scoring
  ringPoints: 100,
  landingMax: 500,
  timeBonusRate: 2, // points per second under par time
  // Camera
  chaseDistance: 16,
  chaseHeight: 5,
};

// Missions: same valley, different ring courses, weather and fuel.
export const MISSIONS = [
  {
    id: 1,
    name: 'Valley Ring Run',
    blurb: 'Eight rings low over the valley and the lake. A gentle first sortie.',
    rings: 8,
    fuel: 100,
    parTime: 240,
    wind: 1.5,
    dusk: false,
    ringAlt: 55,
  },
  {
    id: 2,
    name: 'Ridge Delivery',
    blurb: 'Ten rings, higher and tighter, over the mountain ridge. Watch the rocks.',
    rings: 10,
    fuel: 100,
    parTime: 300,
    wind: 3.0,
    dusk: false,
    ringAlt: 95,
  },
  {
    id: 3,
    name: 'Storm Dusk',
    blurb: 'Eight rings at dusk in a crosswind, on a short tank. For steady hands.',
    rings: 8,
    fuel: 70,
    parTime: 240,
    wind: 5.5,
    dusk: true,
    ringAlt: 70,
  },
];

// Small deterministic PRNG (mulberry32) so the world, the ring course and
// the screenshots are the same on every run with the same seed.
export function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth value noise in 2D, built from the seeded random above.
export function makeNoise2D(seed) {
  const rand = makeRandom(seed);
  const size = 256;
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = rand() * 2 - 1;
  const at = (x, y) => grid[((y & 255) << 8) | (x & 255)];
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = smooth(x - xi);
    const yf = smooth(y - yi);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  }
  // Fractal sum: broad hills plus finer detail.
  return function fbm(x, y) {
    return (
      noise(x, y) * 0.55 +
      noise(x * 2.13 + 7.3, y * 2.13 + 3.1) * 0.28 +
      noise(x * 4.31 + 13.7, y * 4.31 + 9.4) * 0.17
    );
  };
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function deg(rad) {
  return (rad * 180) / Math.PI;
}

export function headingLabel(rad) {
  const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  let h = deg(rad) % 360;
  if (h < 0) h += 360;
  return points[Math.round(h / 22.5) % 16];
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
