import subprocess, os, pathlib, shutil

base = pathlib.Path(r'D:\pythonpro\LocalStock-unified\docs\_shots')
work = base / 'video-work'
work.mkdir(exist_ok=True)

# 8 段：(图片, 时长秒)
clips = [
    ('desktop-watchlist.png', 3),
    ('desktop-market.png', 2),
    ('desktop-dayk.png', 4),
    ('desktop-backtest.png', 3),
    ('desktop-alert.png', 2),
    ('desktop-pa.png', 3),
    ('jq-home.png', 3),
    ('desktop-settings.png', 5),
]

W, H = 1920, 1080

# 1) 每张图预处理：缩放到 1920x1080 黑边，统一 fps=30
normalized = []
for i, (img, dur) in enumerate(clips):
    src = base / img
    dst = work / f'norm_{i}.png'
    # scale 到 1920x1080 内，pad 黑边
    subprocess.run([
        'ffmpeg', '-y', '-i', str(src),
        '-vf', f'scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black',
        str(dst)
    ], check=True, capture_output=True)
    normalized.append((dst, dur))

# 2) 写 concat 列表
lst = work / 'list.txt'
with open(lst, 'w', encoding='utf-8') as f:
    for dst, dur in normalized:
        f.write(f"file '{dst.as_posix()}'\n")
        f.write(f"duration {dur}\n")
    # concat demuxer 需要重复最后一帧
    f.write(f"file '{normalized[-1][0].as_posix()}'\n")

# 3) 拼接无声视频
silent = work / 'silent.mp4'
subprocess.run([
    'ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst),
    '-vsync', 'vfr', '-pix_fmt', 'yuv420p', '-r', '30',
    str(silent)
], check=True, capture_output=True)

# 4) 合并音频 + 烧字幕
out = pathlib.Path(r'D:\pythonpro\LocalStock-unified\docs\项目讲解.mp4')
srt_path = str(base / 'subs.srt').replace('\\', '/').replace(':', '\\:')
sub = f"subtitles='{srt_path}':force_style='FontName=Microsoft YaHei,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=60'"
cmd = [
    'ffmpeg', '-y',
    '-i', str(silent),
    '-i', str(base / 'narration.wav'),
    '-vf', sub,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest',
    str(out)
]
print('running ffmpeg...')
r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
if r.returncode != 0:
    print('STDERR:', r.stderr[-2000:])
else:
    print('OK ->', out, out.stat().st_size, 'bytes')
