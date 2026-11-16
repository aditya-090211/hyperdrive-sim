// Auto planner: the route model, its planned poses, presets and the HexaNRL OpMode generator.
// Coordinates are field-diagram inches (X right, Y down from the top-left corner, Red drives from Y = 0).
// Headings are what the robot's gyro reports (NRLComms): 0 = the start heading, + = clockwise.
import { ROBOT } from '../config.js';
import { SIM_MS_PER_INCH } from '../nrl.js';

export const IN = 0.0254;
const DEG = Math.PI / 180;
export const wrap180 = (a) => { let x = ((a + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };
export const r1 = (v) => Math.round(v * 10) / 10;
let nextId = 1;
export const newId = () => `s${Date.now().toString(36)}${(nextId++).toString(36)}`;

// world metres -> diagram inches
export const toDiag = (x, z) => [x / IN + 72, z / IN + 72];

// robot start pose in diagram terms: centre and the direction it faces (deg, screen-style: 0 = +X, 90 = +Y)
export function startOf(robot) {
  const s = robot.startPose();
  const [X, Y] = toDiag(s.x, s.z);
  return { X, Y, th0: -s.yaw / DEG, robot };
}
// how far ahead of the robot centre the claw holds a CORE (inches) at an arm servo angle
export const leadOf = (start, servo, cal) => (start.robot ? start.robot.holdLocal(armDegOf(servo, cal) * DEG).x / IN : 8.5);

// servo calibration from the Robot code wiring (Servo 1 = arm, Servo 2 = claw by default)
export function servoCal(wiring) {
  const sv = Object.entries(wiring?.servos || {});
  const arm = sv.find(([, s]) => s.role === 'arm'), claw = sv.find(([, s]) => s.role === 'gripper');
  return {
    armPin: arm ? Number(arm[0]) : 39, floor: arm ? arm[1].floor : 115, scale: arm ? arm[1].scale || -1 : -1,
    clawPin: claw ? Number(claw[0]) : 40, open: claw ? claw[1].open : 15, closed: claw ? claw[1].closed : 90,
  };
}
export const armDegOf = (servo, cal) => ROBOT.armMin + (servo - cal.floor) * cal.scale;
export const servoOfArm = (deg, cal) => Math.round(cal.floor + (deg - ROBOT.armMin) / cal.scale);
// arm positions the AI uses (js/ai.js): the ring clears a Star Pole at 36 deg and a High Pole at 48 deg
export const ARM_PRESETS = [['Floor', ROBOT.armMin], ['Star pole', 36], ['High pole', 48], ['Up', 90]];

// a sensible wait for a servo move: the arm swings at about 150 deg/s
export const armWait = (from, to) => Math.min(2000, Math.round((Math.abs(to - from) / 150 * 1000 + 150) / 50) * 50);

export const SETTLE_DEFAULT = 250;   // ms after each drive (the robot coasts 1 to 2 in once the motors stop)
export const STEP_KINDS = { drive: 'Drive', turn: 'Turn', arm: 'Arm', claw: 'Claw', wait: 'Wait' };

// Walk the route and return the planned state after every step. Each entry: the pose (X, Y, th = direction
// on the diagram, h = unwrapped gyro heading), the arm/claw servo angles, and for drives the leg length and
// whether a turn comes first. Times are rough estimates for the 60 s budget.
export function plan(route, start, cal) {
  let X = start.X, Y = start.Y, h = 0, arm = route.armStart ?? cal.floor, claw = route.clawStart ?? cal.open, t = 0.5;
  const out = [];
  for (const s of route.steps) {
    const e = { kind: s.kind, turn: null, len: 0 };
    if (s.kind === 'drive') {
      // tool: the point is where the claw should end up (forward drives only); the robot centre stops
      // the claw's reach short of it. ax/ay: the tuner's aim offset. The code drives at the offset point
      // so the robot ends on the planned one.
      let tx = s.x, ty = s.y;
      const tool = s.tool && !s.rev;
      if (tool) {
        const lead = leadOf(start, arm, cal), d = Math.hypot(s.x - X, s.y - Y);
        if (d > lead + 0.5) { tx = s.x - (s.x - X) / d * lead; ty = s.y - (s.y - Y) / d * lead; } else { tx = X; ty = Y; }
        e.lead = lead;
      }
      const dx = tx - X, dy = ty - Y, len = Math.hypot(dx, dy);
      const gx = tx + (s.ax || 0) - X, gy = ty + (s.ay || 0) - Y, glen = Math.hypot(gx, gy);
      if (len >= 0.5 && glen >= 0.5) {
        const face = Math.atan2(gy, gx) / DEG + (s.rev ? 180 : 0);
        const hn = h + wrap180(face - start.th0 - h);
        if (Math.abs(hn - h) > 0.5) { e.turn = hn; t += 0.25 + Math.abs(hn - h) / 110; h = hn; }
        e.len = len; e.glen = glen; e.dir = s.rev ? -1 : 1;
        e.ux = dx / len; e.uy = dy / len;
        t += 0.3 + len / 40 + (route.settle ?? SETTLE_DEFAULT) / 1000;
      } else if (tool && Math.hypot(s.x - X, s.y - Y) > 0.5) {
        // already within reach: just face the point
        const hn = h + wrap180(Math.atan2(s.y - Y, s.x - X) / DEG - start.th0 - h);
        if (Math.abs(hn - h) > 0.5) { e.turn = hn; t += 0.25 + Math.abs(hn - h) / 110; h = hn; }
      }
      if (tool) e.tool = { X: s.x, Y: s.y };
      X = tx; Y = ty;
    } else if (s.kind === 'turn') {
      const hn = h + wrap180(s.h - h);
      if (Math.abs(hn - h) > 0.05) { e.turn = hn; t += 0.25 + Math.abs(hn - h) / 110; }
      h = hn;
    } else if (s.kind === 'arm') { arm = s.a; t += (s.ms || 0) / 1000; }
    else if (s.kind === 'claw') { claw = s.open ? cal.open : cal.closed; t += (s.ms || 0) / 1000; }
    else if (s.kind === 'wait') t += (s.ms || 0) / 1000;
    Object.assign(e, { X, Y, h, th: start.th0 + h, arm, claw, t });
    out.push(e);
  }
  return out;
}

// one-line description of a step (list, code comments, test table)
export function describe(s, cal) {
  if (s.kind === 'drive') return `${s.rev ? 'Reverse' : 'Drive'} ${s.tool && !s.rev ? 'the claw ' : ''}to (${r1(s.x)}, ${r1(s.y)})`;
  if (s.kind === 'turn') return `Turn to ${r1(wrap180(s.h))}°`;
  if (s.kind === 'arm') return `Arm to servo ${s.a} (${r1(armDegOf(s.a, cal))}° arm)`;
  if (s.kind === 'claw') return s.open ? 'Open the claw' : 'Close the claw';
  return `Wait ${s.ms} ms`;
}

const f1 = (v) => `${(Math.round(v * 10) / 10).toFixed(1)}f`;
export const opNameOf = (route) => (String(route.name || '').replace(/[^A-Za-z0-9_]/g, '').replace(/^[^A-Za-z_]+/, '') || 'PlannerAuto');

// ---- the OpMode source. Every finished step prints "STEP n" on Serial: it shows progress in the HUD log,
// and the planner's test runs read it to know where each step ended.
export function generate(route, robot, cal) {
  const start = startOf(robot), P = plan(route, start, cal), name = opNameOf(route);
  const armStart = route.armStart ?? cal.floor, clawStart = route.clawStart ?? cal.open;
  const settle = Math.max(0, Math.round(route.settle ?? SETTLE_DEFAULT));
  const L = [];
  route.steps.forEach((s, i) => {
    const p = P[i], n = i + 1;
    L.push('', `      // ${n}. ${describe(s, cal)}`);
    if (s.kind === 'drive') {
      if (p.turn !== null) L.push(`      driveActions.turnTo(${f1(p.turn)}),`);
      if (p.len >= 0.5) {
        const tuned = s.ax || s.ay;
        L.push(`      driveActions.driveInches(${f1(p.dir * p.glen)}),${tuned ? `   // plan ${r1(p.len)} in; tuned on the simulator` : ''}`);
        if (settle) L.push('      sleep_ms(SETTLE_MS),');
      }
    } else if (s.kind === 'turn') {
      if (p.turn !== null) L.push(`      driveActions.turnTo(${f1(p.turn)}),`);
    } else if (s.kind === 'arm') {
      L.push(`      instant([]() { arm.setPosition(${Math.round(s.a)}); }),`);
      if (s.ms) L.push(`      sleep_ms(${Math.round(s.ms)}),`);
    } else if (s.kind === 'claw') {
      L.push(`      instant([]() { claw.setPosition(${s.open ? 'CLAW_OPEN' : 'CLAW_CLOSED'}); }),`);
      if (s.ms) L.push(`      sleep_ms(${Math.round(s.ms)}),`);
    } else if (s.kind === 'wait') L.push(`      sleep_ms(${Math.round(s.ms || 0)}),`);
    L.push(`      instant([]() { Serial.println("STEP ${n}"); }),`);
  });
  const end = P[P.length - 1] || { X: start.X, Y: start.Y, t: 0 };
  const pin = (p) => ({ 39: 'SERVO_1', 40: 'SERVO_2', 41: 'SERVO_3', 42: 'SERVO_4' }[p] || 'SERVO_1');
  return `// ${name}.cpp: generated by the HYPERDRIVE Auto planner
// Robot: ${robot.name}, starting at (${r1(start.X)}, ${r1(start.Y)}) facing the field.
// Route: ${route.steps.length} steps, ends at (${r1(end.X)}, ${r1(end.Y)}), about ${Math.round(end.t)} s of the 60 s AUTO.
// Headings are absolute (turnTo): 0 = the start heading, + = clockwise. Distances are inches (driveInches).
// Each finished step prints "STEP n" on Serial.
#include "NRL.h"

constexpr float MS_PER_INCH = ${SIM_MS_PER_INCH}.0f;   // drive calibration: measure it on your robot
constexpr int DRIVE_PWM = 170;
constexpr int TURN_PWM = 150;
${settle ? `constexpr int SETTLE_MS = ${settle};        // the robot coasts after a drive: let it stop before the next move
` : ''}constexpr int ARM_START = ${Math.round(armStart)};        // servo angle (${r1(armDegOf(armStart, cal))}° arm)
constexpr int CLAW_OPEN = ${Math.round(cal.open)};
constexpr int CLAW_CLOSED = ${Math.round(cal.closed)};

HexaDCMotor leftMotor({.dirPin = MOTOR_L_DIR, .pwmPin = MOTOR_L_PWM, .flipped = true});
HexaDCMotor rightMotor({.dirPin = MOTOR_R_DIR, .pwmPin = MOTOR_R_PWM, .flipped = false});
HexaServo arm({.signalPin = ${pin(cal.armPin)}, .startAngle = ARM_START});
HexaServo claw({.signalPin = ${pin(cal.clawPin)}, .startAngle = ${clawStart === cal.closed ? 'CLAW_CLOSED' : 'CLAW_OPEN'}});
TankDrive drive(leftMotor, rightMotor);
DriveTuning tuning{.driveSpeed = DRIVE_PWM, .turnSpeed = TURN_PWM, .msPerInch = MS_PER_INCH};
DriveActions driveActions(drive, tuning);

class ${name} : public NRLOpMode {
public:
  void init() override {
    leftMotor.begin();
    rightMotor.begin();
    arm.begin();
    claw.begin();
    NRLComms::resetHeading();
  }

  void start() override {
    runAction(sequential({
      driveActions.waitForHeadingReady(),${L.join('\n')}
      driveActions.stopAll(),
    }));
  }

  void loop() override {
    telemetry.addData("Heading", NRLComms::getHeading());
  }
};

REGISTER_OPMODE(${name}, "${name}", AUTO);
`;
}

// ---- starter routes, written for Red 1 and mapped onto the chosen robot (mirrored for Red 2, turned 180°
// for Blue 1, both for Blue 2), so every robot gets the same route on its own side.
const PRESETS = [
  {
    id: 'star', name: 'StarPoleAuto', label: 'Spike CORE to the Star Pole (48, 12)',
    note: 'Drives between the High Poles to the spike-mark CORE at (48, 88.2), grabs it, comes back and drops it on the Star Pole at (48, 12) from the field side, then backs off.',
    // aim: the drive tuner's result for Red 1 on the simulated robot (wiring defaults), in inches
    steps: [
      { kind: 'drive', x: 60, y: 58, aim: [0, -2.2] },
      { kind: 'drive', x: 48, y: 70, aim: [2, -0.9] },
      { kind: 'drive', x: 48, y: 88.2, tool: true, aim: [-0.5, -1.7] },
      { kind: 'claw', open: false, ms: 400 },
      { kind: 'arm', deg: 36, ms: 500 },
      { kind: 'drive', x: 60, y: 64, rev: true, aim: [-0.4, 1.6] },
      { kind: 'drive', x: 60, y: 32, aim: [-0.9, 3.5] },
      { kind: 'drive', x: 48, y: 32, aim: [2.5, -0.7] },
      { kind: 'drive', x: 48, y: 12, tool: true, aim: [-0.6, 2.4] },
      { kind: 'claw', open: true, ms: 500 },
      { kind: 'drive', x: 48, y: 32, rev: true, aim: [-0.5, -1.6] },
      { kind: 'arm', deg: ROBOT.armMin, ms: 400 },
    ],
  },
  {
    id: 'outback', name: 'OutAndBackAuto', label: 'Forward 48 in and back',
    note: 'Drives straight out of the start zone and reverses back to just in front of the wall.',
    steps: [
      { kind: 'drive', x: 60, y: 54, aim: [0, -2] },
      { kind: 'wait', ms: 500 },
      { kind: 'drive', x: 60, y: 12, rev: true, aim: [-2.2, 2.7] },
    ],
  },
];
export const presetList = () => PRESETS.map((p) => ({ id: p.id, label: p.label, note: p.note }));

export function presetRoute(id, robotIdx, cal) {
  const p = PRESETS.find((q) => q.id === id) || PRESETS[0];
  // robot index -> map from Red 1 coordinates
  const map = [(x, y) => [x, y], (x, y) => [144 - x, y], (x, y) => [144 - x, 144 - y], (x, y) => [x, 144 - y]][robotIdx] || ((x, y) => [x, y]);
  const mirrored = robotIdx === 1 || robotIdx === 3;
  const vec = ([ax, ay]) => { const [a, b] = map(ax + 72, ay + 72); return [r1(a - 72), r1(b - 72)]; };   // the maps reflect about the centre
  let prevArm = cal.floor;
  const steps = p.steps.map((s) => {
    const o = { id: newId(), kind: s.kind };
    if (s.kind === 'drive') { const [x, y] = map(s.x, s.y); Object.assign(o, { x, y, rev: !!s.rev, tool: !!s.tool }); if (s.aim) [o.ax, o.ay] = vec(s.aim); }
    else if (s.kind === 'turn') o.h = mirrored ? -s.h : s.h;
    else if (s.kind === 'arm') { o.a = servoOfArm(s.deg, cal); o.ms = s.ms ?? armWait(armDegOf(prevArm, cal), s.deg); prevArm = o.a; }
    else if (s.kind === 'claw') Object.assign(o, { open: s.open, ms: s.ms ?? 300 });
    else o.ms = s.ms;
    return o;
  });
  return { name: p.name, robot: robotIdx, steps, armStart: cal.floor, clawStart: cal.open, settle: SETTLE_DEFAULT };
}

// "tuned (+1.2, -0.4)" for a drive the tuner has adjusted
export const tunedText = (s) => (s.ax || s.ay ? `aim ${s.ax >= 0 ? '+' : ''}${r1(s.ax || 0)}, ${s.ay >= 0 ? '+' : ''}${r1(s.ay || 0)} in` : '');
