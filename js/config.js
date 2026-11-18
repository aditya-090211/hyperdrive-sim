// NRL 2026 HYPERDRIVE — all game constants. Geometry comes from the official field CAD
// (Field Assembly Final.step) and NRL_2026_Official_Arena_Dimensions.pdf; rules and points from
// NRL_2026_HYPERDRIVE_GAME_MANUAL.pdf. Values marked ASSUMPTION are given by neither.
//
// World frame: meters, +Y up from the tile surface. Field diagram coordinates are inches measured
// from the top-left inner corner: X to the right, Y down. Red drives from the top (Y = 0),
// Blue from the bottom (Y = 144). The field is 180° rotationally symmetric.

// interface faces drawn into canvas textures (labels, number plates, field signs)
export const CANVAS_FONT = '"Instrument Sans", system-ui, sans-serif';

export const IN = 0.0254;
export const FIELD_IN = 144;                       // 12 ft x 12 ft inside the walls
export const FIELD = FIELD_IN * IN;                // 3.6576 m
export const HALF = FIELD / 2;
// CAD: 0.75 in walls, 7 in tall from the arena floor, which sits 0.74 in below the tile surface
export const WALL = { height: 6.26 * IN, thick: 0.75 * IN, ground: -0.74 * IN };
export const TILE = 24 * IN;                       // 36 foam tiles, 24 in

// diagram inches -> world x/z
export const wx = (X) => (X - 72) * IN;
export const wz = (Y) => (Y - 72) * IN;
export const rot180 = ([X, Y]) => [FIELD_IN - X, FIELD_IN - Y];

export const MATCH = {
  length: 150,          // 2:30 (4.4)
  levelUp: 30,          // final 30 s (4.4)
  starburstThreshold: 10,   // Table 4.5.2 regional
  payloadReduction: 6,      // 4.5.1 -> reduced threshold 4
  sourceZoneCap: 6,         // G4.3
  hpCores: 20,              // 3.4.1: 20 per squad at the HP station
  controlLimit: 2,          // G4.2
};

export const POINTS = {
  core: { high: 3, star: 5, apex: 9, drop: 1 },
  golden: { star: 7, drop: 3 },
  station: { engage: 3, dock: 8, balance: 15 },
  starBonus: 10, payloadBonus: 10,
  minorFoul: 3, majorFoul: 15,
};

export const RP = {               // Table 4.5.1 / 4.5.2 (Regional Championship values)
  win: 3, tie: 1,
  starburstCores: 12,             // "SUPERCHARGE RP 12 Cores"
  patternPoints: 36,              // STAR-MAP RP 36 points
  levelUpPoints: 25,              // LEVEL-UP RP 25 points
};

// ---------- scoring elements ----------
export const CORE = {               // 3.4.1
  rOut: 0.095 / 2, rIn: 0.055 / 2, h: 0.030, mass: 0.040,
};
export const PAYLOAD = {            // 3.4.3: must fit a 4 in cube, > 2 in cube, <= 400 g
  size: 0.100,                      // ASSUMPTION: team payload modelled as a 100 mm cube
  mass: 0.200,                      // ASSUMPTION: 200 g (rule only caps it at 400 g)
};

// ---------- field elements (red; blue is rot180) ----------
// Pole heights are the CAD part tops (arena sheet: HIGH 5.2 in, STAR 4.3 in assembly height)
export const POLE = {
  r: 1.05 * IN / 2,                 // 1 in pipe (1.05 in OD)
  baseR: 2.0 * IN,                  // Ø4 in base cup, 1 in tall (top 0.85 in above the tiles)
  baseH: 0.85 * IN,
  capR: 0.985 * IN, capH: 0.51 * IN, // Ø1.97 in domed cap: passes through the 55 mm CORE hole
  high: { top: 5.13 * IN, cap: 4 },
  star: { top: 4.14 * IN, cap: 3 },
  // mounted 0.5 in off the wall: a threaded CORE rests on the wall top (6.26 in) under a Ø1.1 in cap at 14.22 in
  apex: { top: 14.22 * IN, base: 6.26 * IN, capR: 0.55 * IN, capH: 1.22 * IN, cap: 6 },
};

