// Sky Courier 3D math: small vectors, a camera and a perspective
// projection. Everything is plain numbers — no library, no WebGL.

export function vec3(x, y, z) {
  return { x, y, z };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a) {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function normalize(a) {
  const l = length(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

// Rotate a vector by yaw (around Y), then pitch (around X), then roll
// (around Z). Yaw 0 faces -Z (north), pitch positive climbs.
export function rotateEuler(v, yaw, pitch, roll) {
  // Yaw around Y
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  let x = v.x * cy + v.z * sy;
  let y = v.y;
  let z = -v.x * sy + v.z * cy;
  // Pitch around X
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const y2 = y * cp - z * sp;
  const z2 = y * sp + z * cp;
  y = y2;
  z = z2;
  // Roll around Z
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const x2 = x * cr - y * sr;
  const y3 = x * sr + y * cr;
  return { x: x2, y: y3, z };
}

// A camera that looks from `eye` toward `target` with an up hint.
export function makeCamera(eye, target, upHint, fov, width, height) {
  const forward = normalize(sub(target, eye));
  const right = normalize(cross(forward, upHint));
  const up = cross(right, forward);
  const focal = (height / 2) / Math.tan(fov / 2);
  return { eye, forward, right, up, focal, width, height, cx: width / 2, cy: height / 2 };
}

// Project a world point to screen space. Returns null behind the camera.
export function project(cam, p) {
  const d = sub(p, cam.eye);
  const cx = dot(d, cam.right);
  const cy = dot(d, cam.up);
  const cz = dot(d, cam.forward);
  if (cz < 0.5) return null;
  return {
    x: cam.cx + (cx * cam.focal) / cz,
    y: cam.cy - (cy * cam.focal) / cz,
    depth: cz,
  };
}

// True when a point is in front of the camera and inside a generous frame.
export function inFrame(cam, p, margin) {
  const s = project(cam, p);
  if (!s) return false;
  return (
    s.x > -margin && s.x < cam.width + margin && s.y > -margin && s.y < cam.height + margin
  );
}
