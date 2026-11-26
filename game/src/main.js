// Sky Courier: the game loop, the states (menu, flying, landed,
// crashed), the scoring, the missions and the self-test the screenshots
// and the smoke test run on. One module owns the whole game state; the
// renderer only draws it.

import { CONFIG, MISSIONS, clamp } from './config.js';
import { RUNWAY, buildCourse, buildWorld, missionById } from './world.js';
import { makePlaneState, stepPlane } from './plane.js';
import { render } from './render.js';
import { makeInput } from './input.js';
import { makeAudio } from './audio.js';
import { applyShot } from './shots.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status');

const params = new URLSearchParams(window.location.search);
const SEED = Number(params.get('seed') || 1) || 1;
const SHOT = params.get('shot') || '';
const SELFTEST = params.get('selftest') === '1';

const game = {
  world: buildWorld(SEED),
  missions: MISSIONS,
  missionIndex: 0,
  mission: MISSIONS[0],
  rings: [],
  nextRing: 0,
  plane: null,
  phase: 'menu', // menu | flying | landed | crashed
  cameraMode: 'chase', // chase | cockpit
  score: 0,
  ringScore: 0,
  landingScore: 0,
  timeBonus: 0,
  elapsed: 0,
  time: 0,
  message: '',
  messageUntil: 0,
  crashReason: '',
  muted: false,
  wind: { x: 0, z: 0 },
};

const input = makeInput(canvas);
const audio = makeAudio();

function say(msg, seconds) {
  game.message = msg;
  game.messageUntil = game.time + (seconds || 3);
  if (statusEl) statusEl.textContent = msg;
}

function resetFlight() {
  const mission = game.mission;
  game.rings = buildCourse(mission, game.world);
  game.nextRing = 0;
  game.score = 0;
  game.ringScore = 0;
  game.landingScore = 0;
  game.timeBonus = 0;
  game.elapsed = 0;
  game.crashReason = '';
  // Parked at the south end of the runway, facing north.
  game.plane = makePlaneState(RUNWAY.x, 0, RUNWAY.z + RUNWAY.length / 2 - 40, 0);
  game.plane.fuel = mission.fuel;
  // Wind: a steady crosswind from the west, scaled by the mission.
  game.wind = { x: mission.wind, z: mission.wind * 0.4 };
  game.phase = 'flying';
  say(`Mission: ${mission.name} — full throttle, rotate at 30 m/s`, 4);
}

function startMission(index) {
  game.missionIndex = index;
  game.mission = MISSIONS[index];
  resetFlight();
}

function finishLanding() {
  const p = game.plane;
  const vs = Math.abs(p.verticalSpeed);
  const smooth = clamp(1 - vs / 4.5, 0, 1);
  const centred = clamp(1 - Math.abs(p.x - RUNWAY.x) / (RUNWAY.width / 2), 0, 1);
  const slow = clamp(1 - Math.max(0, p.speed - 30) / 32, 0, 1);
  game.landingScore = Math.round(CONFIG.landingMax * (0.4 + 0.3 * smooth + 0.2 * centred + 0.1 * slow));
  const par = game.mission.parTime;
  game.timeBonus = Math.max(0, Math.round((par - game.elapsed) * CONFIG.timeBonusRate));
  game.score = game.ringScore + game.landingScore + game.timeBonus;
  game.phase = 'landed';
  audio.land();
  say('Landed! Nice flying, courier.', 4);
}

function finishCrash(reason) {
  game.crashReason = reason;
  game.phase = 'crashed';
  audio.crash();
  say(reason, 5);
}

function checkRings() {
  const next = game.rings[game.nextRing];
  if (!next) return;
  const p = game.plane;
  // Distance from the plane to the ring's plane, along its normal.
  const dx = p.x - next.x;
  const dy = p.y - next.y;
  const dz = p.z - next.z;
  const along = dx * next.nx + dy * next.ny + dz * next.nz;
  if (Math.abs(along) > 6) return;
  // Radial distance from the ring centre.
  const radial = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - along * along));
  if (radial < next.r) {
    next.passed = true;
    game.nextRing += 1;
    game.ringScore += CONFIG.ringPoints;
    game.score += CONFIG.ringPoints;
    audio.ring();
    if (game.nextRing >= game.rings.length) {
      say('All rings flown! Bring her home to the runway.', 4);
    } else {
      say(`Ring ${game.nextRing} of ${game.rings.length} — nice flying!`, 2.5);
    }
  }
}

