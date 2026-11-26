// Sky Courier renderer: a software 3D engine on a 2D canvas. The scene
// is collected as triangles, sorted far-to-near (painter's algorithm) and
// filled with flat sun shading. The HUD, the cockpit instruments and the
// minimap are drawn on top, so every screenshot shows the whole game.

import { CONFIG, clamp, deg, formatTime, headingLabel } from './config.js';
import {
  add,
  cross,
  dot,
  length,
  makeCamera,
  normalize,
  project,
  scale,
  sub,
  vec3,
} from './math3d.js';
import { RUNWAY, onRunway } from './world.js';
import { buildPlaneMesh, planeBasis, propellerBlades } from './plane.js';

const SUN = normalize({ x: -0.45, y: 0.72, z: -0.55 });
const PLANE_FACES = buildPlaneMesh();

function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * factor), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * factor), 0, 255);
  const b = clamp(Math.round((n & 255) * factor), 0, 255);
  return `rgb(${r},${g},${b})`;
}

function terrainColor(h, slope, hash, lakeDist, lakeR) {
  const v = (hash % 100) / 100;
  let base;
  if (h < -8) base = lakeDist < lakeR + 130 ? '#bfae7e' : '#4a6b35'; // sand only at the shore
  else if (h < 10) base = v < 0.5 ? '#5f8f3e' : '#6da047'; // valley grass
  else if (h < 60) base = v < 0.5 ? '#4e7f36' : '#578c3d'; // meadow
  else if (h < 140) base = v < 0.5 ? '#3f6d2e' : '#4a7a34'; // forest floor
  else if (h < 230) base = '#7d7468'; // rock
  else base = '#e9eff3'; // snow
  if (slope > 0.55 && h > 60) base = '#6f675e';
  return base;
}

function hash2(x, z) {
  let h = (x * 374761393 + z * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  return Math.abs(h) % 1000;
}

// Collect one triangle into the draw list with its camera depth. The
// triangle is clipped against the camera's near plane first, so geometry
// that runs past the camera still fills the bottom of the frame instead
// of vanishing and leaving sky behind it.
const NEAR = 1.0;

function cameraSpace(cam, p) {
  const d = sub(p, cam.eye);
  return { x: dot(d, cam.right), y: dot(d, cam.up), z: dot(d, cam.forward) };
}

function pushTri(list, cam, a, b, c, color) {
  const cs = [cameraSpace(cam, a), cameraSpace(cam, b), cameraSpace(cam, c)];
  // Sutherland–Hodgman clip against z >= NEAR.
  let poly = cs;
  for (let e = 0; e < 3; e++) {
    const next = [];
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i];
      const prv = poly[(i + poly.length - 1) % poly.length];
      const curIn = cur.z >= NEAR;
      const prvIn = prv.z >= NEAR;
      if (curIn) {
        if (!prvIn) {
          const t = (NEAR - prv.z) / (cur.z - prv.z);
          next.push({
            x: prv.x + (cur.x - prv.x) * t,
            y: prv.y + (cur.y - prv.y) * t,
            z: NEAR,
          });
        }
        next.push(cur);
      } else if (prvIn) {
        const t = (NEAR - prv.z) / (cur.z - prv.z);
        next.push({
          x: prv.x + (cur.x - prv.x) * t,
          y: prv.y + (cur.y - prv.y) * t,
          z: NEAR,
        });
      }
    }
    poly = next;
    if (poly.length === 0) return;
  }
  const pts = poly.map((v) => ({
    x: cam.cx + (v.x * cam.focal) / v.z,
    y: cam.cy - (v.y * cam.focal) / v.z,
    depth: v.z,
  }));
  const depth = pts.reduce((s, p) => s + p.depth, 0) / pts.length;
  // Flat shading from the sun.
  const n = normalize(cross(sub(b, a), sub(c, a)));
  const light = 0.68 + 0.32 * Math.max(0, dot(n, SUN));
  const shaded = shade(color, light);
  for (let i = 1; i < pts.length - 1; i++) {
    list.push({ pa: pts[0], pb: pts[i], pc: pts[i + 1], color: shaded, depth });
  }
}

function pushQuad(list, cam, a, b, c, d, color) {
  pushTri(list, cam, a, b, c, color);
  pushTri(list, cam, a, c, d, color);
}

