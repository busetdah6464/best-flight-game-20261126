// Sky Courier aircraft: a low-poly courier prop plane, built from boxes
// and prisms, plus the flight physics that make it feel like a plane.

import { CONFIG, clamp } from './config.js';
import { onRunway } from './world.js';

// The plane mesh, in local space: +Z is forward (nose), +Y is up, +X is
// the right wing. Each face is a quad or triangle with a colour.
function box(cx, cy, cz, sx, sy, sz, color, dark) {
  const x0 = cx - sx / 2;
  const x1 = cx + sx / 2;
  const y0 = cy - sy / 2;
  const y1 = cy + sy / 2;
  const z0 = cz - sz / 2;
  const z1 = cz + sz / 2;
  const v = {
    a: { x: x0, y: y0, z: z0 },
    b: { x: x1, y: y0, z: z0 },
    c: { x: x1, y: y1, z: z0 },
    d: { x: x0, y: y1, z: z0 },
    e: { x: x0, y: y0, z: z1 },
    f: { x: x1, y: y0, z: z1 },
    g: { x: x1, y: y1, z: z1 },
    h: { x: x0, y: y1, z: z1 },
  };
  return [
    { p: [v.e, v.f, v.g, v.h], color }, // nose (+Z)
    { p: [v.b, v.a, v.d, v.c], color: dark || color }, // tail (-Z)
    { p: [v.a, v.e, v.h, v.d], color: dark || color }, // left
    { p: [v.f, v.b, v.c, v.g], color }, // right
    { p: [v.d, v.h, v.g, v.c], color }, // top
    { p: [v.a, v.b, v.f, v.e], color: dark || color }, // bottom
  ];
}

function prism(cx, cy, cz, sx, sy, sz, color) {
  // A tapered nose: a box whose front face is a single ridge point.
  const x0 = cx - sx / 2;
  const x1 = cx + sx / 2;
  const y0 = cy - sy / 2;
  const y1 = cy + sy / 2;
  const z0 = cz - sz / 2;
  const z1 = cz + sz / 2;
  const tip = { x: cx, y: cy, z: z1 + sz * 0.35 };
  return [
    { p: [{ x: x0, y: y0, z: z1 }, { x: x1, y: y0, z: z1 }, tip], color },
    { p: [{ x: x1, y: y1, z: z1 }, { x: x0, y: y1, z: z1 }, tip], color },
    { p: [{ x: x0, y: y0, z: z0 }, { x: x0, y: y0, z: z1 }, tip], color },
    { p: [{ x: x1, y: y0, z: z1 }, { x: x1, y: y0, z: z0 }, tip], color },
    { p: [{ x: x0, y: y1, z: z1 }, { x: x0, y: y1, z: z0 }, tip], color },
    { p: [{ x: x1, y: y1, z: z0 }, { x: x1, y: y1, z: z1 }, tip], color },
  ];
}

export function buildPlaneMesh() {
  const orange = '#e86a1e';
  const cream = '#f4ead8';
  const dark = '#8a3c10';
  const glass = '#9fd8e8';
  const metal = '#5b6670';
  const faces = [];
  // Fuselage: tapered nose, cabin, tail cone.
  faces.push(...prism(0, 0.35, 2.6, 1.5, 1.3, 1.6, orange));
  faces.push(...box(0, 0.3, 0.6, 1.5, 1.4, 3.6, cream, '#d8cbb2'));
  faces.push(...box(0, 0.45, -1.9, 0.9, 0.9, 2.4, orange, dark));
  // Canopy glass.
  faces.push(...box(0, 1.05, 1.1, 1.0, 0.55, 1.5, glass, '#6fb3c6'));
  // Main wing (low wing) with orange tips.
  faces.push(...box(0, -0.15, 0.7, 9.4, 0.22, 1.5, cream, '#d8cbb2'));
  faces.push(...box(-4.35, -0.15, 0.7, 0.9, 0.24, 1.5, orange));
  faces.push(...box(4.35, -0.15, 0.7, 0.9, 0.24, 1.5, orange));
  // Tailplane and fin.
  faces.push(...box(0, 0.55, -2.9, 3.4, 0.18, 1.0, cream, '#d8cbb2'));
  faces.push(...box(0, 1.15, -2.9, 0.18, 1.4, 1.1, orange));
  // Propeller spinner + blades (blades spin in the renderer).
  faces.push(...box(0, 0.35, 4.35, 0.5, 0.5, 0.5, metal));
  // Landing gear: two wheels and a tail wheel.
  faces.push(...box(-0.7, -0.85, 1.2, 0.16, 0.7, 0.16, metal));
  faces.push(...box(0.7, -0.85, 1.2, 0.16, 0.7, 0.16, metal));
  faces.push(...box(-0.7, -1.15, 1.2, 0.42, 0.42, 0.3, '#22262a'));
  faces.push(...box(0.7, -1.15, 1.2, 0.42, 0.42, 0.3, '#22262a'));
  // Registration stripe on the tail.
  faces.push(...box(0, 0.85, -3.05, 0.95, 0.3, 0.06, cream));
  return faces;
}

