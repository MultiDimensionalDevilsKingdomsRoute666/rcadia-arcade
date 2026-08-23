#!/usr/bin/env python3
"""Reduce the games snapshot to the fields the room actually renders.

The live endpoint returns the full record for each game — payout wallets,
internal user ids, admin flags, submitter details. None of that reaches the
scene: it draws a title, sorts by play count, and derives the slug from the
iframe path. Keeping the rest around would just be someone else's data riding
along in a repo for no reason.
"""
import json, re

games = json.load(open('assets/games.json'))
slim = []
for g in games:
    m = re.match(r'/games/([^/]+)/', g.get('iframeSrc') or '')
    if not m:
        continue
    slim.append({
        'title': g.get('title') or m.group(1),
        'slug': m.group(1),
        'iframeSrc': g['iframeSrc'],
        'playCount': g.get('playCount') or 0,
    })
slim.sort(key=lambda g: -g['playCount'])
json.dump(slim, open('assets/games.json', 'w'), indent=2)
print(f'   {len(slim)} games, {len(json.dumps(slim))} bytes')
