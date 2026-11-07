// Emulation of the HexaNRL robot framework (NRL 2026 control hub) on a simulated robot.
// Compiled OpModes (see cpp.js) run against this exactly as they would on the ESP32:
// a 100 Hz loop, the Action system, TankDrive with ramping, DriveActions (timed / IMU-fused distance
// drives and gyro turns), servos, DC motors, the LSM6DSOX IMU, NRLComms heading, battery sensing,
// telemetry, gamepad1 and VL53L1X laser rangefinders on I2C (the Pololu library's API). DriveActions
// ships as a prebuilt library, so its control logic follows the behaviour documented in DriveActions.h /
// DriveTuning.h.
import { ROBOT } from './config.js';
import { qrot, RAPIER } from './physics.js';

const DEG = Math.PI / 180;
export const TICK = 0.01;                    // NRL loop period (100 Hz)
export const AUTO_SECONDS = 60;              // AUTO OpModes run for 60 s, then stop() (NRLOpMode.h)
export const TELEOP_SECONDS = 150;

// board pins (BoardPins.h)
const PINS = {
  MOTOR_L_DIR: 5, MOTOR_L_PWM: 10, MOTOR_R_DIR: 11, MOTOR_R_PWM: 12, SERVO_1: 39, SERVO_2: 40, SERVO_3: 41, SERVO_4: 42,
  I2C_SDA: 47, I2C_SCL: 48, OLED_SDA: 6, OLED_SCL: 7, MCP3008_CS: 8, MCP3008_SCK: 14, MCP3008_MISO: 9, MCP3008_MOSI: 13,
  BUZZER_PIN: 21, BUTTON_PIN: 4, BOOT_PIN: 0, LED_STATUS_PIN: 38, DIGITAL_1: 1, DIGITAL_2: 2, DIGITAL_3: 15, DIGITAL_4: 16,
  DIGITAL_5: 35, DIGITAL_6: 36, DIGITAL_7: 37, MOTOR_3_DIR: 1, MOTOR_3_PWM: 2, MOTOR_4_DIR: 15, MOTOR_4_PWM: 16,
  DIGITAL_D1: 35, DIGITAL_D2: 36, DIGITAL_D3: 37, ADC_EXT_1: 3, ADC_EXT_2: 4, ADC_EXT_3: 5, ADC_EXT_4: 6, ADC_EXT_5: 7, UART1_TX: 17, UART1_RX: 18,
};
const BTN = { BTN_X: 1 << 0, BTN_A: 1 << 1, BTN_B: 1 << 2, BTN_Y: 1 << 3, BTN_DPAD_RIGHT: 1 << 4, BTN_DPAD_DOWN: 1 << 5, BTN_DPAD_UP: 1 << 6, BTN_DPAD_LEFT: 1 << 7, BTN_RB: 1 << 8, BTN_LB: 1 << 9, BTN_LT: 1 << 10, BTN_RT: 1 << 11 };
export const SERVO_PINS = [['SERVO_1', 39], ['SERVO_2', 40], ['SERVO_3', 41], ['SERVO_4', 42]];
export const MOTOR_PORTS = [['Motor L', 5], ['Motor R', 11], ['Motor 3', 1], ['Motor 4', 15]];

// ms per inch the simulated robot drives at 170 PWM on an 11.5 V battery (what OverdriveCalib measures
// on it). The Robot code panel uses this for MS_PER_INCH unless the user turns that off.
export const SIM_MS_PER_INCH = 23;

// default wiring = Team 009 Overdrive (OverdriveConfig.h): Servo 1 grabber, Servo 2 arm
export const DEFAULT_WIRING = {
  motors: { 5: 'left', 11: 'right', 1: 'left', 15: 'right' },  // motor DIR pin -> drive side
  trustFlip: true,                          // assume the code's flipped settings are right (+ speed = forward on both sides)
  mirrored: { left: true, right: false },   // only used when trustFlip is off: which gearbox is mirrored
  servos: {
    39: { role: 'arm', floor: 115, scale: -1 },   // servo angle with the gripper on the floor; arm degrees per servo degree (smaller angle = higher)
    40: { role: 'gripper', open: 15, closed: 90 },
    41: { role: 'none' },
    42: { role: 'none' },
  },
  imuX: 'back',          // which way the IMU's X axis points on the robot (Z is up)
  battery: 11.5,         // simulated battery voltage
  simCalib: true,        // replace the code's MS_PER_INCH with SIM_MS_PER_INCH (the simulated robot's own)
  // VL53L1X laser rangefinders, in the order the code creates them: where each is fitted, in robot
  // coordinates (m: x forward, y up from the floor, z right) and which way it looks (deg, 180 = backwards).
  // Default: one on the back plate, 10 cm up (lower, it sees the station ramp), 4.5 cm inside the rear face
  // (it can't measure closer than 4 cm, so it still reads when the robot is backed against a wall).
  lasers: [{ name: 'rear', x: -0.089, y: 0.10, z: 0, yaw: 180 }],
  // real-robot imperfections (all off by default). With random on, each run draws every value
  // uniformly within +/- the number given (trims, bias, scale) or 0..the number (deadband, noise, sag).
  errors: { on: false, random: false, trimL: 0, trimR: 0, deadband: 0, gyroBias: 0, gyroScale: 0, gyroNoise: 0, accelNoise: 0, accelBias: 0, sag: 0, laserBias: 0, laserNoise: 0 },
};
export const TYPICAL_ERRORS = { on: true, random: true, trimL: 5, trimR: 5, deadband: 18, gyroBias: 0.15, gyroScale: 2, gyroNoise: 0.4, accelNoise: 0.15, accelBias: 0.05, sag: 0.6, laserBias: 8, laserNoise: 3 };
// draw the error values for one run
export function drawErrors(E, rand = Math.random) {
  if (!E || !E.on) return null;
  const pm = (v) => (E.random ? (rand() * 2 - 1) * v : v), up = (v) => (E.random ? rand() * v : v);
  // (laser values drawn last, so adding them left every older error set unchanged)
  return { trimL: pm(E.trimL), trimR: pm(E.trimR), deadband: up(E.deadband), gyroBias: pm(E.gyroBias), gyroScale: pm(E.gyroScale), gyroNoise: up(E.gyroNoise), accelNoise: up(E.accelNoise), accelBias: pm(E.accelBias || 0), sag: up(E.sag),
    laserBias: pm(E.laserBias || 0), laserNoise: up(E.laserNoise || 0) };
}

// names the compiler may reference (the rest are user code)
const ARDUINO_FNS = ['millis', 'micros', 'delay', 'delayMicroseconds', 'constrain', 'map', 'abs', 'min', 'max', 'sq', 'sqrt', 'sqrtf', 'pow', 'powf', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinf', 'cosf', 'tanf', 'asinf', 'acosf', 'atanf', 'atan2f',
  'tanh', 'tanhf', 'sinh', 'cosh', 'fabs', 'fabsf', 'fmin', 'fmax', 'fminf', 'fmaxf', 'fmod', 'fmodf', 'round', 'roundf', 'lround', 'lroundf', 'floor', 'floorf', 'ceil', 'ceilf', 'exp', 'expf', 'log', 'logf', 'log10', 'hypot', 'hypotf', 'copysign', 'copysignf', 'isnan', 'isinf', 'trunc', 'truncf',
  'random', 'randomSeed', 'tone', 'noTone', 'pinMode', 'digitalWrite', 'digitalRead', 'analogRead', 'analogWrite', 'yield', 'radians', 'degrees', 'snprintf', 'sprintf', 'strcmp', 'strlen', 'itoa', 'dtostrf'];
