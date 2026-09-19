import subprocess, os

SHOTS = os.path.dirname(os.path.abspath(__file__))
os.chdir(SHOTS)
OUT = r'D:\pythonpro\LocalStock-unified\docs\项目讲解_EN.mp4'
WAV = 'narration_en.wav'
SRT = 'subs_en.srt'

clips = [
    ('desktop-watchlist.png', 6.04),
    ('desktop-dayk.png', 6.16),
    ('desktop-market.png', 5.23),
    ('desktop-weekk.png', 10.75),
    ('desktop-drawing.png', 6.27),
    ('desktop-minute.png', 5.22),
    ('desktop-backtest.png', 2.20),
    ('jq-home.png', 4.22),
    ('desktop-alert.png', 2.00),
    ('desktop-pa.png', 6.08),
    ('desktop-ai-page.png', 12.95),
    ('desktop-ai-config.png', 14.57),
    ('desktop-settings.png', 6.50),
    ('desktop-watchlist.png', 11.80),
    ('desktop-watchlist.png', 20.01),
]

inputs = []
for fn, dur in clips:
    inputs += ['-loop', '1', '-t', f'{dur:.3f}', '-i', fn]

inputs += ['-i', WAV]
audio_idx = len(clips)

# Build filter: scale each image to 1920x1080 with padding, then concat
vfilters = []
concat_inputs = ''
for i in range(len(clips)):
    vfilters.append(
        f'[{i}:v]scale=1920:1080:force_original_aspect_ratio=decrease,'
        f'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[v{i}]'
    )
    concat_inputs += f'[v{i}]'

vfilters.append(f'{concat_inputs}concat=n={len(clips)}:v=1:a=0[vcat]')

# Subtitle filter
vfilters.append(
    f"[vcat]subtitles={SRT}:force_style='FontSize=20,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2'[vout]"
)

fc = ';'.join(vfilters)

cmd = ['ffmpeg', '-y'] + inputs + [
    '-filter_complex', fc,
    '-map', '[vout]',
    '-map', f'{audio_idx}:a',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23',
    '-c:a', 'aac', '-b:a', '128k',
    '-pix_fmt', 'yuv420p',
    '-shortest',
    OUT
]

print('running...')
r = subprocess.run(cmd, capture_output=True, text=True)
if r.returncode != 0:
    print('STDERR tail:', r.stderr[-2000:])
else:
    print(f'OK -> {OUT} {os.path.getsize(OUT)} bytes')