function update(dt) {
  game.time += dt;
  const p = game.plane;
  if (!p) return;

  if (input.wasPressed('KeyM')) {
    game.muted = audio.toggleMute();
    say(game.muted ? 'Sound off' : 'Sound on', 1.5);
  }
  if (input.wasPressed('KeyC') && game.phase !== 'menu') {
    game.cameraMode = game.cameraMode === 'chase' ? 'cockpit' : 'chase';
  }

  if (game.phase === 'menu') {
    if (input.wasPressed('Digit1')) game.missionIndex = 0;
    if (input.wasPressed('Digit2')) game.missionIndex = 1;
    if (input.wasPressed('Digit3')) game.missionIndex = 2;
    if (input.wasPressed('Enter')) {
      audio.unlock();
      audio.click();
      startMission(game.missionIndex);
    }
    // The parked plane idles on the runway behind the menu.
    p.propAngle += dt * 2;
    return;
  }

  if (game.phase === 'landed' || game.phase === 'crashed') {
    if (input.wasPressed('Enter')) {
      audio.click();
      startMission(game.missionIndex);
    }
    if (input.wasPressed('Digit1')) startMission(0);
    if (input.wasPressed('Digit2')) startMission(1);
    if (input.wasPressed('Digit3')) startMission(2);
    p.propAngle += dt * (p.speed > 0 ? 4 : 0.5);
    return;
  }

  // Flying.
  game.elapsed += dt;
  const controls = input.controls();
  p.throttle = input.throttleDelta(dt, p.throttle);
  const events = stepPlane(
    p,
    { pitch: controls.pitch, roll: controls.roll, yaw: controls.yaw, throttle: p.throttle },
    dt,
    game.world,
    game.wind,
  );
  for (const ev of events) {
    if (ev === 'takeoff') {
      say('Airborne! Climb out and find ring 1.', 3);
    } else if (ev === 'fuel-empty') {
      say('Fuel empty — glide to the runway!', 4);
    } else if (ev === 'landed') {
      finishLanding();
    } else if (ev === 'crashed') {
      const ground = game.world.heightAt(p.x, p.z);
      const reason =
        p.y <= ground + 2
          ? 'You hit the ground. The courier walks home.'
          : 'You flew out of the valley. The courier walks home.';
      finishCrash(reason);
    }
  }
  if (game.phase === 'flying') {
    checkRings();
    audio.update(p.throttle, p.speed, !p.onGround);
  }
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

let view = resize();
window.addEventListener('resize', () => {
  view = resize();
});

function frame(now) {
  const dt = Math.min(0.05, (now - lastNow) / 1000 || 0.016);
  lastNow = now;
  update(dt);
  render(ctx, game, view.w, view.h);
  input.clearPressed();
  requestAnimationFrame(frame);
}

let lastNow = performance.now();

// --- Self-test --------------------------------------------------------------
// ?selftest=1 flies the plane by script: full throttle, rotate, climb,
// steer to ring 1 and report. The screenshot driver reads the result from
// window.__selftest and from the page title.
const selftest = {
  active: SELFTEST,
  stage: 'takeoff',
  t: 0,
  log: [],
  done: false,
  result: null,
};
window.__selftest = selftest;
// A debug handle for the screenshot driver: the game's live state.
window.__game = game;

function selftestStep(dt) {
  if (selftest.done) return;
  selftest.t += dt;
  const p = game.plane;
  const ring = game.rings[game.nextRing];
  if (game.phase === 'menu') {
    startMission(0);
    selftest.log.push('started mission 1');
  }
  if (game.phase === 'crashed' || game.phase === 'landed') {
    selftest.done = true;
    selftest.result = { ok: false, stage: selftest.stage, phase: game.phase, log: selftest.log };
    document.title = 'SELFTEST FAIL ' + game.phase;
    return;
  }
  // Scripted pilot: full throttle on the ground, pitch up at speed, then
  // steer toward the next ring with simple proportional control.
  p.throttle = 1;
  const keys = { pitch: 0, roll: 0, yaw: 0, throttle: 1 };
  if (!p.onGround && ring) {
    const dx = ring.x - p.x;
    const dz = ring.z - p.z;
    const wantHeading = Math.atan2(dx, -dz);
    let dh = wantHeading - p.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    keys.roll = clamp(dh * 1.2, -1, 1);
    const wantAlt = ring.y;
    keys.pitch = clamp((wantAlt - p.y) * 0.02 + 0.08, -1, 1);
  } else if (!p.onGround) {
    keys.pitch = 0.1;
  } else if (p.speed > 26) {
    keys.pitch = 0.5;
  }
  const events = stepPlane(p, keys, dt, game.world, game.wind);
  for (const ev of events) {
    selftest.log.push(ev + ' t=' + selftest.t.toFixed(1) + ' speed=' + p.speed.toFixed(1));
    if (ev === 'takeoff') selftest.stage = 'climb';
  }
  checkRings();
  game.elapsed += dt;
  game.time += dt;
  if (game.nextRing >= 1) {
    selftest.done = true;
    selftest.result = {
      ok: true,
      stage: 'ring-1-passed',
      rings: game.nextRing,
      speed: Math.round(p.speed),
      alt: Math.round(p.y),
      t: Math.round(selftest.t),
      log: selftest.log,
    };
    document.title = 'SELFTEST PASS ring 1 at t=' + Math.round(selftest.t) + 's';
  }
  if (selftest.t > 120 && !selftest.done) {
    selftest.done = true;
    selftest.result = { ok: false, stage: selftest.stage, timeout: true, log: selftest.log };
    document.title = 'SELFTEST FAIL timeout';
  }
}

function selftestFrame(now) {
  const dt = Math.min(0.05, (now - lastNow) / 1000 || 0.016);
  lastNow = now;
  selftestStep(dt);
  render(ctx, game, view.w, view.h);
  if (!selftest.done) requestAnimationFrame(selftestFrame);
}

// --- Boot -------------------------------------------------------------------

game.plane = makePlaneState(RUNWAY.x, 0, RUNWAY.z + RUNWAY.length / 2 - 40, 0);
game.plane.fuel = game.mission.fuel;
game.rings = buildCourse(game.mission, game.world);

if (SHOT) {
  applyShot(game, SHOT, SEED);
  document.title = 'SHOT ' + SHOT;
  render(ctx, game, view.w, view.h);
  // One more frame after fonts settle, for the screenshot driver.
  requestAnimationFrame(() => render(ctx, game, view.w, view.h));
} else if (SELFTEST) {
  requestAnimationFrame(selftestFrame);
} else {
  requestAnimationFrame(frame);
}
