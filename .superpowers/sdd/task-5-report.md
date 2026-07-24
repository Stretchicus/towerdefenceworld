# Task 5 report: SVG examples 1-6 as fixtures

## Summary

- Added `describe("finishability examples")` to `packages/game-core/src/index.test.ts`.
- Built flat-hex `PlacementState` fixtures for acceptance examples 1-6.
- Covered required, forbidden, and green combination rules with both `connectionsSatisfyFinishability` and `isLegalPlacement`.
- No `finishability.ts` changes were needed; existing classifier behavior matches these fixtures.

## Verification

- `npm run test -w @tdw/game-core` passed.

## Concerns

- Fixtures approximate the SVG layouts using compact axial flat-hex boards because the SVG source geometry is not present in the repo.

## Fix pass

- Added `expectMissingEachRequiredFails` and `expectEachForbiddenOpenFails` helpers to table-test per-edge failures without copy-paste.
- Examples 1–6 now assert each required edge omission fails both `connectionsSatisfyFinishability` and `isLegalPlacement`.
- Examples with multiple forbidden edges table-test opening each forbidden edge (with requireds satisfied) fails.
- Example 5 adds the inverse singleton-green case (`[0, 2, 3]`, edge 2 open / edge 1 closed).
- `npm run test -w @tdw/game-core` passed (55 tests).