// The propeller as two thin blades; the renderer spins it around Z.
// Each blade is a tapered quad from the hub to the tip, lying in the
// prop disc plane (facing forward, +Z).
export function propellerBlades(angle) {
  const blades = [];
  for (let k = 0; k < 2; k++) {
    const a = angle + k * Math.PI;
    const dx = -Math.sin(a);
    const dy = Math.cos(a);
    // Perpendicular in the disc plane, for the blade's width.
    const px = -dy;
    const py = dx;
    const w0 = 0.16; // half-width at the hub
    const w1 = 0.10; // half-width at the tip
    const r0 = 0.25; // blade starts just outside the spinner
    const r1 = 2.1; // tip radius
    const hub = { x: 0, y: 0.35, z: 4.5 };
    const b0 = { x: hub.x + dx * r0 + px * w0, y: hub.y + dy * r0 + py * w0, z: 4.5 };
    const b1 = { x: hub.x + dx * r0 - px * w0, y: hub.y + dy * r0 - py * w0, z: 4.5 };
    const t0 = { x: hub.x + dx * r1 + px * w1, y: hub.y + dy * r1 + py * w1, z: 4.5 };
    const t1 = { x: hub.x + dx * r1 - px * w1, y: hub.y + dy * r1 - py * w1, z: 4.5 };
    blades.push({ p: [b0, b1, t1], color: '#22262a' });
    blades.push({ p: [b0, t1, t0], color: '#22262a' });
  }
  return blades;
}

// Flight state: position, attitude, speed, throttle, fuel.
export function makePlaneState(startX, startY, startZ, heading) {
  return {
    x: startX,
    y: startY,
    z: startZ,
    heading, // yaw, 0 = north (-Z)
    pitch: 0,
    roll: 0,
    speed: 0,
    throttle: 0,
    fuel: CONFIG.fuelCapacity,
    onGround: true,
    gearDown: true,
    propAngle: 0,
    verticalSpeed: 0,
    stalled: false,
    damage: 0,
  };
}

// The aircraft's basis vectors, from heading (a compass bearing: 0 is
// north, -Z; 90 is east, +X), pitch (positive climbs) and roll (positive
// banks right). Every consumer — physics, camera, mesh and HUD — uses
// these, so the plane always flies where it points.
export function planeBasis(p) {
  const ch = Math.cos(p.heading);
  const sh = Math.sin(p.heading);
  const cp = Math.cos(p.pitch);
  const sp = Math.sin(p.pitch);
  const cr = Math.cos(p.roll);
  const sr = Math.sin(p.roll);
  const forward = { x: sh * cp, y: sp, z: -ch * cp };
  const right = { x: ch, y: 0, z: sh };
  // Up pitched with the nose, then rolled toward the low wing.
  const upPitch = { x: sh * sp, y: cp, z: -ch * sp };
  const up = {
    x: cr * upPitch.x + sr * right.x,
    y: cr * upPitch.y + sr * right.y,
    z: cr * upPitch.z + sr * right.z,
  };
  return { forward, right, up };
}

export function planeForward(p) {
  return planeBasis(p).forward;
}

export function planeUp(p) {
  return planeBasis(p).up;
}

