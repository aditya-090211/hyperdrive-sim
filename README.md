# NRL 2026 HYPERDRIVE simulator — by team Overdrive 009

A 3D physics simulation of the NRL 2026 season game **HYPERDRIVE**. The arena is built from the official field CAD
(`Field Assembly Final.step`) and `NRL_2026_Official_Arena_Dimensions.pdf`, the robot model from `OVERDRIVE_009_FINAL_ROBOT_v3.step` (its physics colliders are still the ones measured on the earlier `NRL-2026 Robot.step`),
and the rules from `NRL/NRL_2026_HYPERDRIVE_GAME_MANUAL.pdf`.
It has four independently controlled robots (2 Red + 2 Blue), the full 12 × 12 ft field with every
game element, Human Player actions, the 2:30 match flow, live scoring, automatic fouls and Ranking Points.

**Live:** <https://overdrive009.in> · Scout: <https://scout.overdrive009.in> · Viora, our Changemakers project: <https://overdrive009.in/viora> (also <https://viora.overdrive009.in>)

### Domains

`vercel.json` sends every old address to the new ones:

* `scout.overdrive009.in/` redirects to `/scout` on the same host, so Scout's offline data stays on that origin. (Vercel serves a real file such as `index.html` before applying rewrites, so a rewrite of `/` would show the home page.)
* `overdrive009.in/scout` redirects to `scout.overdrive009.in`, and `www.` redirects to the bare domain.
* `overdrive009.in/viora/` is the Viora app (the `viora/` folder; `/viora` redirects to `/viora/`). `viora.overdrive009.in` redirects there too,
  keeping the path, so all Viora data lives in one origin. The app's team sync calls `/api/team/…`, which is proxied to the original
  deployment at viora-lemon.vercel.app (its serverless function and Redis store).
* `hyperdrive-sim.vercel.app` redirects every page to `overdrive009.in`, except Scout and the files it needs. Phones that
  installed Scout there keep their unsynced entries in that origin's storage, so Scout keeps running there with a
  "Scout has moved" note until those entries have synced.
* Accounts are stored per origin, so Scout on its subdomain asks for one sign-in there.

Add `overdrive009.in`, `www.overdrive009.in`, `scout.overdrive009.in` and `viora.overdrive009.in` to this Vercel project.

## The site

