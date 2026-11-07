# contact sheet: python sheet.py <dir> <out.jpg> [cols] [width]
import sys, glob, os, subprocess
d, out = sys.argv[1], sys.argv[2]; cols = int(sys.argv[3]) if len(sys.argv) > 3 else 6; w = int(sys.argv[4]) if len(sys.argv) > 4 else 270
ff = r"C:\Users\adity\AppData\Roaming\Python\Python314\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
files = sorted(glob.glob(os.path.join(d, 'f*.png')))
while len(files) % cols: files.append(files[-1])
ins = sum([['-i', f] for f in files], [])
n = len(files); rows = n // cols
fc = ''.join(f'[{i}]scale={w}:-1,drawtext=text={os.path.basename(files[i])[1:5]}:x=8:y=8:fontsize=22:fontcolor=yellow[s{i}];' for i in range(n))
lay = '|'.join(f'{(i % cols) * w}_{(i // cols) * int(w * 16 / 9)}' for i in range(n))
fc += ''.join(f'[s{i}]' for i in range(n)) + f'xstack=inputs={n}:layout={lay}'
subprocess.run([ff, '-loglevel', 'error', '-y', *ins, '-filter_complex', fc, out], check=True)
