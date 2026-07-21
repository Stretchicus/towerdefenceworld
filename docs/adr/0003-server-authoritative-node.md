# ADR-0003: Server-authoritative WebSocket rooms on self-hosted Node

- **Date:** 2026-07-21
- **Status:** Accepted

## Context

Online realtime from day one; host has LAMP + Node, not Cloudflare Workers.

## Decision

Node HTTP + WebSocket server; Apache reverse-proxies static client and `/ws`. Authoritative tick in server using `game-core`.

## Alternatives

- Cloudflare Durable Objects
- Client-authoritative with lockstep (cheat / desync risk)

## Consequences

Must run a Node process; PHP is not used for the game loop.
