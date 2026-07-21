# ADR-0002: Goldberg hex/pent sphere

- **Date:** 2026-07-21
- **Status:** Accepted

## Context

Product wants a spherical hex map. A closed surface cannot be tiled with only hexagons.

## Decision

Use Goldberg dual of a frequency-subdivided icosahedron: hex cells + exactly 12 pentagons. World sizes map to frequency.

## Alternatives

- Square grid on sphere (reference game look, not hex)
- Flat hex map projected onto sphere (distortion / seams)

## Consequences

Pent cells have 5 neighbours; placement and rendering must handle both.
