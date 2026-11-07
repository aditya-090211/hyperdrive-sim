# SFX layer for the November update reel (85 BPM grid). Real recordings from promo/audio (Pixabay licence).
# python sfx.py <out.wav> [events.json]   events.json: the renderer's upEvents (land / dock / launch times)
import json, os, subprocess, sys
FF = r"C:\Users\adity\AppData\Roaming\Python\Python314\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
A = os.path.join(os.path.dirname(__file__), '..', 'audio')
BEAT = 60 / 85
B = lambda b: b * BEAT
out = sys.argv[1]
ev = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else []
evt = lambda kind, default: next((e['out'] for e in ev if e['type'] == kind), default)

# (file, source in-point s, length s, place the in-point at output time s, gain dB)
S = []
def hit(t, g=-6): S.append(('impact_hit.mp3', 0.1, 1.6, t - 0.05, g))
def boom(t, g=-4): S.append(('impact_boom.mp3', 0.05, 2.0, t, g))
def whoosh(peak, g=-10): S.append(('whoosh.mp3', 0.0, 1.2, peak - 0.35, g))
def rev(peak, g=-9): S.append(('whoosh_rev.mp3', 0.6, 1.1, peak - 0.95, g))

# hook: particles gather, scan
S.append(('whoosh_rev.mp3', 0.2, 1.55, 0.0, -12)); rev(B(1.25), -10)
S.append(('robot_mech_014.mp3', 0.3, 0.9, B(1.3), -12))
# exploded view out on 2, back together on 6
hit(B(2), -5); whoosh(B(2) + 0.1, -9)
rev(B(6), -8)
# geared claw closes on 6.5, lift on 7
hit(B(6), -7)
S.append(('servo_motor.mp3', 0.2, 0.45, B(6.3), -10))
S.append(('mech_clamp.mp3', 0.15, 0.7, B(6.5) - 0.05, -6))
S.append(('servo_motor.mp3', 1.2, 0.7, B(7.0), -10))
# field build, riser into the venue drop
hit(B(8), -6); whoosh(B(8) + 0.15, -10)
S.append(('riser.mp3', 0.0, 3.45, B(12) - 3.4, -9))
boom(B(12), -3); S.append(('braam.mp3', 0.2, 3.6, B(12) - 0.15, -7))
S.append(('crowd.mp3', 2.0, B(4) + 0.6, B(12), -16))
# action
hit(B(16), -6); S.append(('robot_driving.mp3', 4.0, B(1) + 0.2, B(16), -9))
whoosh(B(17.5), -7)
hit(B(18), -6); S.append(('motor_whir.mp3', 3.0, B(1), B(18), -11))
S.append(('robot_driving.mp3', 9.0, B(1), B(19), -9)); whoosh(B(19), -12)
whoosh(B(20) + 0.1, -12)
land = evt('land', B(21))
S.append(('chip_drop.mp3', 0.0, 0.76, land, -3)); S.append(('impact_boom.mp3', 0.05, 1.2, land, -14))
hit(B(22), -7)
dock = evt('dock', B(23))
S.append(('lock_click.mp3', 5.45, 0.6, dock - 0.2, -5))
S.append(('crowd.mp3', 6.0, B(2.5), B(23), -18))
for b in (25, 25.5, 26): whoosh(B(b) + 0.08, -11)
hit(B(26.5), -6); S.append(('crowd.mp3', 9.0, B(1.5), B(26.5), -16))
# the website
hit(B(28), -7); whoosh(B(28) + 0.2, -10)
for b in (29.5, 30, 30.5, 31, 32, 33.5): whoosh(B(b) + 0.15, -15)
rev(B(36), -6)
# end card
boom(B(36), -3); S.append(('braam.mp3', 0.2, 4.4, B(36) - 0.15, -9))
S.append(('crowd.mp3', 0.5, 4.2, B(36) + 0.3, -20))

TOTAL = 30.0
args = [FF, '-loglevel', 'error', '-y']
fc = []
for i, (f, ss, dur, at, g) in enumerate(S):
    args += ['-ss', f'{ss:.3f}', '-t', f'{dur:.3f}', '-i', os.path.join(A, f)]
    fade = min(0.25, dur / 3)
    fc.append(f'[{i}]aformat=sample_rates=48000:channel_layouts=stereo,afade=t=out:st={max(0, dur - fade):.3f}:d={fade:.3f},volume={g}dB,adelay={int(max(0, at) * 1000)}:all=1[a{i}]')
fc.append(''.join(f'[a{i}]' for i in range(len(S))) + f'amix=inputs={len(S)}:normalize=0,atrim=0:{TOTAL},afade=t=out:st={TOTAL - 0.6}:d=0.6,alimiter=limit=0.89[out]')
args += ['-filter_complex', ';'.join(fc), '-map', '[out]', '-ar', '48000', out]
subprocess.run(args, check=True)
print('sfx', out, len(S), 'cues')
