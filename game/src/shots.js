// Sky Courier screenshot scenes: deterministic states the game renders
// for `?shot=<name>&seed=<n>`, so the shipped screenshots are real renders
// of the game's own code, taken the same way every time.
//
//   start  — the start screen, plane parked on the runway at dawn light
//   play   — chase view, flying through ring 3 over the lake
//   chase  — high chase view over the ridge and the valley
//   end    — landed, with the score screen up
//
// A scene sets the plane, the camera and the phase, then the normal
// renderer draws one frame. Nothing here edits the game: it only poses it.

import { RUNWAY, buildCourse, missionById } from './world.js';
import { makePlaneState } from './plane.js';

function placeOnRunway(mission) {
  const p = makePlaneState(RUNWAY.x, 0, RUNWAY.z + 200, 0);
  p.throttle = 0.25;
  p.fuel = mission.fuel;
  return p;
}

export function applyShot(game, name, seed) {
  const mission = game.mission;
  const world = game.world;
  const course = buildCourse(mission, world);
  game.rings = course;
  game.nextRing = 0;
  game.score = 0;
  game.ringScore = 0;
  game.landingScore = 0;
  game.timeBonus = 0;
  game.elapsed = 0;
  game.message = '';
  game.messageUntil = 0;
  game.cameraMode = 'chase';

  if (name === 'start') {
    game.phase = 'menu';
    game.missionIndex = 0;
    game.plane = placeOnRunway(mission);
    game.plane.propAngle = 0.7;
    game.time = 3.2;
    return;
  }

  if (name === 'play') {
    // Mid-flight: passing ring 3 (index 2) over the lake, rings 1-2 done.
    game.phase = 'flying';
    game.rings[0].passed = true;
    game.rings[1].passed = true;
    game.nextRing = 2;
    game.score = 200;
    game.ringScore = 200;
    game.elapsed = 58;
    const ring = game.rings[2];
    const prev = game.rings[1];
    const dx = ring.x - prev.x;
    const dz = ring.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    const heading = Math.atan2(dx / len, -dz / len);
    game.plane = makePlaneState(ring.x - (dx / len) * 46, ring.y - 2, ring.z - (dz / len) * 46, heading);
    game.plane.onGround = false;
    game.plane.speed = 58;
    game.plane.throttle = 0.72;
    game.plane.pitch = 0.04;
    game.plane.roll = -0.08;
    game.plane.fuel = 78;
    game.plane.propAngle = 2.4;
    game.time = 3.2;
    return;
  }

  if (name === 'chase') {
    // High over the ridge, looking down the valley toward the lake.
    game.phase = 'flying';
    game.rings[0].passed = true;
    game.nextRing = 1;
    game.score = 100;
    game.ringScore = 100;
    game.elapsed = 31;
    game.plane = makePlaneState(-350, 235, -650, Math.PI * 0.85);
    game.plane.onGround = false;
    game.plane.speed = 64;
    game.plane.throttle = 0.8;
    game.plane.pitch = -0.06;
    game.plane.roll = 0.18;
    game.plane.fuel = 88;
    game.plane.propAngle = 1.1;
    game.time = 3.2;
    return;
  }

  if (name === 'end') {
    // Landed cleanly on the runway, score screen up, cockpit view off.
    game.phase = 'landed';
    game.rings.forEach((r) => {
      r.passed = true;
    });
    game.nextRing = game.rings.length;
    game.ringScore = game.rings.length * 100;
    game.landingScore = 430;
    game.timeBonus = 96;
    game.score = game.ringScore + game.landingScore + game.timeBonus;
    game.elapsed = 192;
    game.plane = makePlaneState(RUNWAY.x, 0, RUNWAY.z + 60, 0);
    game.plane.speed = 0;
    game.plane.throttle = 0;
    game.plane.fuel = 34;
    game.plane.propAngle = 0.2;
    game.time = 3.2;
    return;
  }

  // Unknown shot name: fall back to the start screen.
  game.phase = 'menu';
  game.plane = placeOnRunway(mission);
  game.time = 3.2;
}

export function missionForShot() {
  return missionById(1);
}
