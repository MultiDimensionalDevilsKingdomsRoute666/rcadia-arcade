#!/usr/bin/env bash
# Render every pose in layout.js TOUR and tile them into one labelled sheet, so a
# lighting change can be judged across the whole room instead of one lucky angle.
#   ./scripts/tour.sh                 all poses, default settings
#   ./scripts/tour.sh "bloom=1.4"     all poses with an override applied
set -e
cd "$(dirname "$0")/.."
EXTRA="${1:-}"
POSES="${POSES:-entrance atrium heroRow aisle island lounge}"
SIZE="${SIZE:-1200,760}"
OUTSHEET="${OUTSHEET:-/tmp/tour.png}"
LIST=""
for p in $POSES; do
  SIZE="$SIZE" OUT="/tmp/tour-$p.png" ./scripts/shot.sh "shot=1&pose=$p&$EXTRA" >/dev/null
  LIST="$LIST /tmp/tour-$p.png:$p"
done
python3 - "$OUTSHEET" $LIST <<'PY'
import sys
from PIL import Image, ImageDraw, ImageStat
out, items = sys.argv[1], sys.argv[2:]
tiles = []
for it in items:
    path, label = it.rsplit(':', 1)
    im = Image.open(path).convert('RGB')
    m = ImageStat.Stat(im).mean
    tiles.append((im, f"{label}  mean {m[0]:.0f},{m[1]:.0f},{m[2]:.0f}"))
cols = 2
tw, th = tiles[0][0].size
scale = 0.5
tw, th = int(tw * scale), int(th * scale)
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * (th + 22)), (8, 6, 14))
d = ImageDraw.Draw(sheet)
for i, (im, label) in enumerate(tiles):
    x, y = (i % cols) * tw, (i // cols) * (th + 22)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + 22))
    d.text((x + 8, y + 6), label, fill=(150, 220, 255))
sheet.save(out)
print(out, sheet.size)
PY
