# Tower Defence World — Living Specification

**Status:** Current as of 2026-07-21  
**Version:** 0.1.0 (v1 vertical slice)

## 1. Objectives

Browser game: 2–4 players (human or AI) place shared route tiles on a spherical hex planet, then fight with auto-built units, towers, mines, and bases in realtime online rooms on a self-hosted Node server.

## 2. Functional requirements

### 2.1 Lobby / match

- Create or join room by code; join link `?room=CODE`
- Seats: 2–4; each seat human or AI
- Settings:
  - Mode: FFA | Teams (2v2 when 4 seats; 2 seats = duel)
  - Win: `last_base` | `timed` (score = remaining base HP)
  - World size: `small` | `medium` | `large`
  - Placement: `manual` | `auto`
  - Resource count N (use top N of master list; default 3)
- Host starts when seats filled / ready

### 2.2 Planet

- Goldberg-style mesh: hex cells + exactly 12 pentagons
- Sizes map to subdivision frequency (small/medium/large)
- Bases at fixed, evenly spaced seed cells by seat count
- One shared map for all players

### 2.3 Phase 1 — Tile placement

- Shared seeded tile bag for the match
- Tile types contribute: route (`single` | `branch`), optional tower point, optional mine
- **Manual:** turn-based; illegal placements blocked
- **Auto:** deterministic legal placer consumes the bag
- Legality: empty cell; route edge compatibility with neighbours; must attach to existing route component or base stub
- If bag ends / no legal moves and bases not on one connected route component → **forced auto-bridge** from reserve tiles
- Placed tiles are shared infrastructure (not owned)
- Phase 2 structures: first builder owns tower/mine on a point

### 2.4 Phase 2 — Combat / economy

- Banks start from config; bases add `resource_gen_per_tick`
- Mines: passing bods pick up configured resources into **held**
- Bod death: killer’s player bank gets `resource_perc_on_death` of held; remainder void
- Auto-build: enabled bod types when bank can afford; build_time ticks; v1 starts with one weak type ON
- Player intents: build tower, upgrade tower/mine/bod-type/base, enable/disable bod type, toggle friendly fire, toggle targets
- Targets list: other players, all ON at start; spawns round-robin among enabled; all OFF → closest enemy base
- Pathing on route graph only (A*)
- Damage (v1): `power * (1 - resistance)`; friendly fire respects `teamId`
- Bod reaching enemy base deals contact damage (config)
- Win: last standing team/player, or timed HP score

### 2.5 Economy schema vs v1 wiring

Full config schema includes AoE, jump, slow, shot-refund, etc.  
**v1 active:** tower power/range/costs/upgrades/friendly_fire; mine generated + upgrades; bod hp/resistance/build/held/perc/upgrades; base hp/gen/upgrades.

## 3. Non-functional requirements

- Server-authoritative tick; clients send intents only
- Basic reconnect via player token
- Deploy behind Apache reverse-proxy on LAMP+Node host
- `game-core` unit-tested without browser
- Snapshot broadcast ~10–20 Hz (tunable)

## 4. Assumptions

- No accounts/MySQL in v1 (in-memory rooms)
- Teams mode with 3 seats: not supported in lobby (require 2 or 4 for teams)
- AI is scripted heuristics, not deep strategy

## 5. Constraints

- Sphere cannot be pure-hex; 12 pentagons required
- Pure rules in `@tdw/game-core` (no DOM/WebSocket APIs)

## 6. Acceptance criteria (v1 smoke)

1. Two browsers join same room; AI can fill seats  
2. Lobby settings apply; phase 1 completes (manual or auto) with connected bases  
3. Phase 2: resources, auto-build, towers, target toggles, base damage, match end  
4. Death loot credits killer bank  
5. `npm test` passes for game-core  

## 7. API / protocol (intents)

Client → server: `join`, `ready`, `placeTile`, `buildTower`, `upgrade`, `toggleBod`, `toggleTarget`, `toggleFriendlyFire`, `setLobby`  
Server → client: `room`, `state`, `error`, `ended`

## 8. Known limitations

- Advanced tower modifiers stored but inert  
- Snapshot rate not delta-compressed  
- AI placement/combat is basic  

## 9. Future improvements

- Activate AoE/jump/slow/shot-refund  
- Richer AI; replays; accounts  
- Delta compression; spectator mode  

## 10. Deployment

See [DEPLOY.md](DEPLOY.md) for Apache reverse-proxy + systemd on a LAMP+Node host.