| Path | File | What it is |
| --- | --- | --- |
| `/` | `index.html`, `js/punk/landing.js` | Punk-poster landing page: OVERDRIVE title, a robot head that follows the cursor, links wrapped round it to /simulator and /robot |
| `/simulator` | `simulator.html`, `js/punk/simulator.js` | Card-by-card page about the simulator and Scout, with Open the simulator (/sim) and Start scouting (/scout) |
| `/robot` | `robot.html`, `js/punk/robot.js` | Card-by-card page about the robot with a draggable 3D model (placeholder) and arrows to each part |
| `/old-landing` | `old-landing.html`, `js/landing.js`, `css/landing.css` | The previous landing page, kept but no longer linked |
| `/sim` | `sim.html`, `js/main.js` … | The simulator. Home screen shows your robot (team number from Settings, `009` by default) on a plinth; Play flies it onto the field |
| `/scout` | `scout.html`, `js/scout/*` | Overdrive Scout: match and pit scouting, team analytics, pick lists. Sign-in required |
| `/signin` | `signin.html`, `js/signin.js`, `js/stadium.js` | The one Overdrive account for both apps (email and password: sign in, create account, reset), with a match playing at the venue behind it |
| `/terms`, `/privacy` | `terms.html`, `privacy.html` | Terms of Use and Privacy Policy (Overdrive 009 can access all teams' scouting data: Terms §5, Privacy §2) |
| `/viora/`, `/viora/methods`, `/viora/card` | `viora/` | Viora, our Changemakers project: a purple-cabbage saliva strip read by the phone camera. This is the team's app from [Rezza122/viora](https://github.com/Rezza122/viora), copied in whole: hash routes `#home` `#check` `#today` `#trends` `#study` `#model` `#team` `#settings`, English, Hindi and Marathi (`viora/i18n/`), data in the browser's IndexedDB and localStorage. Changes from the original: inline page scripts moved to `viora/js/card-page.js` and `viora/js/methods-page.js` for the CSP, Latin fonts self-hosted (`viora/css/fonts.css`), links made relative to `/viora/`, and the punk skin `viora/css/punk-viora.css` loaded last |

The punk skin for the simulator, Scout, sign-in, terms and privacy is `css/punk.css`, loaded last on each of those pages; it only overrides design tokens and surface styles. Shared pieces: `css/od.css` (liquid-glass design system), `js/robot-model.js` (robot CAD visual), `js/arena.js` (stands, crowd,
lighting truss, LED boards, score screens, plinth). Old links to `/?room=…` or password-reset links are forwarded to `/sim` by `js/redirect.js`.

### Overdrive Scout setup (once per Supabase project)

1. Apply `supabase/scouting.sql` (after `schema.sql` and `hardening.sql`), then `supabase/scouting-review.sql`, then `supabase/scouting-009.sql`
   (every member of team 009 can read, never change, every team's scouting data), then `supabase/scouting-offline.sql` (offline sync
   and shared pick lists). All are safe to re-run.
2. Make Overdrive staff admins (they can read every team's scouting data):
   `insert into public.scout_admins (user_id) select id from auth.users where email = 'someone@example.com' on conflict do nothing;`
3. Accounts are email and password (Supabase → Authentication → Sign In / Providers → Email: enabled, with "Confirm email" on).
   Set the minimum password length to 8 to match the sign-up form.
4. Supabase → Authentication → URL Configuration: Site URL `https://overdrive009.in`, and add the redirect URLs
   `https://overdrive009.in/signin`, `https://overdrive009.in/sim`, `https://scout.overdrive009.in/signin` and `https://scout.overdrive009.in/scout`
   (password resets), plus `http://localhost:8766/**` for local testing. Keep the old `hyperdrive-sim.vercel.app` entries until
   phones there have synced.
   Every sign-in goes through `/signin`; `js/auth-client.js` is the one Supabase client all pages share.

Background stills of the venue (`assets/stadium-wide.jpg`, `assets/stadium-tall.jpg`) are rendered by `node tools/render-stadium.cjs` with the dev server running.

Local demo without an account: `http://127.0.0.1:8766/scout?demo=1&fresh=1` (in-memory backend kept in localStorage, only on localhost;
add `&admin=1` for the staff view, `&offline=1` to simulate a dropped connection, `&sw=1` to run the service worker in the demo).
Register the demo team as `009` to see the Overview tab.

**Offline.** Scout is built to be used with no connection at all.

* **App.** After one visit, `sw.js` keeps every file Scout needs (fonts included) on the phone, so it opens cold with
  airplane mode on. Files come from the network when it answers within 2.5 s, otherwise from the copy. The cache is
  versioned (`CACHE` in `sw.js`): bump it when Scout's file list changes, and activation deletes the old one. It installs
  as an app from `manifest.webmanifest`.
* **Data.** Everything the account may see is kept in IndexedDB (`js/scout/outbox.js`, table `kv`): events, match and pit
  reports, the team's pick lists, and for team 009 other teams' reports at the same competition. Reads and writes go there
  first, so rankings, the overview and pick lists work offline and redraw when synced data arrives. Signing out deletes it.
* **Outbox.** Every create, edit and delete is a row in the `outbox` table. It survives closing the tab and restarting the
  phone. Ids are made on the phone, and each attempt carries a revision id. The `scout_push_*` functions in
  `scouting-offline.sql` recognise a retry of a write they already applied (a lost reply) and do not apply it twice.
* **When it syncs.** On the `online` event, on returning to the app, on a timer that backs off from 5 s to 5 min, and through
  Background Sync where the browser supports it (the service worker runs the same upload code with the app closed).
  Entries upload only for the signed-in account and the team it is on now. Row-level security still decides what is allowed.
* **Sign-in.** A dropped network never signs anyone out. When the token has expired, the upload refreshes it and goes again.
  If the server refuses the saved sign-in, the status reads Needs attention and asks the scout to sign in once more; nothing
  waiting is lost.
* **Status.** The top bar always shows one of Offline, Syncing, Synced or Needs attention, with the number of entries not yet
  on the server. Tapping it lists every waiting entry and why, with Retry and Discard.
* **Conflicts.** Each edit remembers the copy it was made from. If the server copy has changed since, the two are merged field
  by field: fields only one side changed are both kept. A field both sides changed to different values is never overwritten.
  The entry waits, marked Needs attention, with both values shown until someone picks **Keep mine** (their value wins on that
  field) or **Keep theirs**. Deleting a report someone else has changed since is held the same way. A second pit report for a
  robot that already has one merges into it rather than replacing it.

Tests: `tools/scouting-regression.cjs` (PGlite) covers the database rules and the push functions. `tools/scout-offline.cjs`
drives Scout in Chrome with the network switched off and covers going offline, creating and editing entries, closing and
reopening the app, reconnecting, an expired token, duplicate prevention, both kinds of conflict, offline deletes, the team
check and sign-out. Run it with the dev server on port 8766.

**Overview (team 009 only).** `js/scout/insights.js` ranks every robot by a pick score (qualification average shrunk toward the event
mean for small samples, less foul points, variance and breakdown rate). It lists strengths and drawbacks against the rest of the event
and recommends picks that cover 009's weakest areas, with sleepers and risky picks. The tab waits until this phone's queue has synced
(with a "preview anyway" option) and is drawn only when the signed-in team's number is 009. Its "All teams" source pools every team's
reports at the same competition (events matched by name ignoring case, punctuation and year, or by start date; adjustable in Choose
events). The League tab lists every team with its reports and pit reports. Both rely on `scouting-009.sql`.

## Run it locally

The page uses ES modules, so serve the folder over HTTP rather than opening the file directly:

```bash
python hyperdrive-sim/tools/devserver.py 8765
```

Then open <http://localhost:8765> (the landing page) or <http://localhost:8765/sim>. The dev server turns caching off so every reload picks up edits (`python -m http.server`
also works, but browsers then keep stale copies of the CSS and modules). three.js, Rapier physics and the robot model are bundled locally.
Accounts and the leaderboard need an internet connection (Supabase); everything else works offline.

## Security update — 31 October 2026

Existing databases must apply `supabase/hardening.sql`; fresh databases can run
`supabase/schema.sql`, which includes the same migration. Deploy the updated site
and have all online players refresh: unsigned messages from older clients are
deliberately rejected. Multiplayer broadcasts now use ephemeral signing keys,
sender checks and replay protection. Room admission still uses the invitation code;
do not treat a public room code as a private membership system.

Browser-played matches remain available in personal history but are unverified.
The global leaderboard only includes results marked verified by a trusted backend.
This project does not currently supply a server-side match verifier, so new browser
results will not appear there. Existing results default to unverified when migrated.

Regression checks live in `tools/security-regression.cjs`,
`tools/transport-regression.cjs` and `tools/database-regression.cjs`. Browser tests
use a local server on port 8766 and block external requests. Set `PLAYWRIGHT_PATH`
or `PGLITE_PATH` to an installed package location when needed. Database checks use
a disposable PostgreSQL instance through PGlite and never touch the live project.

## Deploy

The site is static and deploys to Vercel as-is (`vercel.json` sets caching and security headers, including a
Content-Security-Policy; `.vercelignore` keeps `supabase/`, `promo/`, `tools/` and this README out of the deployment):

```bash
vercel deploy --prod
```

## Accounts (Supabase)

* **Auth:** email + password through Supabase Auth, in the `nrl` project.
  * Email confirmation is switched off, because Supabase's built-in mailer only delivers to project members.
  * To require confirmation, add a custom SMTP provider in the Supabase dashboard and turn "Confirm email" back on.
* **Schema:** `supabase/schema.sql` (safe to re-run). It contains:
  * `profiles`: username, display name and synced settings.
  * `matches`: one row per finished 2:30 match.
  * Row-level-security policies so each driver can only read and write their own rows.
  * `username_available`, `leaderboard` and `my_stats` RPCs.
* **Client key:** the browser uses the project's publishable key (`js/supabase-config.js`), which is meant to be public. All protection comes from RLS.
* **What gets saved:** practice sessions are not saved. Full matches save automatically when you're signed in, and the leaderboard ranks each driver's best squad score.

## Promo reel

`promo/` is a deterministic renderer that drives the real simulator frame by frame for the 20 s Instagram reel
(1080 × 1920, 30 fps). It is not deployed.

The soundtrack is built from recordings in `promo/audio/`, all downloaded from Pixabay under the
[Pixabay Content License](https://pixabay.com/service/license-summary/) (free for commercial use, no attribution required):
an orchestral trailer cue re-edited to the cuts, plus real servo, drive-motor, clamp, latch, crowd and impact recordings
placed on the physics events the renderer logs (gripper servo, launch, grip, lift, release, core landing, dock).

## Controls

* **New players:** *Learn to play* on the main menu is a coached practice (drive, lower the arm, open the gripper, grab, lift, score) that advances as you do each step.
* **Local matches** first ask how many drivers share the computer. One driver gets Red 1 on WASD or the arrows; two play Red 1 vs Blue 1; robots without a driver stay parked.
* **Rebinding:** Settings, Keyboard lets you change every key for each driver layout (conflicts swap; reset per layout).

| Robot  | Drive (fwd/back, turn) | Arm down / up | Gripper | Cargo bay |
|--------|------------------------|---------------|---------|-----------|
| Red 1  | W S, A D               | Q / E         | R       | F         |
| Red 2  | I K, J L               | U / O         | P       | ;         |
| Blue 1 | Arrow keys             | , / .         | /       | M         |
| Blue 2 | Numpad 8 5, 4 6        | Num 7 / Num 9 | Num 1   | Num 3     |

* Tapping a drive key moves gently (30 % power); holding it ramps to full power in about 0.35 s.
  Keyboard turning tops out at 55 % (about 210°/s on the spot) so a robot can be aimed; gamepads get the full range.
* **Human Players:** Red `1` places a CORE, `2`/`3` handle the Payload for Red 1/Red 2, and `4` presses STARBURST.
  Blue uses `7`, `8`/`9` and `0` the same way. The on-screen buttons do the same thing.
* **Global:** `Space` starts or pauses, `Esc` opens the pause menu (restart, settings, quit), `C` cycles cameras, `V` hides the HUD, hold `Tab` for the live score breakdown, `H` opens help.
* **Cameras:** a match opens on your squad's driver station (Red when playing locally), the view from behind the alliance wall. `C` also cycles the other driver station, audience, top-down and a chase cam per robot.
* **Touch (phones and tablets):** a joystick plus arm, grip and cargo buttons drive one robot. The swap button changes robot, and the CORE / LOAD / ✦ buttons are the Human Player.
* **Gamepads** (standard mapping): left stick drives, right stick turns (tank mode is optional),
  RT/LT or RB/LB move the arm, A toggles the gripper, B works the cargo bay, X places a CORE, Y handles the Payload, Start starts or pauses.
  Assign pads on each robot card. Four drivers sharing one keyboard will hit key-rollover limits, so gamepads are recommended.

## AI drivers

`js/ai.js` drives every robot nobody at the computer is driving. The Local match / Practice dialog sets it:
**Robots without a driver**: Parked, Rookie, Pro or Champion. **Watch** (0 drivers) runs an all-AI match.
Online, the host's AI takes any seat nobody has joined.

* **Same controls as a person.** A bot only sets `robot.cmd` (throttle, turn, arm), works the gripper and the cargo bay,
  and its squad's Human Player uses the same `Game` calls as the HP keys. It cannot do anything a driver cannot, and
  it closes the claws only on its own colour (G4.6).
* **Navigation.** A 74 x 74 cost grid of the field (walls, poles, stations, vaults, forbidden zones) with A* and
  line-of-sight smoothing; other robots, loose rings and Payloads are added at query time.
* **Match plan.** Ring cycles from the spike marks and the Source Zone onto Star and High poles. Pro and Champion
  also deliver the Payload: it is loaded in the Source Zone and tipped into the Drop Zone, with teammates taking turns
  in the corner and using separate spots. The Human Player presses STARBURST early once a Payload is in. Champion
  then pulls golden rings from the vault and builds the STAR MAP pattern bottom-up. In the End Game one robot per
  squad climbs and balances the station; the other keeps scoring.
* **Rules it keeps:** G4.17 (opponent Source Zone is off limits), G4.18 (opponent Vault Zone avoided), G4.12 (never
  the opponent station), G4.19 / R9.4 (Payloads), G4.9 (it backs off after 1.2 s against an opponent), G4.10 / G4.3
  (the HP places rings only when allowed).
* **Measured AI vs AI scores** (one full match each): Rookie about 45-60, Pro about 67-69, Champion 100-110,
  usually with no fouls.
* **Limits.** A ring that ends up under a robot's chassis lifts all four wheels off the tiles, and no drive command
  frees it (this is the physics, so human drivers hit it too). The bots avoid loose rings hard for that reason, but
  in a busy match one can still get beached. Two robots docking on one station together was not reliable (the second
  stalls at the ramp crest or tips the first off level), so only one robot per squad climbs.

Console hook for testing: `__sim.ai.spectate = true; __sim.ai.only = [1]` lets the AI drive just the listed robots.

## Robot code (run your real OpMode)

**Robot code** on the main menu runs a team's actual HexaNRL firmware on a simulated robot. Import the OpMode `.cpp` and the headers it includes (for example `OverdriveAuto.cpp` + `OverdriveConfig.h`) by dropping them in, choosing files, or pasting code. The files stay in your browser.

* **Compiler** (`js/cpp.js`): turns the NRL subset of C++ into JavaScript in the browser.
  * Supported: classes and structs (with inheritance and constructors), lambdas, enums and enum classes, namespaces, switch, casts, integer division, brace and designated initialisers, `#include` between imported files, `#define` and `REGISTER_OPMODE`.
  * Errors point at the file and line.
* **Runtime** (`js/nrl.js`): emulates the control hub.
  * The 100 Hz loop and the Action system (`sequential`, `parallel`, `sleep_ms`, `wait_until`, `repeat`).
  * `TankDrive` ramping, and `DriveActions` (timed or IMU-fused `driveInches`, gyro `turn` / `turnTo` with slowdown and brake pulse).
  * `HexaServo`, `HexaDCMotor`, the LSM6DSOX IMU, `NRLComms` heading, battery voltage, telemetry, `gamepad1` and the Arduino helpers.
  * DriveActions ships as a prebuilt library, so its control logic follows the behaviour documented in `DriveActions.h` / `DriveTuning.h`.
* **AUTO and TELEOP:** AUTO OpModes run for 60 s by themselves. TELEOP OpModes run for 2:30, with a gamepad or the keyboard standing in for `gamepad1`:
  * WASD is the left stick and the arrows are the right stick.
  * I J K L are the Y / X / A / B face buttons.
  * Q and E are LB / RB, U and O are LT / RT, and T F G H are the D-pad.
* **Wiring and calibration** set how ports map onto the simulated robot. The defaults are Team 009's:
  * Servo 1 is the arm (115° = claw on the floor, 1 arm degree per servo degree, smaller = higher) and Servo 2 is the claw (15° open, 90° closed).
  * The simulated robot drives 23 ms per inch at PWM 170 on 11.5 V (`SIM_MS_PER_INCH`).
  * The right gearbox is mirrored, the IMU X axis points backwards, and the battery is 11.5 V.
* **During a run:** the HUD shows the OpMode's telemetry, `Serial` output and any runtime error, with its C++ line. A yellow trail marks the path driven, so you can tune distances and turns and copy them back to the robot.

## Online play

Every driver opens the site on their own laptop. **Play online → Create room** gives a 4-letter code (or an invite link);
the others choose **Join room**, then everyone takes a seat (Red 1/2, Blue 1/2). Anyone without a seat watches.

* **Host-authoritative:** the host's browser runs the physics and every rule exactly as in a local match. Guests send their
  controls (up to 60 Hz) and render the host's state 30 times a second, about 70 ms behind on a good connection,
  more when the network is jittery. Guests never simulate, so the two views can never disagree.
* **Connections:** Supabase Realtime carries the lobby and the WebRTC handshake; the game traffic then goes peer-to-peer.
  Realtime's free tier allows about 100 messages per second for the whole project, so it is only used as a slower relay
  (5 updates/s) when a network blocks peer-to-peer. The lobby shows each driver's link (Direct / Relay) and ping.
* **Controls online:** with one robot per laptop, drive with WASD or the arrow keys, Q/E arm, R gripper, F cargo,
  1–4 (or 7–0) for your squad's Human Player. Any connected gamepad works. Only the host starts, pauses or restarts.
* The host's tab must stay open (it keeps simulating in the background). If the host refreshes, the same room code reopens with the seats kept and guests reconnect to the lobby; if the host is gone, guests see a waiting screen for up to a minute. The address bar always carries the current room code.
* Accounts: password reset by email (Supabase's built-in mailer, a few emails per hour), and *Privacy & data* explains what is stored and deletes the account (`delete_my_account()` in `supabase/schema.sql`). Code: `js/net.js` (rooms, WebRTC, relay)
  and `js/online.js` (lobby, snapshots, interpolation, inputs).

## What is simulated

**Field (official CAD)**
* The visible arena is the CAD itself: 115 k triangles tessellated from `Field Assembly Final.step` (walls with LED channels,
  poles, Space Stations, vaults, STARBURST pillars). Tiles, tape and floor markings are drawn from the CAD's tape parts.
* 144 in field of 36 foam tiles, 0.75 in walls 6.26 in above the tiles (7 in from the arena floor), with the 80 × 25 in driver
  areas, 55 × 55 in Human Player areas and referee areas around it.
* START zones (48 × 24 in), DROP zones (the corner tile's triangle), SOURCE zones (diagonal tape across the opposite corner tile),
  the station zone tiles and the six Ø3.7 in spike marks, all at their CAD positions.
* 6 HIGH POLES (top 5.13 in) and 4 STAR POLES (4.14 in): Ø1 in pipe, Ø4 in base cup, Ø1.97 in domed cap (passes through a CORE).
* 4 APEX POLES: wall-mounted 0.5 in off the wall beside each station, cap at 14.22 in. A threaded CORE rests on the wall top.
* 2 VAULTS: Ø4 in acrylic silo from 1.78 in to 7.69 in with a Ø4.87 in cap and two 45° guide wings, 6 GOLDEN COREs stacked inside.
* 2 SPACE STATIONS: a 20 × 26 in polycarbonate deck shaped as a 12° gable (9.5 in at the ends, 11.6 in at the crest) on a pivot
  8.19 in above the tiles, ±15° hard stops, raised side guards, and 16 in ramps hinged at both deck ends that rest on their toes at
  about 33° (the sheet's 147°). The collision shapes are hulls of the CAD panels' driving surfaces.
* STARBURST buttons with LEDs and TRIFRONS showing the STAR MAP.

**Scoring elements**
* COREs: 95/55 × 30 mm, 40 g rings. The collision shape is a ring of 8 boxes whose inner faces sit exactly on the 55 mm hole, so they thread onto poles physically. Staged COREs start at rest (asleep) and wake when touched, or when a ring is taken from or dropped onto their stack.
* 23 per squad: 20 at the Human Player (the CAD's six stacks) plus 3 on spike marks, and 6 GOLDEN COREs stacked in each vault.
* Team Payloads.

**Robot (NRL-2026 Robot.step)**
* The real CAD geometry: 51 k triangles; PCB detail and fasteners are dropped and meshes decimated.
* 110 mm wheels on a 145 mm wheelbase and 306 mm track, 4-motor skid-steer, a 300 × 412 mm bumper frame 21 mm off the floor.
* Each wheel has a short suspension (tyre and foam compliance) and a tyre model: it grips up to the friction limit, then slides with
  friction acting against the slip direction while the wheel spins where motor torque meets friction (this is what lets a
  skid-steer robot turn). Rolling resistance on the foam.
* DC motors with a torque-speed line, back-EMF braking, gearbox back-drive resistance and a current model; all four share one
  3S pack whose voltage sags with the current drawn, so hard acceleration or a pushing match costs top speed.
* Servo-driven parallelogram arm (145.7 mm links, pivots at 62.8 / 102.8 mm, -16.45° with the claw plates 0.5 mm off the floor).
* Geared claw: two fingers turn about their gear axes and close around a CORE's outside (the CAD pose is closed on a ring
  176 mm ahead of the axles).
* Chassis colliders are measured on the CAD; the bumper frame is modelled with rounded edges.

**Rules**
* 2:30 match, LEVEL UP in the final 30 s, robots disabled at the buzzer.
* STARBURST: automatic at 10 COREs, or by the button at 4 once a Payload is scored. The vault unlocks only during STARBURST.
* Star Map order is checked top → bottom.
* Drop Zone counts only elements fully inside and touching the tile.
* Pole scoring requires a fully threaded CORE, up to the pole's capacity.
* Apex COREs count only if released during LEVEL UP by a robot on its own station.
* SPACE STATION: ENGAGE (touching it), DOCK (fully supported, chassis on top of the platform, deck tilted) and BALANCE (the same with the deck level within 2.5°) per robot. A robot still on a ramp is only ENGAGED. Station points count only during LEVEL UP and at the final buzzer (End Game points).
* The deck's pivot bearing has static and sliding friction plus damping: one robot holds it level within about ±5 cm of the pivot, two robots within about ±2 cm of their shared centre, so balancing is a driving skill. The robot card shows the deck angle while you park.
* Payload Bonus, all Table 4.5.1 point values, and Ranking Points with the Regional thresholds (12 COREs / 36 pts / 25 pts).

**Automatic fouls**
* G4.5 de-scoring opponent COREs.
* G4.9 pinning for more than 3 s.
* G4.12 docking on the opponent station.
* G4.17 entering the opponent Source Zone.
* G4.18 contact in the opponent Vault Zone.
* G4.19 touching an opponent Payload.
* The Human Player controls enforce G4.3 (6 COREs max in the Source Zone) and G4.10 (no placing while your robot is in the zone).
* Robots can only grip their own colour (G4.6).

## Assumptions (not specified in the CAD, the arena sheet or the manual)

These are all in `js/config.js`.

* **Space Station:** deck 4.5 kg, ramps 1.4 kg; pivot bearing 1.1 N·m static / 0.75 N·m sliding friction, 4 N·m·s/rad damping.
  A lone robot holds the deck still within roughly ±5 cm of the pivot, so balancing is a driving skill.
  The ramp toe slides on its polycarbonate floor plate (μ 0.25).
* **Space Station ramps:** the CAD ramp plate ends 1.5 in short of the floor; its collision plate is extended along its own slope to the
  arena sheet's 16 in so it rests on its toe at about 33°.
* **Robot:** 3.2 kg; 300 RPM / 1.0 N·m (12 V) gear motors, 5.5 A stall each; 3S pack at 11.5 V with 0.09 Ω internal resistance;
  2.4 N/wheel gearbox hold; tyre on foam μ 0.95 static / 0.78 sliding, rolling resistance 0.035.
* **Robot bumper colliders** are 12 mm tall (the CAD plate is 4 mm) so two bumpers meeting edge-on cannot ride over each other.
* **Vault Zone:** a 15 in radius half-disc around the vault (the manual says "surrounding the vault"). The CAD's two tape lines in front
  of the vault are drawn as well.
* **Cargo bay:** the CAD has no Payload mechanism, but the manual requires a CARGO BAY separate from the CORE gripper, so the robot has
  a simple rear tip-tray on the PC cover (1 actuator, R9.6).
  * The Human Player loads the Payload directly into it in the Source Zone (R9.2).
  * Cargo also picks up your own Payload from just behind the robot.
  * Cargo dumps it backwards.
* **Payload:** a 100 mm cube weighing 200 g (the rule only sets maximums).
* **Team numbers:** 009 (Overdrive, Red 1), 1002 (Red 2) and 2001/2002 (Blue), shown on the rear number plate. All four can be changed in Settings.

## Known limitations

* **Apex Poles are at the edge of this robot's reach.** Calculated from the CAD (not a scripted test): with its bumper against the deck's
  wall-side guard and the arm just high enough for the ring to clear the cap (about 16°), the claw centre is about 17 mm from the pole
  axis, and a CORE threads only within 14 mm. Fully forward (0°) it gets within 12 mm, but the ring is then below the cap.
  The Apex scoring rules are implemented in full; whether a driver can make it work on the tilting deck is left to the physics.
* **Climbing is a real driving skill with this robot.** Its bumper frame overhangs the axles by 77 mm only 21 mm off the floor, so
  stopping on the 33° ramp can leave it resting on its bumpers; drive up at around 60 % power.
* **Promo renderer:** `promo/` loads the new field and robot, but its scripted shots were framed for the previous robot.
* **Some rules are not auto-detected,** because they depend on referee judgement: G4.15 launching, G4.8 damage, R1.7 expansion and intentional herding.
* **Payloads:** contact with the CORE gripper does invalidate a Payload (R9.4).

## Rebuilding the CAD assets

`assets/field.*` and `assets/robot.*` are generated from the STEP files by the scripts in `tools/` (not deployed):

1. Robot only: `tools/cad_normalize_robot.py` (FreeCAD `freecadcmd`) re-poses the team's final CAD,
   `OVERDRIVE_009_FINAL_ROBOT_v3.step`, into the robot frame, drops electronics detail and fasteners, and writes
   `tools/robot_motion.json`: which solids move with each arm link, the gripper, each claw finger and the cargo-bay gate,
   plus the pivots measured on the CAD.
2. `tools/cad_tessellate.py` (run with FreeCAD 1.0's `freecadcmd`; see the header for the environment variables) tessellates and
   decimates the solids.
3. `python tools/build_field.py field_meshes.json assets` and `python tools/build_robot.py robot_meshes.json tools/robot_motion.json assets`
   quantise the meshes, assign materials, and write the station pivot/hinge anchors, collision hulls and robot pivots.

`tools/sim-harness.js` drives the physics from the browser console for testing
(`await import('/tools/sim-harness.js')`, then `H.run(seconds, (t, robots) => { ... })`).
