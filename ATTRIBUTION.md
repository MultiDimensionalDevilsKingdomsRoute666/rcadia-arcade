# Attribution

## 3D models

All four models come from [Poly Pizza](https://poly.pizza) and are licensed
**[CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/)** — free to use and
modify, commercially included, **provided the author is credited**. Each has been
rescaled and re-materialled for this scene; the geometry is unchanged.

| Model | Author | Source | Licence | Used as |
|---|---|---|---|---|
| Arcade Machine | J-Toastie | [poly.pizza/m/GLDkMhiynM](https://poly.pizza/m/GLDkMhiynM) | CC-BY 3.0 | every cabinet on the floor |
| Electronic Game | burunduk | [poly.pizza/m/QIJoiNqjrk](https://poly.pizza/m/QIJoiNqjrk) | CC-BY 3.0 | alternate chassis, rig lab only |
| Beer Pong | Danni Bittman | [poly.pizza/m/eE8C1i_9LwR](https://poly.pizza/m/eE8C1i_9LwR) | CC-BY 3.0 | lounge |
| Pool Table | Evol-Love | [poly.pizza/m/7GzmqI1M0fC](https://poly.pizza/m/7GzmqI1M0fC) | CC-BY 3.0 | lounge |

The credit line is carried in the running page (bottom-left) as well as here.
**Do not remove it** — it is the licence condition, not decoration.

## Other assets

- **XRP mark** — `assets/xrp.svg`, from the XRPLClaw asset set. The XRP Ledger
  logo is a Ripple/XRPL Foundation mark; used here to identify the ledger the
  arcade runs on.
- **Game artwork** — each game's `OgImage.png`, pulled from
  `api.rcadia.xyz` at build time. Belongs to the respective game's publisher.
- **Everything else** — carpet, walls, terrazzo, marquees, side art, attract
  screens, signage, the CRT shader — is generated at runtime by this repository's
  own code. No third-party textures.

## Fonts

Orbitron and Rajdhani are named in the CSS stacks but **not loaded** — the page
makes no network requests at all, so both fall back to a local sans-serif.
Loading them would break the headless screenshot pipeline (see README).
