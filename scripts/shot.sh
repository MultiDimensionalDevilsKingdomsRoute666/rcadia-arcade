#!/usr/bin/env bash
# Headless render check. Chrome headless renders WebGL on the real GPU — do NOT
# pass --disable-gpu / --enable-unsafe-swiftshader, it hard-hangs on WebGL pages.
# Also: no external font/network fetches in the page, they stall virtual time.
# macOS has no `timeout`, hence the poll loop.
set -e
cd "$(dirname "$0")/.."
OUT="${OUT:-/tmp/rcadia-shot.png}"; QS="${1:-shot=1}"; SIZE="${SIZE:-1600,1000}"
pkill -f "Google Chrome.*headless" 2>/dev/null || true
rm -f "$OUT"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --screenshot="$OUT" --window-size="$SIZE" --hide-scrollbars \
  --force-device-scale-factor=1 --virtual-time-budget=6000 \
  --user-data-dir="/tmp/rcadia-chrome-$$" \
  "http://localhost:8299/index.html?$QS" >/dev/null 2>&1 &
CH=$!
for i in $(seq 1 45); do
  [ -s "$OUT" ] && { sleep 1; break; }
  kill -0 $CH 2>/dev/null || break
  sleep 1
done
kill -9 $CH 2>/dev/null || true
[ -f "$OUT" ] && echo "$OUT ($i s)" || { echo "FAILED"; exit 1; }
