#!/usr/bin/env python3
"""Download each game's OgImage into assets/games/<slug>.png, normalised.

The endpoint happily serves JPEGs, GIFs and 404 bodies under a .png name, so PIL
is the judge of what counts as an image. Anything usable is written as RGBA PNG
with its longest side capped at 640 — these only ever land in a 400-512px atlas
cell, so larger is dead weight. Anything unusable is left absent on purpose; the
atlas draws a generated fallback tile for missing slugs.
"""
import json, os, re, subprocess, sys
from PIL import Image

games = json.load(open('assets/games.json'))
os.makedirs('assets/games', exist_ok=True)
ok = bad = 0
for g in games:
    m = re.match(r'/games/([^/]+)/', g.get('iframeSrc') or '')
    if not m:
        print('   ?? no slug for', g.get('title')); continue
    slug = m.group(1)
    tmp, out = f'/tmp/og-{slug}', f'assets/games/{slug}.png'
    subprocess.run(['curl', '-sf', f'https://api.rcadia.xyz/games/{slug}/OgImage.png',
                    '-o', tmp], check=False)
    try:
        im = Image.open(tmp); im.load()
        im = im.convert('RGBA')
        if max(im.size) > 640:
            r = 640 / max(im.size)
            im = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.LANCZOS)
        im.save(out, 'PNG', optimize=True)
        ok += 1
    except Exception:
        if os.path.exists(out): os.remove(out)
        bad += 1
        print(f'   -- {slug}: no usable image, atlas will draw a fallback tile')
    finally:
        if os.path.exists(tmp): os.remove(tmp)
print(f'   {ok} ok, {bad} fallback')