export const RED = {
  startZone: { x0: 48, x1: 96, y0: 0, y1: 24 },                       // 48 x 24 in (two red tiles)
  dropZone: [[0, 0], [24, 0], [0, 24]],                                // half of the corner tile
  sourceZone: [[0, 144], [0, 120], [24, 144]],                         // diagonal tape across the corner tile
  vault: [24.1, 141.4],                                                // CAD: silo centre 2.6 in off the wall
  vaultZoneR: 15,                     // ASSUMPTION: 15 in radius half-disc around the vault
  starPoles: [[48, 12], [96, 12]],
  highPoles: [[48, 48], [72, 48], [96, 48]],
  spikeMarks: [[72, 76.5], [48, 88.2], [96, 88.2]],                    // red COREs (CAD ring markers)
  station: { cx: 13.16, cy: 72 },                                      // pivot bearings, left wall
  apexPoles: [[0.5, 65.9], [0.5, 78.1]],                               // "Ramp scoring pipes" clamped to the wall
  starburstButton: [-13.2, -13.2],                                     // 3 ft pillar outside the corner
  trifron: [-16, 72],
  driverArea: { x0: 32, x1: 112, y0: -27, y1: -2 },                    // 80 x 25 in
  hpRacks: [[-19.7, 132.2, 3], [-14.5, 132.2, 4], [-9.2, 132.2, 3], [-19.7, 140.1, 3], [-14.5, 140.1, 4], [-9.2, 140.1, 3]],
};

export const VAULT = {              // CAD silo: Ø4 in acrylic tube from 1.78 in to 7.69 in, Ø4.87 in cap on top
  rIn: 0.0485, rOut: 0.0508, top: 7.69 * IN, gap: 1.78 * IN, capR: 2.43 * IN, capTop: 7.88 * IN, cores: 6,
};

// Space Station: the CAD gives every dimension (deck, ramps and pivot are read from assets/field.json at load).
export const STATION = {
  maxTilt: 15 * Math.PI / 180,      // hard stops (arena sheet: 15° ±5° unbalanced)
  levelTol: 2.5 * Math.PI / 180,    // arena sheet: balanced = 147° ±2.5°
  deckMass: 4.5, rampMass: 1.4,     // ASSUMPTION: polycarbonate panels with aluminium frames
  // pivot bearing: static / sliding friction torque (N·m) and viscous damping (N·m·s/rad)
  pivotStatic: 1.1, pivotKinetic: 0.75, pivotDamping: 4,
};

// ---------- robot (OVERDRIVE_009_FINAL_ROBOT_v3.step, the team's final CAD) ----------
export const ROBOT = {
  mass: 3.2,                // ASSUMPTION: estimated from the CAD (aluminium plates, 4 gear motors, 3S pack); R1.2 caps it at 8 kg
  wheelR: 0.055,            // CAD: 110 mm wheels with moulded grip
  motorFreeRPM: 300,        // ASSUMPTION: 37 mm 12 V 300 RPM gear motor
  motorStallTorque: 1.0,    // ASSUMPTION: N·m at the wheel at 12 V
  motorStallAmps: 5.5,      // ASSUMPTION: per motor at 12 V
  battery: { volts: 11.5, rInt: 0.09 }, // 3S LiPo: nominal volts and internal resistance (Ω) incl. wiring
  gearHold: 2.4,            // N per wheel static back-drive resistance of the gearbox
  mu: 0.95,                 // rubber on EVA foam (static)
  muKinetic: 0.78,          // sliding / scrubbing
  rollCrr: 0.035,           // rolling resistance of a rubber tyre on 12 mm EVA foam
  armMin: -16.2, armMax: 90, // deg (CAD: gripper 0.5 mm above the floor at -16.2°)
  armRate: 150, servoMax: 300, // deg/s (driver command rate, servo no-load speed)
  // claw angle per finger (rad): 0 = the CAD pose, closed around a CORE; positive opens outward
  fingerClosed: -0.17, fingerOpen: 0.44, fingerHold: 0.0, fingerTol: 0.06,
  fingerRate: 4.5,          // rad/s
  trayDump: 115, trayRate: 260,
};

export const COLORS = {
  red: 0xc4202b, blue: 0x1d48c8, gold: 0xe9a81a,
  redTape: 0xe0262c, blueTape: 0x2050e0,
  tile: 0x9a9fa6, wall: 0x1b1e23,
};

export const TEAMS = [
  { id: 0, name: 'Red 1', squad: 'red', number: '009',    startX: 60 },
  { id: 1, name: 'Red 2', squad: 'red', number: '1002', startX: 84 },
  { id: 2, name: 'Blue 1', squad: 'blue', number: '2001', startX: 84 },
  { id: 3, name: 'Blue 2', squad: 'blue', number: '2002', startX: 60 },
];

// helpers producing blue coordinates
export function squadPoint(squad, p) { return squad === 'red' ? p : rot180(p); }
export function squadPoly(squad, poly) { return poly.map((p) => squadPoint(squad, p)); }
