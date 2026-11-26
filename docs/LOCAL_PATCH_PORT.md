# Local patch source port

Historical source port report, 2026-11-17. The local-only status below applies to that date. Current feature commits are pushed to fork main; see [5.8.1 integration](UPSTREAM_5_8_1_AI_REVIEW.md).

- Upstream: `Dd154663/SDStudio`, base `99c0831`.
- Branch: `port/local-improvements-20261117`.
- 28 implementation/test commits, followed by this report.
- Installed application, user projects, images, and running queues were not modified.
- Original dirty source checkout and compressed patch evidence remain available.

## Scope and decisions

Port application behavior from the dirty source and successive installed-bundle
patches onto the public TypeScript/React source. Preserve newer upstream theme,
dialog, undo, sampling, resolution, and accessibility behavior. Do not reintroduce
the old application's complete bundle or overwrite upstream source wholesale.

Personal template/emotion edits, project merges performed on user data, image
discarding, prompt weight conversions in user projects, SDK relocation, Windows
repair, and backup cleanup are data/environment operations. They are not shipped
as application code or public test fixtures.

The local single-image queue repair had permission to replace inherited prompt
combinations because the user had edited only drawings/masks. Public source must
handle other users' prompt edits: older image-derived work asks whether to keep
its combinations or use the original image prompt. Recovery saves the previous
preset, slots, and combination mode in project metadata before replacement.
New image-derived work starts with one image prompt and does not inherit all
combinations from the parent scene. Explicit combination workflows remain.

## Small PR shortlist

These are review candidates, not submitted PRs. Start each eventual PR from the
then-current upstream base; transfer only its behavior and relevant tests. A
commit on the integration branch is not a guarantee of a conflict-free standalone
cherry-pick. Later commits update tests that encoded old behavior.

| Priority | Candidate | Local commit | Review focus |
| --- | --- | --- | --- |
| 1 | Keep weight adjustments outside comments | `25f307b` | Small transform fix plus regression cases; Ctrl+arrows and wheel share the path. |
| 2 | Center delete confirmation actions and align the opt-out checkbox | `002b329` | One component; check themes and narrow modal widths. Bring the checkbox assertion from `d671fdd`. |
| 3 | Stop image/upscale state flickering on list refresh | `6784c4a` | Load by image path, invalidate only the changed image, reject stale async results. Check navigation during metadata loading. |
| 4 | Keep empty inpaint seeds random | `cdc058b` | Deliberate behavior difference from other workflows. Include inpaint sampling test updates and seed hint from `d81881f`; exclude auto-I2I changes. |
| 5 | Avoid Windows watcher locks on scene folders | `f09027d` | Small diff but filesystem-sensitive. Retain atomic-save notifications; repeat Windows rename/trash checks. |
| 6 | Ctrl+3 comments including trailing comma/space | `0e75c84` after `25f307b` | Shortcut conflicts, IME/selection, mixed commented ranges, and undo. |