const CONSTS = ['PI', 'HALF_PI', 'TWO_PI', 'DEG_TO_RAD', 'RAD_TO_DEG', 'M_PI', 'M_PI_2', 'HIGH', 'LOW', 'INPUT', 'OUTPUT', 'INPUT_PULLUP', 'INPUT_PULLDOWN', 'EULER', 'FLT_MAX', 'INT_MAX', 'INT_MIN', 'UINT32_MAX'];
const FRAMEWORK = ['instant', 'sequential', 'parallel', 'sleep_ms', 'wait_until', 'repeat', 'NRLComms', 'NRLGamepad', 'power', 'gamepad1', 'userLed', 'botLed', 'botOled', 'nrlLedStrip', 'Serial', 'Wire', 'Wire1',
  'hexaImuConfig', 'hexaOledConfig', 'std', 'OpModeType', 'nrlBootCount', 'nrlLastResetReason', 'TELEOP', 'AUTO',
  'HEXA_ACCEL_RANGE_2G', 'HEXA_ACCEL_RANGE_4G', 'HEXA_ACCEL_RANGE_8G', 'HEXA_ACCEL_RANGE_16G', 'HEXA_GYRO_RANGE_250_DPS', 'HEXA_GYRO_RANGE_500_DPS', 'HEXA_GYRO_RANGE_1000_DPS', 'HEXA_GYRO_RANGE_2000_DPS',
  'HexaServo', 'HexaDCMotor', 'TankDrive', 'DriveActions', 'DriveTuning', 'HexaIMU', 'HexaPower', 'HexaLED', 'HexaOLED', 'Gamepad', 'HexaServoConfig', 'HexaDCMotorConfig', 'HexaIMUConfig', 'HexaPowerConfig', 'HexaOLEDConfig',
  'HexaIMUData', 'HexaPowerData', 'NRLOpMode', 'NRLTelemetry', 'Action', 'Adafruit_NeoPixel', 'TwoWire', 'VL53L1X'];
