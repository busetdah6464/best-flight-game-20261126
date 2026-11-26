// Sky Courier input: keyboard plus a gentle mouse steer. Keys are read
// as a held set; the game loop turns them into pitch, roll, yaw and
// throttle each frame.

export function makeInput(canvas) {
  const keys = new Set();
  const mouse = { x: 0, y: 0, active: false };
  const pressed = new Set(); // keys pressed since last poll (edge triggers)

  function onKeyDown(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
  }
  function onKeyUp(e) {
    keys.delete(e.code);
  }
  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) / rect.width - 0.5;
    mouse.y = (e.clientY - rect.top) / rect.height - 0.5;
    mouse.active = true;
  }
  function onBlur() {
    keys.clear();
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('mousemove', onMouseMove);

  return {
    // Edge-triggered: true once per physical press.
    wasPressed(code) {
      return pressed.has(code);
    },
    clearPressed() {
      pressed.clear();
    },
    held(code) {
      return keys.has(code);
    },
    // Continuous control values in -1..1 (throttle is handled separately).
    controls() {
      let pitch = 0;
      let roll = 0;
      let yaw = 0;
      if (keys.has('ArrowUp')) pitch += 1;
      if (keys.has('ArrowDown')) pitch -= 1;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) roll -= 1;
      if (keys.has('ArrowRight') || keys.has('KeyD')) roll += 1;
      if (keys.has('KeyQ')) yaw -= 1;
      if (keys.has('KeyE')) yaw += 1;
      // Mouse: a gentle steer that never fights the keyboard.
      if (mouse.active) {
        pitch += -mouse.y * 0.6;
        roll += mouse.x * 0.8;
      }
      return {
        pitch: Math.max(-1, Math.min(1, pitch)),
        roll: Math.max(-1, Math.min(1, roll)),
        yaw: Math.max(-1, Math.min(1, yaw)),
      };
    },
    throttleDelta(dt, current) {
      let t = current;
      if (keys.has('KeyW') || keys.has('ShiftLeft') || keys.has('ShiftRight')) t += dt * 0.9;
      if (keys.has('KeyS') || keys.has('ControlLeft')) t -= dt * 0.9;
      return Math.max(0, Math.min(1, t));
    },
  };
}
