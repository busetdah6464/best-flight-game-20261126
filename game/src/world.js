// Sky Courier world: the valley, the lake, the ridge, the airfield and
// the ring course. Everything is seeded, so the same seed builds the
// same valley on every machine.

import { CONFIG, MISSIONS, clamp, makeNoise2D, makeRandom } from './config.js';

const HALF = CONFIG.worldSize / 2;

// The airfield sits on a flattened shelf near the south edge.
export const RUNWAY = {
  x: 0,
  z: 1650,
  heading: 0, // runway runs north-south (heading 0 = north, -Z)
  length: 620,
  width: 34,
  y: 0,
};

function runwayDistance(x, z) {
  // Distance from the runway centreline, in metres along and across it.
  const dx = x - RUNWAY.x;
  const dz = z - RUNWAY.z;
  return { along: -dz, across: dx };
}

export function onRunway(x, z) {
  const d = runwayDistance(x, z);
  return Math.abs(d.along) < RUNWAY.length / 2 && Math.abs(d.across) < RUNWAY.width / 2;
}

export function nearRunway(x, z, pad) {
  const d = runwayDistance(x, z);
  return (
    Math.abs(d.along) < RUNWAY.length / 2 + pad && Math.abs(d.across) < RUNWAY.width / 2 + pad
  );
}

// Raw terrain height before the airfield shelf is flattened in.
function rawHeight(noise, x, z) {
  const nx = x / 900;
  const nz = z / 900;
  let h = noise(nx, nz) * 150;
  // A ridge of mountains along the north and east edges.
  const edge = Math.max(0, (-z - 900) / 1400) + Math.max(0, (x - 1100) / 1300);
  h += edge * edge * 260;
  // A broad hill in the west.
  const dw = Math.hypot(x + 1700, z + 300);
  h += Math.max(0, 1 - dw / 900) * 120;
  // The lake basin in the south-east.
  const dl = Math.hypot(x - 1150, z - 900);
  h -= Math.max(0, 1 - dl / 750) * 60;
  return h;
}

export function buildWorld(seed) {
  const noise = makeNoise2D(seed * 7919 + 13);
  const rand = makeRandom(seed * 104729 + 7);

  function heightAt(x, z) {
    let h = rawHeight(noise, x, z);
    // Flatten a shelf around the airfield so the runway sits level.
    const d = Math.hypot(x - RUNWAY.x, z - RUNWAY.z);
    const flat = clamp(1 - (d - 420) / 500, 0, 1);
    h = h * (1 - flat);
    // The lake floor stays low and flat.
    const dl = Math.hypot(x - 1150, z - 900);
    if (dl < 620) h = Math.min(h, -14);
    return h;
  }

  // Terrain mesh: a grid of quads with a height and a colour each.
  const N = CONFIG.gridCells;
  const step = CONFIG.worldSize / N;
  const heights = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      heights[j * (N + 1) + i] = heightAt(-HALF + i * step, -HALF + j * step);
    }
  }

  // Trees: deterministic stands on low, gentle ground away from the runway.
  const trees = [];
  let tries = 0;
  while (trees.length < 340 && tries < 6000) {
    tries++;
    const x = (rand() * 2 - 1) * (HALF - 150);
    const z = (rand() * 2 - 1) * (HALF - 150);
    const h = heightAt(x, z);
    if (h < 6 || h > 90) continue;
    if (nearRunway(x, z, 120)) continue;
    if (Math.hypot(x - 1150, z - 900) < 640) continue;
    trees.push({ x, z, h, s: 7 + rand() * 9, tone: rand() });
  }

  // Clouds: soft billboards drifting high above the valley.
  const clouds = [];
  for (let i = 0; i < 26; i++) {
    clouds.push({
      x: (rand() * 2 - 1) * (HALF - 200),
      z: (rand() * 2 - 1) * (HALF - 200),
      y: 320 + rand() * 160,
      s: 120 + rand() * 220,
      tone: 0.75 + rand() * 0.25,
    });
  }

  // Airfield buildings: two hangars, a control tower and a windsock.
  const buildings = [
    { x: -70, z: 1780, w: 46, d: 30, h: 14, rot: 0, color: '#b8a88a' },
    { x: -70, z: 1840, w: 40, d: 26, h: 12, rot: 0, color: '#9aa5a0' },
    { x: 80, z: 1790, w: 16, d: 16, h: 34, rot: 0, color: '#c9c2b4', tower: true },
  ];

  return {
    seed,
    heightAt,
    heights,
    gridN: N,
    gridStep: step,
    trees,
    clouds,
    buildings,
    lake: { x: 1150, z: 900, r: 600, y: -6 },
  };
}

// The ring course for a mission: a winding path out over the lake, along
// the ridge and home. Rings face along the course so the pilot flies
// through them, not past them.
export function buildCourse(mission, world) {
  const rand = makeRandom(world.seed * 31 + mission.id * 977);
  const count = mission.rings;
  const pts = [];
  // Waypoints: out to the lake, along the ridge, back over the valley.
  const path = [
    { x: 300, z: 1200 },
    { x: 900, z: 700 },
    { x: 1150, z: 100 },
    { x: 700, z: -600 },
    { x: -100, z: -1000 },
    { x: -900, z: -700 },
    { x: -1200, z: 200 },
    { x: -700, z: 1000 },
    { x: -300, z: 1450 },
    { x: 0, z: 1650 },
  ];
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count;
    const fi = t * (path.length - 1);
    const a = path[Math.floor(fi)];
    const b = path[Math.min(path.length - 1, Math.ceil(fi))];
    const f = fi - Math.floor(fi);
    const x = a.x + (b.x - a.x) * f + (rand() * 2 - 1) * 60;
    const z = a.z + (b.z - a.z) * f + (rand() * 2 - 1) * 60;
    const ground = world.heightAt(x, z);
    const y = Math.max(ground + 28, mission.ringAlt + rand() * 30);
    pts.push({ x, y, z });
  }
  // Each ring faces the next point on the course (the last faces home).
  const rings = pts.map((p, i) => {
    const next = i + 1 < pts.length ? pts[i + 1] : { x: RUNWAY.x, y: 40, z: RUNWAY.z };
    const dx = next.x - p.x;
    const dz = next.z - p.z;
    const dy = next.y - p.y;
    const len = Math.hypot(dx, dy, dz) || 1;
    return {
      x: p.x,
      y: p.y,
      z: p.z,
      nx: dx / len,
      ny: dy / len,
      nz: dz / len,
      r: 16,
      index: i,
      passed: false,
    };
  });
  return rings;
}

export function missionById(id) {
  return MISSIONS.find((m) => m.id === id) || MISSIONS[0];
}
