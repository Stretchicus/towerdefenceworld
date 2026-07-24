# Final fix pass - finishable placement review

- Count open-end empty cells inside pocket BFS so existing stubs into multi-cell sealed pockets contribute to `S` and force the required pocket join.
- Preserve `pocket-*` all-or-nothing groups during pure-attach frontier regrouping; only ungrouped open-frontier empty edges become `frontier-continuations`.
- Reject candidate masks that would create a non-base degree-1 route tip via a single placed attach, including attach-only wall caps.
- Keep Goldberg open exterior growth unsealed by treating single no-boundary empty components as frontier, not pockets.
- Verification: `npm run test -w @tdw/game-core` passed.
