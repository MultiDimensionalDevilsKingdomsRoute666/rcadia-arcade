#!/usr/bin/env bash
# rcadia-arcade: bundle src -> dist. Node 18+ only.
#
# Two pages come out of one source tree:
#   index.html  the arcade floor
#   rig.html    the Phase 1 single-cabinet lab, kept because it is still the
#               fastest way to tune a chassis without loading a whole room
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm i --no-audit --no-fund
mkdir -p dist
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete assets dist/
else                # no rsync: same result, a fresh copy of assets
  rm -rf dist/assets && cp -a assets dist/
fi

page () {           # page <entry.js> <shell.html> <out.html> <title>
  npx esbuild "src/$1" --bundle --format=iife --outfile=dist/.bundle.js --log-level=warning
  node -e '
    const fs = require("fs");
    const [shell, out, title] = process.argv.slice(1);
    const page = fs.readFileSync("src/" + shell, "utf8");
    const bundle = fs.readFileSync("dist/.bundle.js", "utf8");
    fs.writeFileSync("dist/" + out,
      "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + title + "</title>" +
      "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover,maximum-scale=1\">" +
      "<meta name=\"theme-color\" content=\"#04030a\">" +
      "</head><body>" + page.replace("/*BUNDLE*/", () => bundle) + "</body></html>");
  ' "$2" "$3" "$4"
  echo "  $3  $(du -h "dist/$3" | cut -f1)"
}

page room.js room.html index.html "RCADIA — XRPL Arcade"
page main.js page.html rig.html  "RCADIA — cabinet rig"
rm -f dist/.bundle.js
