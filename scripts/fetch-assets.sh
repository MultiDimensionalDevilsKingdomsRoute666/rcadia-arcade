#!/usr/bin/env bash
# Pull everything the room needs into assets/ so the page never touches the
# network at runtime. Headless Chrome's --virtual-time-budget stalls forever on
# any outstanding fetch, so a runtime request would break the whole shot loop.
set -e
cd "$(dirname "$0")/.."
API="https://api.rcadia.xyz"
mkdir -p assets/games

echo "· games.json"
curl -sf "$API/api/v1/games" -o assets/games.json
python3 scripts/slim-games.py

echo "· OgImages"
python3 scripts/fetch-images.py

echo "· xrp.svg"
cp ~/Projects/xrplclaw/public/images/xrp.svg assets/xrp.svg

echo "· prop models"
cp ~/Downloads/"Pool Table by Evol-Love - 7GzmqI1M0fC.glb"    assets/prop-pool.glb
cp ~/Downloads/"Beer Pong by Danni Bittman - eE8C1i_9LwR.glb" assets/prop-beerpong.glb

du -sh assets
