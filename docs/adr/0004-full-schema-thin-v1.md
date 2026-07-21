# ADR-0004: Full economy schema, thin v1 combat wiring

- **Date:** 2026-07-21
- **Status:** Accepted

## Context

Design specifies rich tower/mine/bod/base stats; shipping all modifiers in v1 blocks online delivery.

## Decision

Ship complete config types/JSON now; v1 sim only applies power, range, HP, resistance, costs, upgrades, mine pickup, base gen, friendly fire.

## Consequences

Config forward-compatible; advanced fields are no-ops until activated.
