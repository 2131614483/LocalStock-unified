import subprocess, pathlib

base = pathlib.Path(r'D:\pythonpro\LocalStock-unified\docs\_shots')

W, H = 1920, 1080
clips = [
    ('desktop-watchlist.png', 3),
    ('desktop-market.png', 2),
    ('desktop-dayk.png', 4),
    ('desktop-backtest.png', 3),
    ('desktop-alert.png', 2),
    ('desktop-pa.png', 3),
    ('jq-home.png', 4),
    ('desktop-settings.png', 5),
]

inputs = []
for img, dur in clips:
    inputs += ['-loop', '1', '-t', str(dur), '-i', str(base / img)]

srt_path = str(base / 'subs.srt').replace('\\', '/').replace(':', '\\:')
sub = (f"subtitles='{srt_path}':force_style='FontName=Microsoft YaHei,"
       f"FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,"
       f"BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=60'")

fc_parts = []
for i, (img, dur) in enumerate(clips):
    fc_parts.append(
        f"[{i}:v]scale={W}:{H}:force_original_aspect_ratio=decrease,"
        f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[v{i}]"
    )
concat_in = ''.join(f'[v{i}]' for i in range(len(clips)))
fc_parts.append(f"{concat_in}concat=n={len(clips)}:v=1:a=0[vconcat]")
fc_parts.append(f"[vconcat]{sub}[vout]")
fc = ';'.join(fc_parts)

cmd = ['ffmpeg', '-y'] + inputs + [
    '-i', str(base / 'narration.wav'),
    '-filter_complex', fc,
    '-map', '[vout]', '-map', f'{len(clips)}:a',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    str(pathlib.Path(r'D:\pythonpro\LocalStock-unified\docs\项目讲解.mp4'))
]
print('running...')
r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
if r.returncode != 0:
    print('STDERR tail:', r.stderr[-3000:])
else:
    out = pathlib.Path(r'D:\pythonpro\LocalStock-unified\docs\项目讲解.mp4')
    print('OK ->', out, out.stat().st_size, 'bytes')
