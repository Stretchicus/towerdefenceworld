# ADR-0005: Shared map, optional placement, auto-bridge

- **Date:** 2026-07-21
- **Status:** Accepted

## Context

Combat assumes one shared route graph; placement can soft-lock online matches.

## Decision

One shared tile bag and map; lobby chooses manual or auto placement; if bases are not connected after phase 1, forced auto-bridge from reserve tiles.

## Consequences

Matches always reach a playable phase 2; auto-bridge may alter intended choke points.
