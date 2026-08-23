#!/usr/bin/env bash
# Contact sheet: ./scripts/sheet.sh "qs1" "qs2" ... -> /tmp/sheet.png
set -e; cd "$(dirname "$0")/.."
i=0; files=""
for qs in "$@"; do
  i=$((i+1)); f="/tmp/sheet-$i.png"
  OUT="$f" ./scripts/shot.sh "$qs" >/dev/null
  files="$files $f"
done
python3 - $files <<'PY'
import sys
from PIL import Image, ImageDraw
paths=sys.argv[1:]
cols=min(3,len(paths)); rows=(len(paths)+cols-1)//cols
W,H=640,400
sh=Image.new('RGB',(W*cols,H*rows),(0,0,0)); d=ImageDraw.Draw(sh)
for i,p in enumerate(paths):
    im=Image.open(p).resize((W,H),Image.LANCZOS)
    x,y=(i%cols)*W,(i//cols)*H
    sh.paste(im,(x,y)); d.text((x+8,y+6),str(i+1),fill=(255,255,0))
sh.save('/tmp/sheet.png'); print('/tmp/sheet.png')
PY
