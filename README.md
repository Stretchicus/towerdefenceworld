# Tower Defence World

Online spherical hex tower-defence: shared route placement on a Goldberg planet, then realtime combat with towers, mines, and auto-built units.

## Packages

| Package | Role |
|---------|------|
| `@tdw/game-core` | Pure TypeScript rules/sim (planet, tiles, combat) |
| `@tdw/server` | Authoritative Node WebSocket rooms |
| `@tdw/client` | Vite + Three.js planet + HUD |

## Quick start

```bash
npm install
npm test
npm run dev
```

- Client: http://localhost:5173  
- Server / WS: http://localhost:3101 (proxied from Vite in dev)

Create a room from the lobby, share the room code, or fill seats with AI.

## Docs

- [Living specification](docs/SPEC.md)
- [Architecture decisions](docs/adr/)
- [Changelog](docs/CHANGELOG.md)
- [Apache deploy](docs/DEPLOY.md)

## Match options

- 2–4 seats (human or AI)
- FFA or Teams (2v2)
- Win: last base standing, or timed score (base HP)
- World size: Small / Medium / Large
- Placement: Manual or Auto
- Resources: top N from master list (default 3)