const FLOAT_RET = new Set(['tanh', 'tanhf', 'sinh', 'cosh', 'sqrt', 'sqrtf', 'pow', 'powf', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinf', 'cosf', 'tanf', 'asinf', 'acosf', 'atanf', 'atan2f', 'fabs', 'fabsf', 'fmin', 'fmax', 'fminf', 'fmaxf', 'fmod', 'fmodf', 'round', 'roundf', 'floor', 'floorf', 'ceil', 'ceilf', 'exp', 'expf', 'log', 'logf', 'log10', 'hypot', 'hypotf', 'copysign', 'copysignf', 'radians', 'degrees', 'trunc', 'truncf']);
const INT_RET = new Set(['millis', 'micros', 'lround', 'lroundf', 'random', 'digitalRead', 'analogRead', 'map']);
export const RUNTIME_INFO = {
  names: new Map([
    ...ARDUINO_FNS.map((n) => [n, { type: 'fn', ret: FLOAT_RET.has(n) ? 'float' : INT_RET.has(n) ? 'int' : 'unknown' }]),
    ...CONSTS.map((n) => [n, { type: /^(HIGH|LOW|INPUT|OUTPUT|INPUT_PULLUP|INPUT_PULLDOWN|INT_MAX|INT_MIN|UINT32_MAX)$/.test(n) ? 'int' : 'float' }]),
    ...Object.keys(PINS).map((n) => [n, { type: 'int' }]),
    ...Object.keys(BTN).map((n) => [n, { type: 'int' }]),
    ...FRAMEWORK.map((n) => [n, { type: 'obj' }]),
  ]),
  baseMembers: { NRLOpMode: ['telemetry', 'runAction', 'runBlocking', 'cancelActions', 'isActionRunning'], Action: ['reset'] },
  defines: { NRL_TEAM_NUMBER: '9', ARDUINO: '10819', ESP32: '1', ARDUINO_ARCH_ESP32: '1' },
};

class RuntimeError extends Error {}
// seeded randomness, so an error set can be replayed
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const errRand = (seed) => (Number.isFinite(seed) ? mulberry(seed) : Math.random);
function gaussian(seed) { const r = mulberry(seed); return () => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }; }

// ======================================================================== the runtime for one robot
export class NRLRuntime {
  constructor(sim, robot, wiring, { onLog = () => {}, gamepad = null } = {}) {
    this.sim = sim; this.robot = robot;
    this.wiring = JSON.parse(JSON.stringify(wiring));
    this.onLog = onLog;
    this.readGamepad = gamepad;
    this.err = drawErrors(this.wiring.errors, errRand(this.wiring.errors && this.wiring.errors.seed));   // this run's imperfections (null = a perfect robot)
    this.gauss = gaussian(1234);
    this.laserGauss = gaussian(4321); this.laserRand = mulberry(98765);   // own streams: a laser never changes the other sensors' noise
    this.ms = 0;                 // robot clock (ms since boot = since the program was loaded)
    this.acc = 0;
    this.motors = []; this.servos = []; this.drives = []; this.imus = []; this.lasers = [];
    this.telemetry = new Map();
    this.log = [];
    this.leds = { user: null, bot: null };
    this.op = null; this.started = false; this.stopped = false;
    this.error = null;
    this.guardCount = 0;
    this.comms = { heading: 0, readyAt: 500, dist: 0, gyroZ: 0 };
    this.sense = { prevV: null, acc: { x: 0, y: 0, z: 9.81 }, gyro: { x: 0, y: 0, z: 0 } };
    this.gp = { lx: 0, ly: 0, rx: 0, ry: 0, buttons: 0, prev: 0, justP: 0, justR: 0 };
    this.warned = new Set();
    this.marks = [];             // finished turns (for path tuning tools)
  }
  warnOnce(key, text) { if (this.warned.has(key)) return; this.warned.add(key); this.print(`⚠ ${text}`); }
  print(text) { this.log.push({ t: this.ms, text: String(text) }); if (this.log.length > 200) this.log.shift(); this.onLog(text); }

  // ---- load the compiled program: evaluates global objects (motors, servos, ...) and collects REGISTER_OPMODEs
  load(compiled) {
    this.compiled = compiled;
    const env = makeEnv(this);
    const own = new Set(compiled.globals);
    const names = Object.keys(env).filter((n) => !own.has(n.replace(/^\$/, '')));
    const registry = [];
    env.__register = (name, type, factory) => registry.push({ name, type, factory });
    if (!names.includes('__register')) names.push('__register');
    let fn;
    try {
      fn = new Function(...names, `"use strict";\n${compiled.js}\n`);
    } catch (e) {
      throw new RuntimeError(`Internal compile error: ${e.message}`);
    }
    this.run(() => fn(...names.map((n) => env[n])), 'loading the program');
    this.registry = registry;
    return registry;
  }
  // ---- create the OpMode and run init() (the INIT button on the controller)
  init(name) {
    const entry = this.registry.find((r) => r.name === name);
    if (!entry) throw new RuntimeError(`No OpMode named ${name}`);
    this.entry = entry;
    this.run(() => { this.op = entry.factory(); }, 'creating the OpMode');
    if (!this.op) return false;
    this.run(() => this.op.init(), 'init()');
    this.sense.prevV = null;
    this.readSensors();
    this.applyOutputs(true);    // servos powered by begin() snap the mechanism to their start angles
    return !this.error;
  }
  // ---- START
  start() {
    if (!this.op || this.started || this.error) return;
    this.started = true;
    this.startMs = this.ms;
    this.run(() => this.op.start(), 'start()');
  }
  // OpMode time is up (60 s AUTO) or the run was stopped
  stop() {
    if (!this.op || this.stopped) return;
    this.stopped = true;
    if (!this.error) this.run(() => this.op.stop(), 'stop()');
    this.op._actions.length = 0;
    // HexaDCMotor::stopAll() is called by the runner when an OpMode ends
    for (const m of this.motors) m._speed = 0;
    for (const d of this.drives) { d._curL = d._curR = d._targetL = d._targetR = 0; }
    this.applyOutputs();
  }
  get elapsed() { return this.started ? (this.ms - this.startMs) / 1000 : 0; }

  // ---- called every physics substep while the match is running
  step(dt) {
    this.acc += dt;
    while (this.acc >= TICK - 1e-9) { this.acc -= TICK; this.tick(); }
    this.applyOutputs();
  }
  tick() {
    this.ms += TICK * 1000;
    this.guardCount = 0; this.allocCount = 0;
    this.readSensors();
    this.updateLasers();
    this.readPad();
    if (this.started && !this.stopped && !this.error) {
      this.run(() => this.op._advanceAction(), 'an action');
      if (!this.error) this.run(() => this.op.loop(), 'loop()');
    }
    for (const s of this.servos) s._tick();
    for (const d of this.drives) d._tick();
  }
  // run user code, turning a JS exception into a readable error at the C++ line
  run(fn, where) {
    try { return fn(); } catch (e) {
      if (this.error) return undefined;
      const loc = this.locate(e);
      this.error = { message: e instanceof RuntimeError || e.nrl ? e.message : `${e.message}`, where, loc };
      this.print(`✖ Error in ${where}${loc ? ` (${loc.file}:${loc.line})` : ''}: ${e.message}`);
      for (const m of this.motors) m._speed = 0;
      for (const d of this.drives) { d._curL = d._curR = d._targetL = d._targetR = 0; }
      return undefined;
    }
  }
  locate(e) {
    const m = /<anonymous>:(\d+):(\d+)/.exec(e.stack || '');
    if (!m || !this.compiled) return null;
    const lines = this.compiled.js.split('\n');
    let ln = Number(m[1]) - 3, col = Number(m[2]);   // new Function adds two header lines, plus our "use strict" line
    for (let l = Math.min(ln, lines.length - 1); l >= 0; l--) {
      const text = l === ln ? lines[l].slice(0, col) : lines[l];
      const all = [...text.matchAll(/\/\*@(\d+)\*\//g)];
      if (all.length) { const id = Number(all[all.length - 1][1]); return this.compiled.lineMap[id] || null; }
    }
    return null;
  }

  // ---------------------------------------------------------------- sensors
  readSensors() {
    const b = this.robot.body;
    const q = b.rotation(), inv = { x: -q.x, y: -q.y, z: -q.z, w: q.w };
    const v = b.linvel(), w = b.angvel();
    const lw = qrot(inv, w);                                   // body rates: x fwd, y up, z right
    // specific force (what an accelerometer measures) = acceleration - gravity
    let a = { x: 0, y: 0, z: 0 };
    if (this.sense.prevV) a = { x: (v.x - this.sense.prevV.x) / TICK, y: (v.y - this.sense.prevV.y) / TICK, z: (v.z - this.sense.prevV.z) / TICK };
    this.sense.prevV = { x: v.x, y: v.y, z: v.z };
    const f = qrot(inv, { x: a.x, y: a.y + 9.81, z: a.z });
    // sensor errors: gyro scale error, residual bias (what the start-up calibration leaves), noise
    const E = this.err, n = this.gauss;
    let g = lw;
    if (E) {
      const k = 1 + E.gyroScale / 100, nz = E.gyroNoise * DEG;
      g = { x: lw.x * k + n() * nz, y: lw.y * k + E.gyroBias * DEG + n() * nz, z: lw.z * k + n() * nz };
      const an = E.accelNoise;
      f.x += n() * an; f.y += n() * an; f.z += n() * an;
    }
    // the chip's own low-pass filter
    const s = this.sense.acc;
    s.x += (f.x - s.x) * 0.5; s.y += (f.y - s.y) * 0.5; s.z += (f.z - s.z) * 0.5;
    this.sense.body = { acc: { ...s }, gyro: g };
    // NRLComms heading: + = clockwise (a right turn), integrated from the (imperfect) yaw rate like the real gyro
    const yawRate = g.y;                                      // rad/s, + = counter-clockwise from above
    this.comms.heading -= yawRate * TICK / DEG;
    this.comms.gyroZ = yawRate;
    // forward distance (NRLComms::getDistanceInches)
    const fwd = qrot(q, { x: 1, y: 0, z: 0 });
    if (!E) this.comms.dist += (v.x * fwd.x + v.y * fwd.y + v.z * fwd.z) * TICK / 0.0254;
    else {
      // a real IMU gets distance by integrating the accelerometer twice: its bias and noise make it drift.
      // The speed estimate is zeroed once the motors have been off for a moment (the robot must be still).
      const aF = a.x * fwd.x + a.y * fwd.y + a.z * fwd.z;
      this.imuV = (this.imuV || 0) + (aF + E.accelBias + n() * E.accelNoise) * TICK;
      const off = this.drives.every((d) => d._curL === 0 && d._curR === 0);
      this.stillT = off ? (this.stillT || 0) + TICK : 0;
      if (this.stillT > 0.15) this.imuV *= 0.8;
      this.comms.dist += this.imuV * TICK / 0.0254;
    }
  }

  // ---- VL53L1X laser rangefinders
  // The distance to the nearest surface in a narrow cone (5 rays: the centre and +/-6 deg sideways, +/-3 deg
  // up/down, about what setROISize(4, 4) gives), so a pole or robot at the edge of the beam wins over the wall.
  laserRay(L) {
    const b = this.robot.body, q = b.rotation(), t = b.translation(), m = L.mount;
    const o = qrot(q, { x: m.x, y: m.y, z: m.z });
    const origin = { x: t.x + o.x, y: t.y + o.y, z: t.z + o.z };
    let best = null, end = null;
    for (const [dy, dp] of [[0, 0], [6, 0], [-6, 0], [0, 3], [0, -3]]) {
      const a = ((m.yaw || 0) + dy) * DEG, p = dp * DEG;
      const dir = qrot(q, { x: Math.cos(a) * Math.cos(p), y: Math.sin(p), z: Math.sin(a) * Math.cos(p) });
      const hit = this.sim.world.castRay(new RAPIER.Ray(origin, dir), 4, true, undefined, undefined, undefined, b);
      const d = hit ? (hit.timeOfImpact ?? hit.toi) : null;
      if (dy === 0 && dp === 0) end = { x: origin.x + dir.x * (d ?? 4), y: origin.y + dir.y * (d ?? 4), z: origin.z + dir.z * (d ?? 4) };
      if (d != null && (best == null || d < best)) best = d;
    }
    L.vis = { o: origin, p: end };
    return best;
  }
  // Each tick the beam is sampled; when a measurement is due, the samples of the last timing budget are
  // averaged (that is what the chip integrates), and this run's calibration offset and noise are added.
  // No return in range, or the odd dropout, gives range_status SignalFail instead.
  updateLasers() {
    const E = this.err;
    for (const L of this.lasers) {
      if (!L.running || !L.mount) continue;
      L.buf.push(this.laserRay(L)); if (L.buf.length > 30) L.buf.shift();
      if (this.ms + 1e-6 < L.nextAt) continue;
      L.nextAt += L.periodMs;
      const s = L.buf.slice(-Math.max(1, Math.round(L.budgetMs / (TICK * 1000))));
      const maxR = [1.3, 2.9, 3.6][L.mode] ?? 3.6;   // m, Short / Medium / Long mode, indoor light
      const ok = s.every((d) => d != null);
      const d = ok ? s.reduce((a, v) => a + v, 0) / s.length : null;
      const rd = L.ranging_data;
      if (d == null || d > maxR || d < 0.04 || (E && this.laserRand() < 0.01)) { rd.range_status = 2; rd.range_mm = 0; L.valid = false; }
      else {
        const mm = d * 1000 + (E ? E.laserBias + this.laserGauss() * E.laserNoise * (0.5 + d) : 0);
        rd.range_mm = Math.max(0, Math.round(mm)); rd.range_status = 0; L.valid = true;
      }
      L.ready = true;
    }
  }
  // body vector (x fwd, y up, z right) -> IMU axes (Z up; X as wired)
  imuAxes(vec) {
    const dirs = { forward: [1, 0], back: [-1, 0], right: [0, 1], left: [0, -1] };
    const [fx, fz] = dirs[this.wiring.imuX] || dirs.back;
    // x axis = (fx, 0, fz); z = up; y = z cross x
    const xi = vec.x * fx + vec.z * fz;
    const yi = vec.x * -fz + vec.z * fx;
    return { x: xi, y: yi, z: vec.y };
  }
  readPad() {
    const g = this.gp;
    const p = this.readGamepad ? this.readGamepad() : null;
    const btn = p ? p.buttons : 0;
    g.justP = btn & ~g.prev; g.justR = ~btn & g.prev; g.prev = btn; g.buttons = btn;
    g.lx = p ? p.lx : 0; g.ly = p ? p.ly : 0; g.rx = p ? p.rx : 0; g.ry = p ? p.ry : 0;
  }

  // ---------------------------------------------------------------- outputs -> simulated robot
  applyOutputs(snap = false) {
    const r = this.robot, W = this.wiring;
    // drive: average of the motors on each side, PWM/255, scaled by battery voltage (the sim's motors are rated at 11.5 V)
    const side = { left: [], right: [] };
    for (const m of this.motors) {
      const sd = W.motors[m.cfg.dirPin];
      if (sd !== 'left' && sd !== 'right' || !m._ready) continue;
      let s = m._speed;
      if (s !== 0 && Math.abs(s) < m.cfg.minDrive) s = Math.sign(s) * m.cfg.minDrive;
      if (this.err && Math.abs(s) < this.err.deadband) s = 0;            // too little power to overcome gearbox friction
      const dir = W.trustFlip ? 1 : (m.cfg.flipped ? -1 : 1) * (W.mirrored[sd] ? -1 : 1);
      side[sd].push(dir * s / 255);
    }
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const E = this.err;
    let l0 = avg(side.left), r0 = avg(side.right);
    if (E) { l0 *= 1 + E.trimL / 100; r0 *= 1 + E.trimR / 100; }          // one gearbox/motor stronger than the other
    const sagV = E ? E.sag * (Math.abs(l0) + Math.abs(r0)) / 2 : 0;       // the battery dips under load
    this.batteryNow = Math.max(0, W.battery - sagV);
    const volt = this.batteryNow / 11.5;
    const L = Math.max(-1, Math.min(1, l0 * volt)), R = Math.max(-1, Math.min(1, r0 * volt));
    r.cmd = { throttle: (L + R) / 2, turn: (L - R) / 2, arm: 0 };
    // servos -> mechanisms
    for (const s of this.servos) {
      const map = W.servos[s.cfg.signalPin];
      if (!map || !s._attached || !s._ready) continue;
      if (map.role === 'arm') {
        const deg = Math.max(ROBOT.armMin, Math.min(ROBOT.armMax, ROBOT.armMin + (s._pos - map.floor) * map.scale));
        r.thetaTarget = deg * DEG;
        if (snap) { r.theta = r.thetaTarget; }
      } else if (map.role === 'gripper') this.applyGripper(s._pos, map, snap);
      else if (map.role === 'cargo') {
        const k = Math.max(0, Math.min(1, (s._pos - map.rest) / ((map.dump - map.rest) || 1)));
        r.trayTarget = k * ROBOT.trayDump;
      }
    }
    if (snap) r.updateMechColliders();
  }
  // servo angle -> finger opening. The fingers stop on a CORE they close around (that is a grab);
  // opening them past the ring's width lets go.
  applyGripper(angle, map, snap) {
    const r = this.robot;
    const k = Math.max(0, Math.min(1, (angle - map.open) / ((map.closed - map.open) || 1)));
    const want = ROBOT.fingerOpen + (ROBOT.fingerClosed - ROBOT.fingerOpen) * k;
    if (snap) { r.finger = want; r.fingerTarget = want; r.gripClosed = want < ROBOT.fingerHold; return; }
    if (r.heldCore) {
      if (want > ROBOT.fingerHold + ROBOT.fingerTol / 2) { r.releaseCore(true); r.gripClosed = false; r.fingerTarget = want; }
      else r.fingerTarget = ROBOT.fingerHold;
      return;
    }
    r.fingerTarget = want;
    r.gripClosed = want < ROBOT.fingerHold;
    // closing through the ring's width: grab whatever is between the fingers
    if (want < ROBOT.fingerHold && r.finger >= ROBOT.fingerHold - ROBOT.fingerTol / 3 && r.finger <= ROBOT.fingerHold + ROBOT.fingerTol && r.enabled) {
      const core = r.findGrippableCore();
      if (core) { r.attachCore(core); r.fingerTarget = ROBOT.fingerHold; }
    }
  }
}

// ======================================================================== the names the program sees
function makeEnv(rt) {
  const ms = () => rt.ms;
  const nrlErr = (msg) => { const e = new Error(msg); e.nrl = true; return e; };
  const cfgOf = (a, defaults) => {
    const c = { ...defaults };
    if (a && a.__agg) Object.assign(c, a.named || Object.fromEntries((a.list || []).map((v, i) => [Object.keys(defaults)[i], v])));
    else if (a && typeof a === 'object') Object.assign(c, a);
    return c;
  };

  // ---------------------------------------------------------------- actions (NRLAction.h)
  class Action {
    run() { return true; }
    reset() {}
  }
  const asList = (x) => (Array.isArray(x) ? x : [x]);
  class Instant extends Action { constructor(fn) { super(); this.fn = fn; } run() { this.fn(); return true; } }
  class Sequential extends Action {
    constructor(list) { super(); this.list = asList(list).filter(Boolean); this.i = 0; }
    run() {
      // finished steps fall through in the same tick, so instant() steps cost no time
      for (let n = 0; this.i < this.list.length; n++) {
        if (n > 1000) throw nrlErr('sequential(): more than 1000 steps finished in one tick');
        if (!this.list[this.i].run()) return false;
        this.i++;
      }
      return true;
    }
    reset() { this.i = 0; this.list.forEach((a) => a.reset && a.reset()); }
  }
  class Parallel extends Action {
    constructor(list) { super(); this.list = asList(list).filter(Boolean); this.done = new Set(); }
    run() { this.list.forEach((a, i) => { if (!this.done.has(i) && a.run()) this.done.add(i); }); return this.done.size === this.list.length; }
    reset() { this.done.clear(); this.list.forEach((a) => a.reset && a.reset()); }
  }
  class Sleep extends Action {
    constructor(d) { super(); this.d = d; this.t0 = null; }
    run() { if (this.t0 === null) this.t0 = ms(); return ms() - this.t0 >= this.d; }
    reset() { this.t0 = null; }
  }
  class WaitUntil extends Action { constructor(c) { super(); this.c = c; } run() { return !!this.c(); } }
  class Repeat extends Action {
    constructor(a) { super(); this.a = a; }
    run() { if (this.a.run()) this.a.reset(); return false; }
    reset() { this.a.reset(); }
  }

  // ---------------------------------------------------------------- OpMode base
  class NRLTelemetry {
    addData(key, value) {
      let v;
      if (typeof value === 'number') v = Number.isInteger(value) ? String(value) : value.toFixed(2);
      else if (typeof value === 'boolean') v = value ? '1' : '0';
      else v = String(value);
      rt.telemetry.set(String(key).slice(0, 11), v.slice(0, 15));
    }
    update() {}
    _autoFlush() {}
    _clear() { rt.telemetry.clear(); }
  }
  class NRLOpMode {
    constructor() { this.telemetry = new NRLTelemetry(); this._actions = []; }
    init() {} start() {} loop() {} stop() {}
    runAction(a) {
      if (!a) return;
      if (this._actions.length >= 8) { rt.warnOnce('queue', 'runAction(): more than 8 actions running; this one was dropped (MAX_ACTIONS)'); return; }
      this._actions.push(a);
    }
    runBlocking(a) {
      rt.warnOnce('blocking', 'runBlocking() is run as runAction() in the simulator (the loop keeps ticking while it runs)');
      this.runAction(a);
    }
    cancelActions() { this._actions.length = 0; }
    isActionRunning() { return this._actions.length > 0; }
    _advanceAction() {
      const list = [...this._actions];
      for (const a of list) if (a.run()) { const i = this._actions.indexOf(a); if (i >= 0) this._actions.splice(i, 1); }
    }
  }

  // ---------------------------------------------------------------- hardware
  class HexaDCMotorConfig { constructor(a) { Object.assign(this, cfgOf(a, { dirPin: 0, pwmPin: 0, flipped: false, minDrive: 0 })); } }
  class HexaDCMotor {
    constructor(a) { this.cfg = cfgOf(a, { dirPin: 0, pwmPin: 0, flipped: false, minDrive: 0 }); this._speed = 0; this._ready = false; rt.motors.push(this); }
    begin() { this._ready = true; return true; }
    setSpeed(s) { this._speed = Math.max(-255, Math.min(255, Math.trunc(s) || 0)); }
    getSpeed() { return this._speed; }
    stop() { this._speed = 0; }
    setFlipped(f) { this.cfg.flipped = !!f; }
    isReady() { return this._ready; }
    static stopAll() { for (const m of rt.motors) m._speed = 0; }
  }
  class HexaServoConfig { constructor(a) { Object.assign(this, cfgOf(a, { signalPin: 0, minPulseUs: 500, maxPulseUs: 2500, minAngle: 0, maxAngle: 180, offsetDeg: 0, startAngle: 90, settleMs: 0 })); } }
  class HexaServo {
    constructor(a) {
      this.cfg = cfgOf(a, { signalPin: 0, minPulseUs: 500, maxPulseUs: 2500, minAngle: 0, maxAngle: 180, offsetDeg: 0, startAngle: 90, settleMs: 0 });
      this._pos = this.cfg.startAngle; this._target = this._pos; this._rate = 0; this._ready = false; this._attached = true;
      rt.servos.push(this);
    }
    begin() { this._ready = true; this._pos = this._target = this._clamp(this.cfg.startAngle); return true; }
    _clamp(a) { return Math.max(this.cfg.minAngle, Math.min(this.cfg.maxAngle, Number(a) || 0)); }
    setPosition(a) {
      if (!this._ready) rt.warnOnce(`servo${this.cfg.signalPin}`, `A servo on pin ${this.cfg.signalPin} was moved before begin(); call begin() in init()`);
      this._target = this._clamp(a);
      if (!this._rate) this._pos = this._target;
    }
    moveBy(d) { this.setPosition(this._target + d); }
    getPosition() { return this._pos; }
    getMinAngle() { return this.cfg.minAngle; }
    getMaxAngle() { return this.cfg.maxAngle; }
    isReady() { return this._ready; }
    setRampRate(dps) { this._rate = Math.max(0, dps); }
    detach() { this._attached = false; }
    attach() { this._attached = true; }
    writeMicroseconds(us) { this.setPosition(this.pulseUsToAngle(us)); }
    tick() {}
    angleToPulseUs(a) { return Math.round(this.cfg.minPulseUs + (this._clamp(a) - this.cfg.minAngle) / (this.cfg.maxAngle - this.cfg.minAngle) * (this.cfg.maxPulseUs - this.cfg.minPulseUs)); }
    pulseUsToDuty(us) { return Math.round(us / 20000 * 16383); }
    pulseUsToAngle(us) { return this.cfg.minAngle + (us - this.cfg.minPulseUs) / (this.cfg.maxPulseUs - this.cfg.minPulseUs) * (this.cfg.maxAngle - this.cfg.minAngle); }
    _tick() { if (this._rate && this._pos !== this._target) { const st = this._rate * TICK, d = this._target - this._pos; this._pos = Math.abs(d) <= st ? this._target : this._pos + Math.sign(d) * st; } }
  }
  class TankDrive {
    constructor(left, right) { this._left = left; this._right = right; this._scale = 1; this._maxDelta = 0.1; this._curL = this._curR = this._targetL = this._targetR = 0; rt.drives.push(this); }
    // forward/turn in -1..1; each side is capped at full power (OverdriveTeleOp relies on that)
    drive(forward, turn) {
      const c = (v) => Math.max(-1, Math.min(1, v));
      this._targetL = c(c(forward + turn) * this._scale); this._targetR = c(c(forward - turn) * this._scale);
    }
    stop() { this._targetL = this._targetR = this._curL = this._curR = 0; this._write(); }
    setScale(s) { this._scale = Math.max(0, Math.min(1, s)); }
    getScale() { return this._scale; }
    setRampRate(d) { this._maxDelta = Math.max(0.001, d); }
    static tickAll() {}
    static stopAll() { for (const d of rt.drives) d.stop(); }
    static clearRegistry() {}
    // DriveActions owns its own ramp / soft-start: it writes the output directly
    _direct(l, r) { this._targetL = this._curL = Math.max(-1, Math.min(1, l)); this._targetR = this._curR = Math.max(-1, Math.min(1, r)); this._write(); }
    _tick() {
      const st = (cur, tgt) => (Math.abs(tgt - cur) <= this._maxDelta ? tgt : cur + Math.sign(tgt - cur) * this._maxDelta);
      this._curL = st(this._curL, this._targetL); this._curR = st(this._curR, this._targetR);
      this._write();
    }
    _write() { this._left.setSpeed(Math.round(this._curL * 255)); this._right.setSpeed(Math.round(this._curR * 255)); }
  }
  class DriveTuning {
    constructor(a) {
      Object.assign(this, { driveSpeed: 255, turnSpeed: 255, turnMinSpeed: 80, turnSlowdownDeg: 60, turnToleranceDeg: 2, turnBrakeMs: 200, msPerInch: 18, turnTimeoutMs: 4000, distFuseImuWeight: 0.85, distTimeoutScale: 2.5, driveMinSpeed: 110, driveSlowdownIn: 10 });
      if (a && a.__agg && a.named) Object.assign(this, a.named);
    }
  }
  // ---- DriveActions: open-loop / IMU-fused straight drives, closed-loop gyro turns
  class DriveAction extends Action {
    constructor(owner, kind, args) { super(); this.o = owner; this.kind = kind; this.args = args; this.st = null; }
    reset() { this.st = null; }
    run() {
      const o = this.o, T = o._tuning, d = o._drive;
      if (!this.st) this.st = { t0: ms(), out: 0, phase: 'go' };
      const st = this.st, el = ms() - st.t0;
      const soft = (target) => { st.out = Math.min(target, st.out + 255 * 0.08); return st.out; };   // soft-start: full power in ~0.13 s
      if (this.kind === 'ms') {
        const [dur, speed] = this.args;
        const p = speed === -1 ? T.driveSpeed : speed;
        if (el >= dur) { d.stop(); return true; }
        const out = soft(Math.abs(p));
        d._direct(Math.sign(p || 1) * out / 255, Math.sign(p || 1) * out / 255);
        return false;
      }
      if (this.kind === 'inches') {
        const [inches, speed] = this.args;
        const top = Math.abs(speed === -1 ? T.driveSpeed : speed), dir = Math.sign(inches) || 1, target = Math.abs(inches);
        if (st.model === undefined) { st.model = 0; st.d0 = rt.comms.dist; st.cap = T.distTimeoutScale * target * T.msPerInch * (T.driveSpeed / Math.max(1, top)); }
        const imu = Math.abs(rt.comms.dist - st.d0);
        const w = Math.max(0, Math.min(1, T.distFuseImuWeight));
        const fused = w * imu + (1 - w) * st.model;
        const rem = target - fused;
        if (rem <= 0 || el >= st.cap || top === 0) { d.stop(); return true; }
        let pwm = top;
        if (rem < T.driveSlowdownIn) pwm = Math.max(Math.min(top, T.driveMinSpeed), top * rem / T.driveSlowdownIn);
        const out = soft(pwm);
        d._direct(dir * out / 255, dir * out / 255);
        st.model += (out / Math.max(1, T.driveSpeed)) * (TICK * 1000) / Math.max(0.01, T.msPerInch);
        return false;
      }
      if (this.kind === 'turn' || this.kind === 'turnTo') {
        const [deg, speed] = this.args;
        const top = Math.abs(speed === -1 ? T.turnSpeed : speed);
        if (st.dir === undefined) {
          if (this.kind === 'turn') { rt.comms.heading = 0; st.dir = Math.sign(deg) || 1; st.target = Math.abs(deg); }
          else { const err = deg - rt.comms.heading; st.dir = Math.sign(err) || 1; st.target = deg; }
        }
        const rem = this.kind === 'turn' ? st.target - Math.abs(rt.comms.heading) : st.dir * (st.target - rt.comms.heading);
        if (st.phase === 'go' && (rem <= T.turnToleranceDeg || el >= T.turnTimeoutMs)) {
          if (el >= T.turnTimeoutMs) rt.print(`turn(${deg}) timed out after ${T.turnTimeoutMs} ms`);
          st.phase = 'brake'; st.tb = ms();
        }
        if (st.phase === 'brake') {
          // the pulse cancels the remaining spin: it ends early once the chassis has stopped turning
          const spin = -rt.comms.gyroZ / DEG * st.dir;                 // deg/s in the turn direction
          if (ms() - st.tb >= T.turnBrakeMs || (ms() - st.tb > 20 && spin < 5)) { d.stop(); rt.marks.push({ t: rt.ms, kind: 'turn', deg }); return true; }
          const p = -st.dir * T.turnMinSpeed / 255;
          d._direct(p, -p);
          return false;
        }
        let pwm = top;
        if (rem < T.turnSlowdownDeg) pwm = T.turnMinSpeed + (top - T.turnMinSpeed) * Math.max(0, rem) / T.turnSlowdownDeg;
        const out = soft(pwm);
        d._direct(st.dir * out / 255, -st.dir * out / 255);
        return false;
      }
      return true;
    }
  }
  class DriveActions {
    constructor(drive, tuning) { this._drive = drive; this._tuning = tuning instanceof DriveTuning ? tuning : new DriveTuning(); }
    setTuning(t) { this._tuning = Object.assign(new DriveTuning(), t); }
    tuning() { return this._tuning; }
    turn(deg, speed = -1) { return new DriveAction(this, 'turn', [deg, speed]); }
    turnTo(deg, speed = -1) { return new DriveAction(this, 'turnTo', [deg, speed]); }
    driveForMs(dur, speed = -1) { return new DriveAction(this, 'ms', [dur, speed]); }
    driveInches(inches, speed = -1) { return new DriveAction(this, 'inches', [inches, speed]); }
    stopAll() { return new Instant(() => this._drive.stop()); }
    waitForHeadingReady() { return new WaitUntil(() => { this._drive.stop(); return rt.comms.readyAt <= ms(); }); }
    auto_() {
      const steps = [], self = this;
      const b = {
        turn(d, s = -1) { steps.push(self.turn(d, s)); return b; }, turnTo(d, s = -1) { steps.push(self.turnTo(d, s)); return b; },
        driveForMs(t, s = -1) { steps.push(self.driveForMs(t, s)); return b; }, driveInches(i, s = -1) { steps.push(self.driveInches(i, s)); return b; },
        sleepMs(t) { steps.push(new Sleep(t)); return b; }, waitForHeadingReady() { steps.push(self.waitForHeadingReady()); return b; },
        stopAll() { steps.push(self.stopAll()); return b; }, build() { return new Sequential([...steps]); },
      };
      return b;
    }
  }
  class HexaIMUConfig { constructor(a) { Object.assign(this, cfgOf(a, { i2cAddr: 0x6B, wire: null, sdaPin: -1, sclPin: -1 })); } }
  class HexaIMU {
    constructor() { this._ok = false; this._d = { accelX: 0, accelY: 0, accelZ: 9.81, gyroX: 0, gyroY: 0, gyroZ: 0, tempC: 31 }; this._h = 0; this._ready = 0; rt.imus.push(this); }
    begin() { this._ok = true; this.read(); this._ready = ms() + 500; return true; }
    isReady() { return this._ok; }
    read() {
      const s = rt.sense.body;
      if (!s) return this._ok;
      const a = rt.imuAxes(s.acc), g = rt.imuAxes(s.gyro);
      Object.assign(this._d, { accelX: a.x, accelY: a.y, accelZ: a.z, gyroX: g.x, gyroY: g.y, gyroZ: g.z });
      return this._ok;
    }
    getData() { return { ...this._d }; }
    getAccelX() { return this._d.accelX; } getAccelY() { return this._d.accelY; } getAccelZ() { return this._d.accelZ; }
    getGyroX() { return this._d.gyroX; } getGyroY() { return this._d.gyroY; } getGyroZ() { return this._d.gyroZ; }
    getTemp() { return this._d.tempC; }
    setAccelRange() {} getAccelRange() { return 1; } setGyroRange() {} getGyroRange() { return 0; }
    tick() { this._h -= (rt.sense.body ? rt.sense.body.gyro.y : 0) * TICK / DEG; }
    getHeading() { return this._h; }
    isHeadingReady() { return ms() >= this._ready; }
    zeroHeading() { this._h = 0; }
    resetHeading() { this._h = 0; this._ready = ms() + 500; }
  }
  const NRLComms = {
    getHeading: () => rt.comms.heading,
    isHeadingReady: () => ms() >= rt.comms.readyAt,
    zeroHeading: () => { rt.comms.heading = 0; },
    resetHeading: () => { rt.comms.heading = 0; rt.comms.readyAt = ms() + 500; },
    getDistanceInches: () => rt.comms.dist,
    resetDistance: () => { rt.comms.dist = 0; },
    isPaired: () => true, isReconnecting: () => false, qcCommsOk: () => true, isInputStale: () => false,
    teamNumber: () => Number(rt.robot.number) || 0, teamName: () => rt.robot.name, channel: () => 1,
    dropoutCount: () => 0, longestSilentMs: () => 0, resetLinkStats() {}, tickHeading() {}, tickCalibIMU() {}, tickCalibServoMotor() {}, tickPairing() {},
    sendTelemetryBatch() {}, sendServoState() {}, sendMotorState() {}, sendIMUState() {}, releaseCalibServos() {}, releaseCalibMotors() {}, sendAdvertise() {}, sendStatus() {}, begin() {},
  };
  // VL53L1X laser rangefinder on I2C, with the Pololu VL53L1X library's API. Each one created is fitted
  // where wiring.lasers says (by creation order); with nothing fitted there, init() returns false, like a
  // sensor that isn't plugged in. Measurements come from rt.updateLasers().
  class VL53L1X {
    constructor() {
      this.mount = (rt.wiring.lasers || [])[rt.lasers.length] || null;
      rt.lasers.push(this);
      this.ranging_data = { range_mm: 0, range_status: 255, peak_signal_count_rate_MCPS: 0, ambient_count_rate_MCPS: 0 };
      this.addr = 0x29; this.mode = 2; this.budgetMs = 50; this.periodMs = 50;
      this.running = false; this.ready = false; this.valid = false; this.buf = []; this.vis = null;
    }
    setBus() {} setAddress(a) { this.addr = a; } getAddress() { return this.addr; }
    setTimeout() {} getTimeout() { return 0; } timeoutOccurred() { return false; }
    init() {
      if (!this.mount) { rt.warnOnce('laser-none', 'VL53L1X init() failed: no laser sensor is fitted in the simulator wiring'); return false; }
      return true;
    }
    setDistanceMode(m) { this.mode = Number(m); return true; } getDistanceMode() { return this.mode; }
    setMeasurementTimingBudget(us) { this.budgetMs = Math.max(20, Number(us) / 1000); return true; } getMeasurementTimingBudget() { return this.budgetMs * 1000; }
    setROISize() {} setROICenter() {} getROICenter() { return 199; }
    startContinuous(periodMs) { if (!this.mount) return; this.periodMs = Math.max(Number(periodMs), this.budgetMs); this.running = true; this.nextAt = rt.ms + this.periodMs; }
    stopContinuous() { this.running = false; }
    dataReady() { return this.ready; }
    read(blocking = true) {
      if (blocking && !this.ready) rt.warnOnce('laser-block', 'VL53L1X read() blocks until the next measurement on the robot (up to the timing budget), which stalls the 100 Hz loop. Use dataReady() and read(false).');
      this.ready = false;
      return this.ranging_data.range_mm;
    }
    readRangeContinuousMillimeters(blocking = true) { return this.read(blocking); }
    readSingle(blocking = true) { return this.read(blocking); }
    static rangeStatusToString(s) { return ['range valid', 'sigma fail', 'signal fail', 'range valid min range clipped', 'out of bounds fail', 'hardware fail', 'range valid no wrap check fail', 'wrap target fail', 'xtalk signal fail', 'synchronization int', 'min range fail'][s] || 'none'; }
  }
  Object.assign(VL53L1X, { Short: 0, Medium: 1, Long: 2, Unknown: 3, RangeValid: 0, SigmaFail: 1, SignalFail: 2, RangeValidMinRangeClipped: 3, OutOfBoundsFail: 4, HardwareFail: 5, None: 255 });
  class HexaPowerConfig { constructor(a) { Object.assign(this, cfgOf(a, {})); } }
  class HexaPower {
    begin() { return true; } isReady() { return true; } calibrateCurrentZero() {} read() { return true; }
    _motorA() { return rt.motors.reduce((s, m) => s + Math.abs(m._speed) / 255 * 1.6, 0); }
    getBatteryVoltage() { return rt.batteryNow ?? rt.wiring.battery; }
    getMotorCurrent() { return this._motorA(); }
    getServoCurrent() { return 0.25 * rt.servos.filter((s) => s._ready).length; }
    getMainCurrent() { return this.getMotorCurrent() + this.getServoCurrent(); }
    getData() { return { batteryV: this.getBatteryVoltage(), mainA: this.getMainCurrent(), motorA: this.getMotorCurrent(), servoA: this.getServoCurrent() }; }
    isBatteryLow() { return rt.wiring.battery < 10.5; }
    readRaw() { return 0; } readChannelVoltage() { return 0; } rawAmps() { return 0; }
  }
  class HexaLED {
    constructor(slot) { this.slot = slot; }
    begin() {} tick() {}
    _set(r, g, b, kind) { rt.leds[this.slot === 'bot' ? 'bot' : 'user'] = { r, g, b, kind }; }
    setOff() { this._set(0, 0, 0, 'off'); }
    setSolid(r, g, b) { this._set(r, g, b, 'solid'); }
    setBlink(r, g, b) { this._set(r, g, b, 'blink'); }
    setPulse(r, g, b) { this._set(r, g, b, 'pulse'); }
    stateUnpaired() {} statePairing() {} stateReconnecting() {} stateIdle() {} stateInit() {} stateRunningTeleop() {} stateRunningAuto() {} stateLoopOverrun() {}
  }
  // anything else on the board (OLED, raw NeoPixel strip, I2C bus) accepts every call and does nothing
  const inert = (label) => new Proxy({}, { get: (_, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : () => { rt.warnOnce(`inert-${label}`, `${label} is not simulated (calls are ignored)`); return 0; }) });
  class Gamepad {
    leftX() { return rt.gp.lx; } leftY() { return rt.gp.ly; } rightX() { return rt.gp.rx; } rightY() { return rt.gp.ry; }
    pressed(b) { return (rt.gp.buttons & b) !== 0; }
    justPressed(b) { return (rt.gp.justP & b) !== 0; }
    justReleased(b) { return (rt.gp.justR & b) !== 0; }
    onPress() { rt.warnOnce('onpress', 'gamepad1.onPress() callbacks are not simulated; use justPressed() in loop()'); }
    onRelease() {} snapshot() {} reset() {} ignoreHeldButtons() {}
  }
  const NRLGamepad = { pressed: (b) => (rt.gp.buttons & b) !== 0, update() {}, clear() {}, read() {}, get leftX() { return rt.gp.lx; }, get leftY() { return rt.gp.ly; }, get rightX() { return rt.gp.rx; }, get rightY() { return rt.gp.ry; }, get buttons() { return rt.gp.buttons; } };

  // ---------------------------------------------------------------- C / Arduino helpers
  class __Vec extends Array {
    constructor(n = 0, fill = 0) {
      super();
      const len = typeof n === 'number' ? env.__len(n) : 0;
      for (let i = 0; i < len; i++) this.push(fill);
    }
    push_back(v) { this.push(v); } emplace_back(v) { this.push(v); } pop_back() { this.pop(); }
    size() { return this.length; } empty() { return this.length === 0; } clear() { this.length = 0; }
    at(i) { if (i < 0 || i >= this.length) throw nrlErr(`vector index ${i} out of range (size ${this.length})`); return this[i]; }
    front() { return this[0]; } back() { return this[this.length - 1]; } reserve() {}
    erase(i) { this.splice(typeof i === 'number' ? i : 0, 1); }
  }
  const __list = (arr) => { const v = new __Vec(); v.push(...arr); return v; };
  const serialFmt = (fmt, args) => {
    let i = 0;
    return String(fmt).replace(/%([-+ 0#]*)(\d*)(?:\.(\d+))?([lhz]*)([dioufFeEgGxXcsp%])/g, (m, fl, wd, prec, _l, c) => {
      if (c === '%') return '%';
      const v = args[i++];
      let s;
      if ('di'.includes(c)) s = String(Math.trunc(Number(v)));
      else if ('u'.includes(c)) s = String(Math.trunc(Number(v)) >>> 0);
      else if ('fF'.includes(c)) s = Number(v).toFixed(prec === undefined ? 6 : Number(prec));
      else if ('eE'.includes(c)) s = Number(v).toExponential(prec === undefined ? 6 : Number(prec));
      else if ('gG'.includes(c)) s = String(Number(Number(v).toPrecision(prec === undefined ? 6 : Math.max(1, Number(prec)))));
      else if ('xX'.includes(c)) { s = (Math.trunc(Number(v)) >>> 0).toString(16); if (c === 'X') s = s.toUpperCase(); }
      else if (c === 'c') s = String.fromCharCode(Number(v));
      else s = String(v);
      return wd ? s.padStart(Number(wd), fl.includes('0') && !'sc'.includes(c) ? '0' : ' ') : s;
    });
  };
  const fmtVal = (v, digits) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(digits ?? 2) : typeof v === 'number' && digits !== undefined && digits > 2 ? v.toString(digits === 16 ? 16 : digits === 2 ? 2 : 10) : String(v));
  let serialLine = '';
  const Serial = {
    begin() {}, available: () => 0, read: () => -1, flush() {}, setTimeout() {},
    print(v, d) { serialLine += fmtVal(v, d); if (serialLine.length > 400) { rt.print(serialLine); serialLine = ''; } },
    println(v = '', d) { rt.print(serialLine + fmtVal(v, d)); serialLine = ''; },
    printf(fmt, ...a) { const s = serialFmt(fmt, a); const parts = (serialLine + s).split('\n'); serialLine = parts.pop(); parts.forEach((p) => rt.print(p)); },
  };
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const M = Math;
  const std = {
    min: (a, b) => M.min(a, b), max: (a, b) => M.max(a, b), clamp: (v, lo, hi) => M.min(hi, M.max(lo, v)), abs: M.abs, fabs: M.abs,
    sqrt: M.sqrt, pow: M.pow, round: M.round, floor: M.floor, ceil: M.ceil, sin: M.sin, cos: M.cos, tan: M.tan, atan2: M.atan2, hypot: M.hypot,
    fmod: (a, b) => a % b, isnan: Number.isNaN, isinf: (x) => !Number.isFinite(x) && !Number.isNaN(x), to_string: (v) => String(v), swap() { throw nrlErr('std::swap is not supported'); },
    numeric_limits: { max: () => Number.MAX_VALUE },
  };
  const env = {
    __int: (x) => { const v = Math.trunc(Number(x)); return Number.isFinite(v) ? v : 0; },
    __u8: (x) => (Math.trunc(Number(x)) & 0xff),
    __idiv: (a, b) => { if (Math.trunc(b) === 0) throw nrlErr('integer division by zero'); return Math.trunc(a / b); },
    __list, __Vec,
    __pad: (arr, n) => { const out = Array.from(arr); while (out.length < n) out.push(0); return out; },   // C fills the rest of an array with 0
    __aggregate: (obj, agg, fields) => { if (agg.named) Object.assign(obj, agg.named); else (agg.list || []).forEach((v, i) => { if (fields[i]) obj[fields[i]] = v; }); },
    __guard: () => { if (++rt.guardCount > 2e6) throw nrlErr('Your code ran a loop or function 2,000,000 times in one tick. On the robot this freezes the 100 Hz loop; use an action (wait_until / sleep_ms) instead of a busy loop, and check recursion has a base case.'); },
    __len: (n) => {
      const v = Math.trunc(Number(n));
      if (!Number.isFinite(v) || v < 0 || v > 100000) throw nrlErr(`Array size ${n} is out of range (0 to 100,000 elements)`);
      rt.allocCount = (rt.allocCount || 0) + v;
      if (rt.allocCount > 2e6) throw nrlErr('Your arrays add up to more than 2,000,000 elements. The robot has nowhere near that much memory; use smaller arrays.');
      return v;
    },
    __String: (v, d) => fmtVal(v ?? '', d),
    __ix: (i) => { if (typeof i !== 'number' && typeof i !== 'boolean') throw new RuntimeError('Array index must be a number'); return i; },
    // actions
    Action, instant: (fn) => new Instant(fn), sequential: (l) => new Sequential(l), parallel: (l) => new Parallel(l),
    sleep_ms: (d) => new Sleep(Number(d)), wait_until: (c) => new WaitUntil(c), repeat: (a) => new Repeat(a),
    NRLOpMode, NRLTelemetry,
    // hardware
    HexaDCMotor, HexaDCMotorConfig, HexaServo, HexaServoConfig, TankDrive, DriveTuning, DriveActions, HexaIMU, HexaIMUConfig,
    HexaIMUData: class { constructor() { Object.assign(this, { accelX: 0, accelY: 0, accelZ: 0, gyroX: 0, gyroY: 0, gyroZ: 0, tempC: 0 }); } },
    HexaPower, HexaPowerConfig, HexaPowerData: class { constructor() { Object.assign(this, { batteryV: 0, mainA: 0, motorA: 0, servoA: 0 }); } },
    VL53L1X,
    HexaLED, HexaOLED: class { constructor() { return inert('The OLED'); } }, HexaOLEDConfig: class { constructor(a) { Object.assign(this, cfgOf(a, {})); } },
    Adafruit_NeoPixel: class { constructor() { return inert('A NeoPixel strip'); } }, TwoWire: class { constructor() { return inert('An I2C bus'); } },
    Gamepad, NRLGamepad, NRLComms,
    power: new HexaPower(), gamepad1: new Gamepad(), userLed: new HexaLED('user'), botLed: new HexaLED('bot'), botOled: inert('The OLED'), nrlLedStrip: inert('The status LED strip'),
    Wire: inert('The I2C bus'), Wire1: inert('The I2C bus'), Serial,
    hexaImuConfig: () => new HexaIMUConfig(), hexaOledConfig: () => ({}), nrlBootCount: () => 1, nrlLastResetReason: () => 1,
    OpModeType: { TELEOP: 'TELEOP', AUTO: 'AUTO' }, TELEOP: 'TELEOP', AUTO: 'AUTO',
    HEXA_ACCEL_RANGE_2G: 0, HEXA_ACCEL_RANGE_4G: 1, HEXA_ACCEL_RANGE_8G: 2, HEXA_ACCEL_RANGE_16G: 3, HEXA_GYRO_RANGE_250_DPS: 0, HEXA_GYRO_RANGE_500_DPS: 1, HEXA_GYRO_RANGE_1000_DPS: 2, HEXA_GYRO_RANGE_2000_DPS: 3,
    std,
    // Arduino / libm
    millis: () => Math.floor(rt.ms), micros: () => Math.floor(rt.ms * 1000),
    delay: () => rt.warnOnce('delay', 'delay() would freeze the robot\'s 100 Hz loop and is skipped in the simulator; use sleep_ms() inside an action'),
    delayMicroseconds: () => {},
    constrain: (v, lo, hi) => M.min(hi, M.max(lo, v)),
    map: (x, a, b, c, d) => Math.trunc((x - a) * (d - c) / (b - a) + c),
    abs: M.abs, min: (a, b) => M.min(a, b), max: (a, b) => M.max(a, b), sq: (x) => x * x,
    sqrt: M.sqrt, sqrtf: M.sqrt, pow: M.pow, powf: M.pow, sin: M.sin, cos: M.cos, tan: M.tan, asin: M.asin, acos: M.acos, atan: M.atan, atan2: M.atan2,
    tanh: M.tanh, tanhf: M.tanh, sinh: M.sinh, cosh: M.cosh,
    sinf: M.sin, cosf: M.cos, tanf: M.tan, asinf: M.asin, acosf: M.acos, atanf: M.atan, atan2f: M.atan2,
    fabs: M.abs, fabsf: M.abs, fmin: M.min, fmax: M.max, fminf: M.min, fmaxf: M.max, fmod: (a, b) => a % b, fmodf: (a, b) => a % b,
    round: (x) => M.sign(x) * M.round(M.abs(x)), roundf: (x) => M.sign(x) * M.round(M.abs(x)), lround: (x) => M.sign(x) * M.round(M.abs(x)), lroundf: (x) => M.sign(x) * M.round(M.abs(x)),
    floor: M.floor, floorf: M.floor, ceil: M.ceil, ceilf: M.ceil, trunc: M.trunc, truncf: M.trunc, exp: M.exp, expf: M.exp, log: M.log, logf: M.log, log10: M.log10, hypot: M.hypot, hypotf: M.hypot,
    copysign: (a, b) => M.abs(a) * (b < 0 || Object.is(b, -0) ? -1 : 1), copysignf: (a, b) => M.abs(a) * (b < 0 ? -1 : 1),
    isnan: Number.isNaN, isinf: (x) => !Number.isFinite(x) && !Number.isNaN(x),
    random: (a, b) => (b === undefined ? Math.floor(rnd() * a) : a + Math.floor(rnd() * (b - a))), randomSeed: (s) => { seed = Math.trunc(s) || 1; },
    tone() {}, noTone() {}, pinMode() {}, digitalWrite() {}, digitalRead: () => 1, analogRead: () => 0, analogWrite() {}, $yield() {},
    radians: (d) => d * DEG, degrees: (r) => r / DEG,
    snprintf: () => { throw nrlErr('snprintf into char buffers is not supported; pass numbers to telemetry.addData directly'); },
    sprintf: () => { throw nrlErr('sprintf into char buffers is not supported; pass numbers to telemetry.addData directly'); },
    strcmp: (a, b) => (a === b ? 0 : a < b ? -1 : 1), strlen: (s) => String(s).length,
    itoa: () => { throw nrlErr('itoa is not supported'); }, dtostrf: () => { throw nrlErr('dtostrf is not supported'); },
    PI: M.PI, HALF_PI: M.PI / 2, TWO_PI: M.PI * 2, DEG_TO_RAD: DEG, RAD_TO_DEG: 1 / DEG, M_PI: M.PI, M_PI_2: M.PI / 2, EULER: M.E,
    HIGH: 1, LOW: 0, INPUT: 1, OUTPUT: 3, INPUT_PULLUP: 5, INPUT_PULLDOWN: 9, FLT_MAX: 3.4028235e38, INT_MAX: 2147483647, INT_MIN: -2147483648, UINT32_MAX: 4294967295,
    ...PINS, ...BTN,
  };
  return env;
}
