# Task 3 Report: Edge constraint classifier + validate mask

## Status

Complete. Implemented and exported `classifyCandidateEdges`, `connectionsSatisfyFinishability`, `EdgeKind`, and `EdgeConstraint` without wiring them into `isLegalPlacement`.

## TDD evidence

### RED

Added flat-hex tests for sealed one-cell pocket classification/validation, then ran:

```bash
npm run test -w @tdw/game-core
```

Expected failure:

```text
src/index.test.ts(7,3): error TS2305: Module '"./index.js"' has no exported member 'classifyCandidateEdges'.
src/index.test.ts(8,3): error TS2305: Module '"./index.js"' has no exported member 'connectionsSatisfyFinishability'.
```

### GREEN

Implemented the locked classifier and validator in `packages/game-core/src/tiles/finishability.ts`, exported through `packages/game-core/src/index.ts`, and extended flat-hex fixture coverage.

## Changes

| File | Change |
|------|--------|
| `packages/game-core/src/tiles/finishability.ts` | Added edge constraint types, classifier, pocket path requirement logic, boundary forbids, and mask validator |
| `packages/game-core/src/index.ts` | Exported new functions/types |
| `packages/game-core/src/index.test.ts` | Added sealed pocket required/forbidden and all-or-nothing validation tests |

## Test run

```text
npm run test -w @tdw/game-core

# tests 47
# pass 47
# fail 0
```

## Concerns

- `frontier-continuations` is implemented as the locked `atLeastOne` group id but not wired into placement yet; Task 4 should exercise it when integrating with legal placement.
- Flat-hex boundary cells are treated as walls and classify as `forbidden`.

## Commit

```text
feat(tiles): classify required/forbidden/optional finishability edges
```

## Fix pass: review findings

- Added regression coverage for the Example-6-style single attach with three empty continuation edges: attach-only is rejected, attach plus one continuation is accepted, and attach plus all continuations is accepted.
- Added coverage for the pure wall-cap case: when every non-attach edge is boundary, attach-only remains accepted.
- Updated the pure single-attach frontier pass so optional playable empty edges are grouped as `frontier-continuations` / atLeastOne instead of staying sealed as all-or-nothing `pocket-*` edges.

```text
npm run test -w @tdw/game-core

# tests 49
# pass 49
# fail 0
```
