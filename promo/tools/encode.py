# python encode.py <frames dir> <out base path (no extension)> [sfx.wav]
# -> <base>.mp4 (silent master), <base>-sfx.mp4 (with the SFX layer), <base>-preview.mp4 (small, for phones / review)
import os, subprocess, sys
FF = r"C:\Users\adity\AppData\Roaming\Python\Python314\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
d, base = sys.argv[1], sys.argv[2]
sfx = sys.argv[3] if len(sys.argv) > 3 else None
src = ['-framerate', '30', '-i', os.path.join(d, 'f%04d.png')]
v = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-movflags', '+faststart', '-r', '30']
run = lambda a: subprocess.run([FF, '-loglevel', 'error', '-y', *a], check=True)
run([*src, *v, base + '.mp4'])
if sfx:
    run(['-i', base + '.mp4', '-i', sfx, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', base + '-sfx.mp4'])
run(['-i', base + ('-sfx.mp4' if sfx else '.mp4'), '-vf', 'scale=540:960', '-c:v', 'libx264', '-crf', '24', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', base + '-preview.mp4'])
for s in ('.mp4', '-sfx.mp4', '-preview.mp4'):
    p = base + s
    if os.path.exists(p): print(p, round(os.path.getsize(p) / 1e6, 1), 'MB')
