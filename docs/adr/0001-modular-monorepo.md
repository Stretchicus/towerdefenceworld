# ADR-0001: Modular monorepo with pure game-core

- **Date:** 2026-07-21
- **Status:** Accepted

## Context

Need reusable rules, online rooms, and a Three.js client without tangling sim logic with sockets or DOM.

## Decision

npm workspaces with `@tdw/game-core` (pure TS), `@tdw/server` (Node WS), `@tdw/client` (Vite/Three.js).

## Alternatives

- Single Node app (faster start, poor reuse)
- Colyseus framework (faster lobby boilerplate, heavier lock-in)

## Consequences

Slightly more scaffold; sim is unit-testable and portable.