// One physics step. `input` holds pitch/roll/yaw in -1..1, throttle in
// 0..1 and a wind vector. Returns events: 'takeoff' | 'stall' | 'landed'
// | 'crashed' | 'fuel-empty' | null.
export function stepPlane(p, input, dt, world, wind) {
  const events = [];
  p.throttle = clamp(input.throttle, 0, 1);

  // Fuel burns with throttle; an empty tank means no thrust.
  if (p.fuel > 0) {
    p.fuel = Math.max(0, p.fuel - CONFIG.fuelBurn * p.throttle * dt);
    if (p.fuel <= 0) events.push('fuel-empty');
  }
  const thrust = p.fuel > 0 ? p.throttle : 0;

  // Attitude follows the controls, eased toward the target.
  const pitchTarget = clamp(input.pitch * CONFIG.maxPitch, -CONFIG.maxPitch, CONFIG.maxPitch);
  const rollTarget = clamp(input.roll * CONFIG.maxRoll, -CONFIG.maxRoll, CONFIG.maxRoll);
  const ease = 1 - Math.exp(-dt * 3.2);
  p.pitch += (pitchTarget - p.pitch) * ease;
  p.roll += (rollTarget - p.roll) * ease;
  p.heading += input.yaw * CONFIG.yawRate * dt;
  // Banking turns the plane: a right bank turns the bearing clockwise.
  p.heading += Math.sin(p.roll) * CONFIG.turnFactor * clamp(p.speed / 40, 0, 1.4) * dt;

  const fwd = planeForward(p);
  const flying = !p.onGround;

  if (p.onGround) {
    // Rolling on the runway: thrust accelerates, drag holds back.
    p.speed += (thrust * CONFIG.accel - CONFIG.dragBase * p.speed * p.speed * 0.4) * dt;
    if (p.speed < 0) p.speed = 0;
    p.x += Math.sin(p.heading) * p.speed * dt;
    p.z += -Math.cos(p.heading) * p.speed * dt;
    p.y = world.heightAt(p.x, p.z) + 1.35;
    p.pitch = 0;
    p.roll *= 1 - Math.min(1, dt * 4);
    if (p.speed >= CONFIG.takeoffSpeed && p.pitch >= -0.05 && thrust > 0.55) {
      p.onGround = false;
      events.push('takeoff');
    }
  } else {
    // In the air: thrust, drag, lift and gravity.
    const drag = CONFIG.dragBase + CONFIG.dragInduced * Math.abs(Math.sin(p.roll)) * 0.6;
    p.speed += (thrust * 9.5 - drag * p.speed * p.speed * 0.28 - Math.sin(p.pitch) * CONFIG.gravity * 0.55) * dt;
    if (p.speed < 0) p.speed = 0;
    const liftFactor = clamp(p.speed / CONFIG.minFlySpeed, 0, 1);
    p.stalled = p.speed < CONFIG.stallSpeed;
    // Climb from pitch and lift; sink when slow or stalled. A trimmed
    // wing holds a gentle climb hands-off, so a level plane does not skim
    // the runway forever after rotating.
    let climb = Math.sin(p.pitch) * p.speed * liftFactor + 0.8 * liftFactor;
    climb -= (1 - liftFactor) * 7 * dt * 10 * 0.1;
    if (p.stalled) climb -= 6;
    p.verticalSpeed = climb;
    p.x += fwd.x * p.speed * dt + wind.x * dt;
    p.z += fwd.z * p.speed * dt + wind.z * dt;
    p.y += climb * dt;
    p.propAngle += (2 + p.throttle * 40) * dt;

    const ground = world.heightAt(p.x, p.z);
    if (p.y <= ground + 1.35 && p.verticalSpeed < 0.5) {
      // Touching down: a gentle, level, slow touchdown on the runway is a
      // landing; anything else is a crash.
      const vs = Math.abs(p.verticalSpeed);
      const level = Math.abs(p.roll) < 0.22 && Math.abs(p.pitch) < 0.18;
      if (onRunway(p.x, p.z) && vs < 4.5 && p.speed < 62 && level) {
        p.onGround = true;
        p.y = ground + 1.35;
        events.push('landed');
      } else {
        p.damage = 100;
        events.push('crashed');
      }
    } else if (p.y <= ground + 0.5) {
      // Climbing, but the hillside rose faster than the wing: terrain hit.
      p.damage = 100;
      events.push('crashed');
    }
    // Flying out of the valley ends the sortie the same way a crash does.
    if (Math.abs(p.x) > 2600 || Math.abs(p.z) > 2600 || p.y > 900) {
      p.damage = 100;
      events.push('crashed');
    }
  }
  return events;
}