function boxFaces(cx, cy, cz, sx, sy, sz, color, dark) {
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
    { p: [v.e, v.f, v.g, v.h], color },
    { p: [v.b, v.a, v.d, v.c], color: dark || color },
    { p: [v.a, v.e, v.h, v.d], color: dark || color },
    { p: [v.f, v.b, v.c, v.g], color },
    { p: [v.d, v.h, v.g, v.c], color },
    { p: [v.a, v.b, v.f, v.e], color: dark || color },
  ];
}

// --- Scene ----------------------------------------------------------------

function drawSky(ctx, w, h, dusk) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  if (dusk) {
    g.addColorStop(0, '#2c3a5e');
    g.addColorStop(0.45, '#7a5a6e');
    g.addColorStop(0.7, '#e08a4e');
    g.addColorStop(1, '#3a2f33');
  } else {
    g.addColorStop(0, '#2f6fb4');
    g.addColorStop(0.45, '#7db3dd');
    g.addColorStop(0.75, '#cfe8f5');
    g.addColorStop(1, '#e8f2f7');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawSun(ctx, cam, w, h, dusk) {
  const sunDir = SUN;
  const target = add(cam.eye, scale(sunDir, 900));
  const s = project(cam, target);
  if (!s) return;
  const r = dusk ? 46 : 34;
  const glow = ctx.createRadialGradient(s.x, s.y, 4, s.x, s.y, r * 4);
  glow.addColorStop(0, dusk ? 'rgba(255,190,90,0.9)' : 'rgba(255,244,190,0.9)');
  glow.addColorStop(1, 'rgba(255,244,190,0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(s.x, s.y, r * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = dusk ? '#ffb45e' : '#fff3b0';
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawClouds(ctx, cam, world) {
  for (const c of world.clouds) {
    const s = project(cam, vec3(c.x, c.y, c.z));
    if (!s || s.depth > 3000) continue;
    const r = (c.s * cam.focal) / s.depth;
    if (r < 6) continue;
    ctx.fillStyle = `rgba(255,255,255,${0.5 * c.tone})`;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r, r * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s.x - r * 0.45, s.y + r * 0.08, r * 0.6, r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(s.x + r * 0.5, s.y + r * 0.06, r * 0.55, r * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTerrain(list, cam, world) {
  const N = world.gridN;
  const step = world.gridStep;
  const half = CONFIG.worldSize / 2;
  const eye = cam.eye;
  for (let j = 0; j < N; j++) {
    const z0 = -half + j * step;
    const z1 = z0 + step;
    for (let i = 0; i < N; i++) {
      const x0 = -half + i * step;
      const x1 = x0 + step;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const dx = cx - eye.x;
      const dz = cz - eye.z;
      const dist2 = dx * dx + dz * dz;
      if (dist2 > 2600 * 2600) continue;
      // Only cells roughly in front of the camera.
      if (dot({ x: dx, y: 0, z: dz }, cam.forward) < -120) continue;
      const h00 = world.heights[j * (N + 1) + i];
      const h10 = world.heights[j * (N + 1) + i + 1];
      const h01 = world.heights[(j + 1) * (N + 1) + i];
      const h11 = world.heights[(j + 1) * (N + 1) + i + 1];
      const hm = (h00 + h10 + h01 + h11) / 4;
      const slope = Math.max(Math.abs(h10 - h00), Math.abs(h01 - h00)) / step;
      const lakeDist = Math.hypot(cx - world.lake.x, cz - world.lake.z);
      const color = terrainColor(hm, slope, hash2(i, j), lakeDist, world.lake.r);
      const a = vec3(x0, h00, z0);
      const b = vec3(x1, h10, z0);
      const c = vec3(x1, h11, z1);
      const d = vec3(x0, h01, z1);
      pushQuad(list, cam, a, b, c, d, color);
    }
  }
  // The lake: a flat fan of water at y = -5.5.
  const lake = world.lake;
  const centre = vec3(lake.x, lake.y, lake.z);
  const segs = 24;
  let prev = null;
  for (let k = 0; k <= segs; k++) {
    const ang = (k / segs) * Math.PI * 2;
    const p = vec3(lake.x + Math.cos(ang) * lake.r, lake.y, lake.z + Math.sin(ang) * lake.r);
    if (prev) pushTri(list, cam, centre, prev, p, '#3f7fb5');
    prev = p;
  }
}

function drawRunway(list, cam) {
  const y = 0.45;
  const hw = RUNWAY.width / 2;
  const hl = RUNWAY.length / 2;
  const x = RUNWAY.x;
  const z0 = RUNWAY.z - hl;
  const z1 = RUNWAY.z + hl;
  pushQuad(
    list,
    cam,
    vec3(x - hw, y, z0),
    vec3(x + hw, y, z0),
    vec3(x + hw, y, z1),
    vec3(x - hw, y, z1),
    '#3a3f45',
  );
  // Edge lines.
  pushQuad(list, cam, vec3(x - hw + 1, y + 0.05, z0), vec3(x - hw + 2.5, y + 0.05, z0), vec3(x - hw + 2.5, y + 0.05, z1), vec3(x - hw + 1, y + 0.05, z1), '#e8e8e8');
  pushQuad(list, cam, vec3(x + hw - 2.5, y + 0.05, z0), vec3(x + hw - 1, y + 0.05, z0), vec3(x + hw - 1, y + 0.05, z1), vec3(x + hw - 2.5, y + 0.05, z1), '#e8e8e8');
  // Centreline dashes.
  for (let z = z0 + 20; z < z1 - 20; z += 44) {
    pushQuad(list, cam, vec3(x - 1.6, y + 0.06, z), vec3(x + 1.6, y + 0.06, z), vec3(x + 1.6, y + 0.06, z + 22), vec3(x - 1.6, y + 0.06, z + 22), '#f5f5f5');
  }
  // Threshold bars at both ends.
  for (const ze of [z0 + 8, z1 - 26]) {
    for (let k = -2; k <= 2; k++) {
      pushQuad(list, cam, vec3(x + k * 6 - 2, y + 0.06, ze), vec3(x + k * 6 + 2, y + 0.06, ze), vec3(x + k * 6 + 2, y + 0.06, ze + 18), vec3(x + k * 6 - 2, y + 0.06, ze + 18), '#f5f5f5');
    }
  }
}

function drawBuildings(list, cam, world) {
  for (const b of world.buildings) {
    const faces = boxFaces(b.x, b.h / 2, b.z, b.w, b.h, b.d, b.color, '#7a756a');
    for (const f of faces) pushQuad(list, cam, f.p[0], f.p[1], f.p[2], f.p[3], f.color);
    if (b.tower) {
      const cab = boxFaces(b.x, b.h + 4, b.z, b.w + 6, 7, b.d + 6, '#5b7a8a', '#46606e');
      for (const f of cab) pushQuad(list, cam, f.p[0], f.p[1], f.p[2], f.p[3], f.color);
    }
  }
  // Windsock pole near the runway.
  const wx = 42;
  const wz = RUNWAY.z + 120;
  const wy = 0;
  pushQuad(list, cam, vec3(wx - 0.2, wy, wz), vec3(wx + 0.2, wy, wz), vec3(wx + 0.2, wy + 12, wz), vec3(wx - 0.2, wy + 12, wz), '#d8d8d8');
  pushQuad(list, cam, vec3(wx, wy + 11, wz), vec3(wx + 7, wy + 10.2, wz), vec3(wx + 7, wy + 11.4, wz), vec3(wx, wy + 12, wz), '#e86a1e');
}

function drawTrees(list, cam, world) {
  const right = cam.right;
  for (const t of world.trees) {
    const dx = t.x - cam.eye.x;
    const dz = t.z - cam.eye.z;
    if (dx * dx + dz * dz > 1500 * 1500) continue;
    if (dot({ x: dx, y: 0, z: dz }, cam.forward) < -40) continue;
    const s = t.s;
    const half = s * 0.55;
    const rx = right.x * half;
    const rz = right.z * half;
    const base = vec3(t.x, t.h, t.z);
    const top = vec3(t.x, t.h + s * 1.9, t.z);
    const l = vec3(t.x - rx, t.h + s * 0.4, t.z - rz);
    const r = vec3(t.x + rx, t.h + s * 0.4, t.z + rz);
    const col = t.tone < 0.5 ? '#2f5c26' : '#3a6b2d';
    pushTri(list, cam, base, l, top, col);
    pushTri(list, cam, base, top, r, col);
  }
}

function drawRings(list, cam, rings, nextIndex, time) {
  for (const ring of rings) {
    if (ring.passed) continue;
    const isNext = ring.index === nextIndex;
    const color = isNext ? '#ff7a1a' : '#37c8e8';
    // Ring normal and two in-plane axes.
    const n = normalize(vec3(ring.nx, ring.ny, ring.nz));
    const tmp = Math.abs(n.y) > 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0);
    const u = normalize(cross(n, tmp));
    const v = cross(n, u);
    const centre = vec3(ring.x, ring.y, ring.z);
    // The next ring is thicker and brighter, so it reads from far away.
    const tube = isNext ? 2.4 : 1.6;
    const segs = 20;
    let prevOuter = null;
    let prevInner = null;
    for (let k = 0; k <= segs; k++) {
      const ang = (k / segs) * Math.PI * 2;
      const co = Math.cos(ang);
      const si = Math.sin(ang);
      const outer = add(centre, add(scale(u, co * ring.r), scale(v, si * ring.r)));
      const inner = add(centre, add(scale(u, co * (ring.r - tube)), scale(v, si * (ring.r - tube))));
      if (prevOuter) {
        pushQuad(list, cam, prevOuter, outer, inner, prevInner, color);
      }
      prevOuter = outer;
      prevInner = inner;
    }
  }
}

function drawPlane(list, cam, plane) {
  const { forward, right, up } = planeBasis(plane);
  const toWorld = (v) => ({
    x: plane.x + right.x * v.x + up.x * v.y + forward.x * v.z,
    y: plane.y + right.y * v.x + up.y * v.y + forward.y * v.z,
    z: plane.z + right.z * v.x + up.z * v.y + forward.z * v.z,
  });
  for (const f of PLANE_FACES) {
    const pts = f.p.map(toWorld);
    if (pts.length === 4) pushQuad(list, cam, pts[0], pts[1], pts[2], pts[3], f.color);
    else pushTri(list, cam, pts[0], pts[1], pts[2], f.color);
  }
  // Spinning propeller, only when the engine runs.
  if (plane.throttle > 0.05 || plane.speed > 1) {
    const blades = propellerBlades(plane.propAngle);
    for (const b of blades) {
      const pts = b.p.map(toWorld);
      pushTri(list, cam, pts[0], pts[1], pts[2], b.color);
    }
  }
  // Navigation lights: tiny bright quads on the wingtips.
  const tipL = toWorld(vec3(-4.8, -0.1, 0.7));
  const tipR = toWorld(vec3(4.8, -0.1, 0.7));
  const s = 0.28;
  pushQuad(list, cam, vec3(tipL.x - s, tipL.y - s, tipL.z), vec3(tipL.x + s, tipL.y - s, tipL.z), vec3(tipL.x + s, tipL.y + s, tipL.z), vec3(tipL.x - s, tipL.y + s, tipL.z), '#ff2e2e');
  pushQuad(list, cam, vec3(tipR.x - s, tipR.y - s, tipR.z), vec3(tipR.x + s, tipR.y - s, tipR.z), vec3(tipR.x + s, tipR.y + s, tipR.z), vec3(tipR.x - s, tipR.y + s, tipR.z), '#2eff5e');
}

// --- Camera -----------------------------------------------------------------

function chaseCamera(plane, w, h, lookUp, distance) {
  const ch = Math.cos(plane.heading);
  const sh = Math.sin(plane.heading);
  const dist = distance || CONFIG.chaseDistance;
  // Behind the plane, opposite its horizontal heading, a little above it.
  const eye = vec3(
    plane.x - sh * dist,
    plane.y + 2.2 + CONFIG.chaseHeight * 0.3 + (dist - CONFIG.chaseDistance) * 0.12,
    plane.z + ch * dist,
  );
  const target = vec3(plane.x, plane.y + 1.2 + (lookUp || 0), plane.z);
  return makeCamera(eye, target, vec3(0, 1, 0), 1.15, w, h);
}

function cockpitCamera(plane, w, h) {
  const { forward, up } = planeBasis(plane);
  const eye = add(add(vec3(plane.x, plane.y, plane.z), scale(up, 0.9)), scale(forward, 0.4));
  const target = add(eye, forward);
  const cam = makeCamera(eye, target, up, 1.25, w, h);
  return cam;
}

// --- HUD --------------------------------------------------------------------

function text(ctx, str, x, y, size, color, align, weight) {
  ctx.font = `${weight || 700} ${size}px "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(10,20,30,0.75)';
  ctx.strokeText(str, x, y);
  ctx.fillStyle = color || '#fff';
  ctx.fillText(str, x, y);
}

function panel(ctx, x, y, w, h, alpha) {
  ctx.fillStyle = `rgba(8,18,28,${alpha ?? 0.55})`;
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();
}

function bar(ctx, x, y, w, h, frac, color, bg) {
  ctx.fillStyle = bg || 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, w * clamp(frac, 0, 1)), h, 4);
  ctx.fill();
}

function drawHud(ctx, g, w, h) {
  const p = g.plane;
  const alt = Math.max(0, p.y - g.world.heightAt(p.x, p.z));
  const speedKmh = Math.round(p.speed * 3.6);
  const hdg = Math.round(((deg(p.heading) % 360) + 360) % 360);
  // Top-left: the flight instruments as numbers.
  panel(ctx, 14, 14, 300, 108, 0.55);
  text(ctx, `ALT ${Math.round(alt)} m`, 28, 24, 26, '#fff');
  text(ctx, `SPD ${speedKmh} km/h`, 28, 56, 26, '#fff');
  text(ctx, `HDG ${String(hdg).padStart(3, '0')}° ${headingLabel(p.heading)}`, 28, 88, 22, '#cfe8f5');
  // Top-right: score, rings, timer, fuel.
  const ringsDone = g.rings.filter((r) => r.passed).length;
  panel(ctx, w - 314, 14, 300, 122, 0.55);
  text(ctx, `SCORE ${g.score}`, w - 300, 24, 26, '#ffd34d', 'left');
  text(ctx, `RINGS ${ringsDone}/${g.rings.length}`, w - 300, 56, 22, '#fff');
  text(ctx, `TIME ${formatTime(g.elapsed)}`, w - 300, 88, 22, '#cfe8f5');
  text(ctx, 'FUEL', w - 300, 112, 13, '#cfe8f5');
  bar(ctx, w - 246, 114, 218, 8, p.fuel / CONFIG.fuelCapacity, p.fuel < 20 ? '#ff5340' : '#4dd07a');
  // Throttle bar, bottom-right.
  panel(ctx, w - 214, h - 64, 200, 50, 0.55);
  text(ctx, 'THR', w - 200, h - 54, 16, '#cfe8f5');
  bar(ctx, w - 148, h - 50, 120, 12, p.throttle, '#ffb03a');
  // Stall + fuel warnings, flashing.
  if (p.stalled && !p.onGround && g.phase === 'flying') {
    const on = Math.floor(g.time * 4) % 2 === 0;
    if (on) text(ctx, 'STALL — NOSE DOWN, ADD POWER', w / 2, h * 0.42, 28, '#ff5340', 'center');
  } else if (p.fuel < 15 && p.fuel > 0 && g.phase === 'flying') {
    text(ctx, 'LOW FUEL', w / 2, h * 0.42, 26, '#ffb03a', 'center');
  }
  if (p.fuel <= 0 && g.phase === 'flying') {
    text(ctx, 'FUEL EMPTY — GLIDE TO THE RUNWAY', w / 2, h * 0.42, 24, '#ff5340', 'center');
  }
  // Next-ring beacon: an arrow at the screen edge pointing at the ring.
  if (g.phase === 'flying') {
    const next = g.rings[g.nextRing];
    if (next) {
      const dx = next.x - p.x;
      const dz = next.z - p.z;
      const dist = Math.round(Math.hypot(dx, next.y - p.y, dz));
      const bearing = Math.atan2(dx, -dz) - p.heading;
      const bx = w / 2 + Math.sin(bearing) * 150;
      const by = h * 0.32 + -Math.cos(bearing) * 60;
      ctx.save();
      ctx.translate(clamp(bx, 60, w - 60), clamp(by, 90, h - 200));
      ctx.rotate(bearing);
      ctx.fillStyle = '#ff7a1a';
      ctx.beginPath();
      ctx.moveTo(0, -26);
      ctx.lineTo(16, 12);
      ctx.lineTo(0, 4);
      ctx.lineTo(-16, 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      text(ctx, `RING ${g.nextRing + 1} — ${dist} m`, w / 2, 132, 20, '#ffb03a', 'center');
    }
  }
  // Centre message line.
  if (g.message && g.messageUntil > g.time) {
    text(ctx, g.message, w / 2, h * 0.2, 30, '#ffffff', 'center');
  }
  drawMinimap(ctx, g, w, h);
}

function drawMinimap(ctx, g, w, h) {
  const size = 168;
  const x0 = 14;
  const y0 = h - size - 14;
  panel(ctx, x0, y0, size, size, 0.6);
  const half = CONFIG.worldSize / 2;
  const toMap = (x, z) => [x0 + ((x + half) / CONFIG.worldSize) * size, y0 + ((z + half) / CONFIG.worldSize) * size];
  // Lake.
  const [lx, ly] = toMap(g.world.lake.x, g.world.lake.z);
  ctx.fillStyle = '#3f7fb5';
  ctx.beginPath();
  ctx.ellipse(lx, ly, (g.world.lake.r / CONFIG.worldSize) * size, (g.world.lake.r / CONFIG.worldSize) * size, 0, 0, Math.PI * 2);
  ctx.fill();
  // Runway.
  const [rx, ry] = toMap(RUNWAY.x, RUNWAY.z);
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(rx, ry - 10);
  ctx.lineTo(rx, ry + 10);
  ctx.stroke();
  // Rings.
  for (const r of g.rings) {
    const [mx, my] = toMap(r.x, r.z);
    ctx.fillStyle = r.passed ? '#4dd07a' : r.index === g.nextRing ? '#ff7a1a' : '#9fd8e8';
    ctx.beginPath();
    ctx.arc(mx, my, r.index === g.nextRing ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  // Plane. The map puts north up, so a bearing of 0 points straight up.
  const [px, py] = toMap(g.plane.x, g.plane.z);
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(g.plane.heading);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  text(ctx, 'N', x0 + size / 2, y0 + 6, 12, '#fff', 'center');
}

// --- Cockpit ----------------------------------------------------------------

function drawCockpit(ctx, g, w, h) {
  const p = g.plane;
  const panelH = Math.round(h * 0.3);
  const py = h - panelH;
  // Panel body.
  const grad = ctx.createLinearGradient(0, py, 0, h);
  grad.addColorStop(0, '#232a31');
  grad.addColorStop(1, '#12161a');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, py + 26);
  ctx.quadraticCurveTo(w / 2, py - 26, w, py + 26);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Canopy frame struts.
  ctx.fillStyle = 'rgba(18,22,26,0.9)';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(w * 0.07, 0);
  ctx.lineTo(w * 0.1, py);
  ctx.lineTo(0, py + 40);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w, 0);
  ctx.lineTo(w * 0.93, 0);
  ctx.lineTo(w * 0.9, py);
  ctx.lineTo(w, py + 40);
  ctx.closePath();
  ctx.fill();
  // Cowling nose at the bottom centre.
  ctx.fillStyle = '#e86a1e';
  ctx.beginPath();
  ctx.moveTo(w / 2 - 130, h);
  ctx.quadraticCurveTo(w / 2 - 90, py + 6, w / 2, py + 2);
  ctx.quadraticCurveTo(w / 2 + 90, py + 6, w / 2 + 130, h);
  ctx.closePath();
  ctx.fill();
  // Spinning prop blur.
  ctx.fillStyle = 'rgba(40,44,48,0.35)';
  ctx.beginPath();
  ctx.ellipse(w / 2, py + 4, 120, 26, 0, 0, Math.PI * 2);
  ctx.fill();

  const cx = w / 2;
  const cy = py + panelH / 2 + 8;
  // Artificial horizon.
  const R = Math.min(64, panelH * 0.32);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-p.roll);
  ctx.translate(0, p.pitch * R * 1.4);
  ctx.fillStyle = '#5aa3d6';
  ctx.fillRect(-R, -R * 2, R * 2, R * 2);
  ctx.fillStyle = '#7a5a34';
  ctx.fillRect(-R, 0, R * 2, R * 2);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-R, -2, R * 2, 4);
  ctx.restore();
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  // Fixed wings marker on the horizon.
  ctx.fillStyle = '#ffd34d';
  ctx.fillRect(cx - R - 14, cy - 3, 14, 6);
  ctx.fillRect(cx + R, cy - 3, 14, 6);
  text(ctx, 'ATT', cx, cy - R - 22, 13, '#cfe8f5', 'center');
  // Airspeed gauge (left) and altimeter (right).
  gauge(ctx, cx - R - 120, cy, R * 0.9, Math.round(p.speed * 3.6), 320, 'KM/H');
  gauge(ctx, cx + R + 120, cy, R * 0.9, Math.round(Math.max(0, p.y - g.world.heightAt(p.x, p.z))), 600, 'ALT M');
  // Compass strip.
  const hdg = Math.round(((deg(p.heading) % 360) + 360) % 360);
  text(ctx, `HDG ${String(hdg).padStart(3, '0')}° ${headingLabel(p.heading)}`, cx, py + 14, 18, '#fff', 'center');
  // Fuel + throttle bars.
  bar(ctx, 24, py + 30, 130, 12, p.fuel / CONFIG.fuelCapacity, p.fuel < 20 ? '#ff5340' : '#4dd07a');
  text(ctx, 'FUEL', 24, py + 48, 13, '#cfe8f5');
  bar(ctx, w - 154, py + 30, 130, 12, p.throttle, '#ffb03a');
  text(ctx, 'THROTTLE', w - 154, py + 48, 13, '#cfe8f5');
  // Warning lamps.
  lamp(ctx, 24, py + 78, p.stalled && !p.onGround, 'STALL', '#ff5340');
  lamp(ctx, 110, py + 78, p.fuel < 20, 'FUEL', '#ffb03a');
  lamp(ctx, w - 154, py + 78, p.onGround, 'GEAR', '#4dd07a');
}

function gauge(ctx, x, y, r, value, max, label) {
  ctx.fillStyle = '#10151a';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 2;
  ctx.stroke();
  const frac = clamp(value / max, 0, 1);
  const ang = -Math.PI * 0.75 + frac * Math.PI * 1.5;
  ctx.strokeStyle = '#ffd34d';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(ang) * (r - 6), y + Math.sin(ang) * (r - 6));
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), x, y + r * 0.32);
  ctx.fillStyle = '#cfe8f5';
  ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
  ctx.fillText(label, x, y - r * 0.55);
}

function lamp(ctx, x, y, on, label, color) {
  ctx.fillStyle = on ? color : 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(x + 8, y + 8, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = on ? '#fff' : '#8a97a3';
  ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 22, y + 8);
}

// --- Screens ----------------------------------------------------------------

function overlay(ctx, w, h, alpha) {
  ctx.fillStyle = `rgba(6,14,22,${alpha})`;
  ctx.fillRect(0, 0, w, h);
}

function drawMenu(ctx, g, w, h) {
  overlay(ctx, w, h, 0.45);
  const cx = w / 2;
  text(ctx, 'SKY COURIER', cx, h * 0.14, 64, '#ffd34d', 'center');
  text(ctx, 'a 3D flight game over Merapi Valley', cx, h * 0.14 + 74, 24, '#fff', 'center');
  const bw = 560;
  const bx = cx - bw / 2;
  let y = h * 0.3;
  panel(ctx, bx, y, bw, 250, 0.72);
  text(ctx, 'PICK A MISSION  —  press 1, 2 or 3, then ENTER to fly', bx + 24, y + 18, 18, '#cfe8f5');
  for (let i = 0; i < g.missions.length; i++) {
    const m = g.missions[i];
    const my = y + 52 + i * 56;
    const sel = g.missionIndex === i;
    ctx.fillStyle = sel ? 'rgba(255,122,26,0.35)' : 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.roundRect(bx + 12, my, bw - 24, 48, 8);
    ctx.fill();
    if (sel) {
      ctx.strokeStyle = '#ff7a1a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    text(ctx, `${i + 1}. ${m.name} — ${m.rings} rings, ${m.fuel} fuel`, bx + 28, my + 8, 19, '#fff');
    text(ctx, m.blurb, bx + 28, my + 30, 14, '#cfe8f5');
  }
  y += 268;
  text(ctx, 'W/S throttle · Arrows pitch & roll · Q/E rudder · Mouse steers · C camera · M mute', cx, y, 17, '#fff', 'center');
  text(ctx, 'Fly every ring in order, then land back on the runway. Mind the stall speed!', cx, y + 26, 17, '#ffd34d', 'center');
}

function drawEndScreen(ctx, g, w, h) {
  overlay(ctx, w, h, 0.5);
  const cx = w / 2;
  const won = g.phase === 'landed';
  text(ctx, won ? 'WELCOME HOME, COURIER' : 'SORTIE OVER', cx, h * 0.2, 52, won ? '#4dd07a' : '#ff5340', 'center');
  const bw = 520;
  const bx = cx - bw / 2;
  const y = h * 0.32;
  panel(ctx, bx, y, bw, 250, 0.75);
  const rows = [
    ['Mission', g.mission.name],
    ['Rings flown', `${g.rings.filter((r) => r.passed).length} / ${g.rings.length}`],
    ['Ring points', String(g.ringScore)],
    ['Landing', won ? `+${g.landingScore} (clean)` : '—'],
    ['Time bonus', `+${g.timeBonus}`],
    ['Flight time', formatTime(g.elapsed)],
    ['SCORE', String(g.score)],
  ];
  rows.forEach(([k, v], i) => {
    const ry = y + 18 + i * 32;
    text(ctx, k, bx + 28, ry, 18, '#cfe8f5');
    text(ctx, v, bx + bw - 28, ry, 18, i === rows.length - 1 ? '#ffd34d' : '#fff', 'right');
  });
  text(ctx, won ? 'A clean landing and a full manifest. The valley thanks you.' : g.crashReason || 'The plane is down. The valley keeps its secrets.', cx, y + 272, 18, '#fff', 'center');
  text(ctx, 'Press ENTER to fly again, or 1/2/3 for another mission', cx, y + 302, 17, '#ffd34d', 'center');
}

// --- Main render entry ------------------------------------------------------

export function render(ctx, g, w, h) {
  const dusk = g.mission.dusk;
  drawSky(ctx, w, h, dusk);
  // On the menu and end screens the panel covers the centre of the frame,
  // so aim the camera a little high and pull it back: the plane sits below
  // the panel, visible, instead of hiding behind it.
  const overlayScreen = g.phase === 'menu' || g.phase === 'landed' || g.phase === 'crashed';
  const cam = g.cameraMode === 'cockpit' && g.phase !== 'menu' ? cockpitCamera(g.plane, w, h) : chaseCamera(g.plane, w, h, overlayScreen ? 5 : 0, overlayScreen ? 24 : 0);
  // Menu and end screens keep a fixed scenic camera.
  drawSun(ctx, cam, w, h, dusk);
  drawClouds(ctx, cam, g.world);
  const list = [];
  drawTerrain(list, cam, g.world);
  drawRunway(list, cam);
  drawBuildings(list, cam, g.world);
  drawTrees(list, cam, g.world);
  if (g.phase === 'flying' || g.phase === 'landed' || g.phase === 'crashed') {
    drawRings(list, cam, g.rings, g.nextRing, g.time);
  }
  if (g.cameraMode !== 'cockpit' || g.phase === 'menu') {
    drawPlane(list, cam, g.plane);
  }
  list.sort((a, b) => b.depth - a.depth);
  for (const t of list) {
    ctx.fillStyle = t.color;
    ctx.beginPath();
    ctx.moveTo(t.pa.x, t.pa.y);
    ctx.lineTo(t.pb.x, t.pb.y);
    ctx.lineTo(t.pc.x, t.pc.y);
    ctx.closePath();
    ctx.fill();
  }
  if (g.phase === 'menu') {
    drawHud(ctx, g, w, h);
    drawMenu(ctx, g, w, h);
    return;
  }
  if (g.cameraMode === 'cockpit') drawCockpit(ctx, g, w, h);
  drawHud(ctx, g, w, h);
  if (g.phase === 'landed' || g.phase === 'crashed') drawEndScreen(ctx, g, w, h);
}