The clipboard newline fix (PR #10) and removal of bundled examples/automatic
insertion (PR #11) are already in the upstream base. Do not open duplicates.

Keep the storage/identity, combined-gallery, selection/reordering, scene-merge,
and inpaint-editor groups for later PRs. They cross persistence and UI boundaries
and need review in dependency order. Future PR descriptions should disclose
GPT-assisted authoring at the top and include concrete review concerns below.
None have been posted during this port.

## Coverage ledger

“Ported” means source is committed and relevant checks passed, not that a new app
was installed or tested against personal projects. Every identified application
patch has a disposition below.

| Area | Disposition | Commits / evidence |
| --- | --- | --- |
| Clipboard newlines; bundled examples and insertion | Upstream | Existing PR #10 / #11. |
| Weight operations near comments | Ported | `25f307b`. |
| Ctrl+3 comment toggle, comma and whitespace | Ported | `0e75c84`. |
| Custom external image editor | Ported | `b8d05de`; configurable Windows executable. |
| Restore generation metadata to edited/exported PNG copies | Ported | `49be606`; pixel-preservation check. |
| Empty inpaint seed remains random | Ported | `cdc058b`, matching hint/tests in `d81881f`. |
| Nested inpaint/I2I results; startup migration | Ported | `a1c7452`; migration/trash path tests. |
| Manual variant migration in cleanup settings | Ported | `8192c45`; loaded/queued projects deferred until startup. |
| Windows folder watcher locks | Ported | `f09027d`; isolated native rename/image-change check. |
| External folder rename/delete/recreate; identity-safe IO | Ported | `74d998e`; registry, reconciliation, persistence, task output, trash. |
| Upscale button flicker | Ported | `6784c4a`; current path and async guards. |
| Linked variants, all/original/variant filters, scene count | Ported | `b4b31e9`, `d206310`. |
| Variant favorites, scene border and actual favorite preview | Ported | `d206310`, fixture fix `06c4661`; result owner, not original input. |
| Batch favorites and combined original/variant ordering | Ported | `d206310`. |
| Selected-image/context export | Ported | `db73c4c`, `d206310`; existing preset/dialog path and actual owner. |
| Context image edit; suppress unrelated native menus | Ported | `2152998`. |
| History viewer; Esc returns to prior context | Ported | `cd56630`. |
| History go-to-scene selects/focuses scene | Ported | `b4b31e9`, `8d19451`. |
| Persistent search above scene controls | Ported | `b4b31e9`, updated assertion `d671fdd`. |
| Click entry; Ctrl/Shift/drag selection; Escape; Delete; Ctrl+Space | Ported | `8d19451`; shared selection/key-target rules. |
| Keyboard focus follows mouse; viewer Ctrl+left/right | Ported | `b4b31e9`, `89bd200`, modified-arrow guard `187907e`. |
| Image/scene drag animation, stacked multi-card preview, scrolling | Ported | `8d19451`; common grid reordering. |
| Delete confirmation layout | Ported | `002b329`. |
| Variant-only scene two-stage deletion choices | Ported | `2d6847b`. |
| Scene merge in bulk/context actions | Ported | `d118950`; merge/overwrite combinations, images/favorites/linked work, rollback. |
| Merge retains gallery order after filename collisions | Ported | `b4e427b`; mapping/order checks. |
| Stable viewer heading/actions and scene identity | Ported | `89bd200`; styles in actual component stylesheet `3fe35ed`. |
| Linked work/results below details; grid dependency badge | Ported | `187907e`; ordered results, edit/delete, current-project guard. |
| Reuse source-image work; delete work through trash | Ported | `cef10e4`, `187907e`; rapid-entry deduplication. |
| Live externally edited original; explicit replacement support | Ported | `d81881f`; live resolver, detached marker, queued pixels. |
| Generated result does not replace editing base | Ported | `3fe35ed`; removed result-to-base callback. |
| Empty mask uses I2I; painted mask keeps inpaint | Ported | `d81881f`; mask classification and handler-level task test. |
| Other transform choices from image viewer | Ported | `187907e`; themed edit/quick picker. |
| Drawing/mask size/color/opacity, reset, local undo/redo | Ported | `3fe35ed`; native canvas/input check. |
| Right-drag erase; Space pan/rotate; wheel size; Ctrl-wheel zoom; Tab | Ported | `3fe35ed`; viewport and transformed pointer mapping. |
| Brush outline; held Ctrl+right eyedropper/loupe; restore tool | Ported | `3fe35ed`; browser pointer/key checks. |
| Compact tools; right-aligned shortcut help | Ported | `3fe35ed`; focus beside drawing/reset, view reset at right. |
| Shared generation bars; current-work reserve/play scope | Ported | `5801e51`, editor registration `3fe35ed`. |
| Single-image prompts/counts; explicit old-work recovery | Ported | `cef10e4`, `3fe35ed`; six source combinations still produce one handler call with ten samples. |
| Initial character-preset copy report | Upstream implementation inspected | Copy instantiates recorded project presets; apply-copy additionally applies the character prompt. No separate local patch found; original runtime failure not reproduced. |
| Personal project/template edits and computer cleanup | Excluded | User data/environment operations, not missing application patches. |

## Dependency groups

1. Independent prompt/editor/dialog fixes: `25f307b`, `0e75c84`, `b8d05de`,
   `49be606`, `cdc058b`, `6784c4a`, `002b329`.
2. Storage and identity: `a1c7452`, `f09027d`, `74d998e`, `8192c45`.
   Nested result deletion needs path/trash support and unlocked watchers;
   it cannot be released as a UI-only deletion fix.
3. Gallery/interactions: `b4b31e9`, `cd56630`, `db73c4c`, `2152998`,
   `d206310`, `06c4661`, `8d19451`, `2d6847b`, `89bd200`.
   Ordering/favorites/export share the owner-aware image model.
4. Scene merge: `d118950`, `b4e427b`; depends on storage and gallery groups.
5. Inpaint input/entry: `d81881f`, `cef10e4`; live originals, detached inputs,
   automatic I2I, and explicit legacy prompt recovery.
6. Queue/canvas/detail: `5801e51`, `3fe35ed`, `187907e`; `d671fdd` aligns old
   UI assertions. Editor queue state is shared by both bars and cleared on close.

Some commits are a feature's initial port plus a later integration fix. Use this
ledger to select a complete PR change set; individual commits are not all
independently releasable features.

## Review concerns

- **Storage:** do not resurrect externally deleted projects or replace recreated
  same-name projects. Migration checks project JSON before writing and defers
  loaded/queued projects. Conflicts are reported instead of deleting their source.
- **Merge/trash:** filename collisions, linked ownership, favorites, gallery
  order, and history must stay consistent. Repeat filesystem rollback tests
  before distribution.
- **Prompts:** retain intentional combination workflows and existing sampling/
  resolution rules. Empty inpaint seeds and image-derived work have the explicit
  exceptions above. Legacy recovery stores a backup and requires a choice.
- **Painting:** drawing layers compose onto the current original. Missing linked
  originals fail instead of falling back to stale duplicates. Local undo memory
  is bounded; large canvases and mobile touch still need device testing.
- **UI/queue:** prevent Ctrl-arrow double navigation and editing another
  project's history image through current state. Both bars share a busy lock.
  Play appends current work, or all current-tab scenes outside editing, then
  starts the existing queue. Paid confirmation remains. Zero enabled
  combinations do not falsely report queued work and start an old queue.

One authorized read-only agent compared the patch inventory and port. Its six
findings were fixed: cross-project history guard, modified-arrow double handling,
hidden global generation bar, editor dropdown scope, inappropriate combination
entry, and linked-result manual ordering. Acceptance evidence is below.

## Verification

- `npm run typecheck`: passed.
- `npm test -- --runInBand`: **214 suites, 2,985 tests passed**.
- `npm run build`: main and renderer production bundles passed.
- Native isolated Chromium canvas fixture: **14 checks passed**. Real components
  and browser pointer/key dispatch; no app bootstrap or generation API. Includes
  mask paint/erase, Ctrl+Z/Y, drawing opacity/reset/undo, eyedropper/loupe, brush
  outline, and stored drawing composition.
- Earlier isolated Windows filesystem check: nested folder rename succeeded
  with both watcher types active; subsequent PNG change was received.
- `git diff --check`: passed.
- Installed `resources/app.asar` SHA-256 unchanged:
  `61f3cf55504c0fdb3f4445a1c1c4b917e2a0930ec8c20c53687f20852fc953d4`.

Reproduce the canvas check after installing repository dependencies:

```text
node .erb/scripts/verify-inpaint-canvas.cjs <output-directory> <chromium-executable>
```

The script creates an isolated profile under the output directory and emits
`results.json` and `canvas.png`; it does not open a normal browser profile.

Build warnings concern existing stale browser data/deprecations. Dependency
updates were not mixed in. No packaged Electron release, mobile build,
personal-project migration, paid generation, or installed-app end-to-end
validation was performed. The installed app remains usable. Release acceptance
still needs a packaged build tested with disposable projects.

## Evidence and preservation

- Original dirty source: sibling `sdstudio-clipboard-pr`, base `cf83af9`.
- Bundle evidence, oldest to newest: installation `patches/inpaint-workflow`,
  `variant-entry-auto-i2i`, `variant-ui-bar-fix`, `viewer-scene-navigation`,
  `single-image-edit-queue`. Latest behavior wins where patches overlap.
- Restore records/compressed older states: installation `patches/cleanup-20261117`.
- Validation logs in the checkout's parent: `sdstudio-port-final-tests.log`,
  `sdstudio-port-types.log`, `sdstudio-port-build.log`.
- Canvas artifacts: sibling `sdstudio-source-canvas-check` directory.
- No generated bundles, personal paths/settings, user images, credentials, or
  private prompt/template data were added to commits. Generic test data only.

Preserve this local checkout until the changes have an approved remote backup.
No remote copy was created by this task.
