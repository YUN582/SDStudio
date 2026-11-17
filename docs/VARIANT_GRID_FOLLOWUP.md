# Variant and grid follow-up

Base: source port `4509f5a`. Installed app still uses the prior patched bundle.
User chose replacement with a source-built application after verification.

1. Restore prompt-layout choice and explicit new-work creation; preserve single-image sample counts.
2. Track the immediate source of chained variant work; retain root output layout and rename/merge/trash compatibility.
3. Choose scene thumbnails from the first favorite in combined gallery order.
4. Share arrow and Shift-arrow range navigation across scene/image grids; preserve text-entry and overlay guards.
5. Test affected data/interaction paths, build and smoke-test an isolated application, then back up and replace the installation after app closure.

No PR/push. No generation API calls. Do not modify live project data during tests.

## Implemented

- `bac791e`: restore the three prompt-layout choices before any snapshot write;
  each explicit image entry creates new work. Simultaneous duplicate clicks share
  one pending request. Single-image jobs retain the requested sample count.
- `bac791e`: persist `sourceInpaint` for immediate parent work, separately from
  root `sceneRef`. Badges, details, current input reads, rename rollback and root
  scene merge preserve the immediate source. Copying a child result to the root
  does not remove an unrelated same-named root image.
- `99f11c7`: choose the first favorite in combined gallery order and load that
  file's pixels, including variant results.
- `db27d06`: scene/image grids share arrow movement and Shift range selection.
  Card mousedown releases search-input focus; scene Ctrl+Space toggles selection.
  Hidden tabs and other viewers do not consume the scene navigation event. Empty
  virtual cells no longer display false drop/focus borders.

## Validation

- TypeScript: passed.
- Full Jest run: 216 suites, 3,000 tests passed.
- Main and renderer production builds: passed.
- Full packaged application, separate profile and synthetic project: 13 checks
  passed. Includes scene/image Shift range growth and shrink, Ctrl+Space, focus
  handoff, variant favorite pixels, chained-work badge/details, restored prompt
  choices and creating new work despite an existing dependency.
- Package verification: all 34 compiled/data files match source build outputs;
  940 packed runtime files and unpacked dependency entries remain unchanged.
  Runtime package dependency definitions match the source release package.
- No personal project, account, generation request, mobile device or live paid
  generation was used for acceptance.

## Compatibility and release

The source build replaces compiled main, preload, renderer, lazy chunks and data
inside the existing Electron installation. It retains the compatible launcher
and native dependencies. This is a complete source build, not a renderer string
patch. Existing desktop OAuth application configuration is a local release
setting; it must not enter commits or test reports.

New chained work records its immediate source. Older work that never saved this
information cannot be reliably reconstructed from scene names; this change does
not guess or rewrite those links. Existing direct links remain supported.

Installed locally on 2026-11-17 after explicit approval to reuse the existing
desktop OAuth application configuration. Values were passed in process memory
only and retained in the local main bundle, not in source commits or reports.
Verified the previous archive backup before replacement; verified the installed
archive against the candidate SHA-256 afterward. Final configured package
bootstrap passed with isolated data and blocked network requests. Personal
projects and account files were not modified; the normal application was left
closed.

For upstream review, `99f11c7` is the smallest bug-fix candidate in this follow-up.
Review chained-work changes separately from keyboard selection. No PR or push
was performed.

The earlier port report describes the state before this follow-up; its statement
that no packaged app had been tested is superseded by the checks above.

## Image-specific combination follow-up, 2026-11-17

Restoring the layout chooser also restored copying every source combination.
Choosing shared/snapshot layout incorrectly marked image-derived work as an
intentional batch, bypassing the earlier single-image recovery.

- Shared/snapshot still controls prompt settings; image entry imports only the
  image's recorded middle prompt. Resolved character prompts are imported once.
- Older images without section metadata require an exact, unambiguous match.
  Failure creates neither work nor an input snapshot; no first-combination guess.
- Existing affected work asks once at reservation, backs up its old combinations,
  and preserves layout, masks, drawings, outputs, and generation settings.
  Explicitly retaining a batch is distinct from the old automatic keep flag.
- Queue entry points share the recovery guard. Generated Inpaint/I2I combination
  results retain section metadata for subsequent edits.
- Validation: source creation/recovery, non-first combinations, shared versus
  snapshot updates, character prompts, input snapshots, save/reload, and normal
  batch behavior. Typecheck and production renderer build passed. Isolated
  packaged-app check selected the second source combination and queued ten
  images once. No personal data writes or generation API calls.

## Play/resume follow-up, 2026-11-17

The revised user contract supersedes the earlier append-on-every-play behavior.
Play resumes pending tasks without adding work. Only an empty queue creates the
current editor work or normal scene batch before starting. Stop is unchanged;
explicit reservation actions continue to append work. Resuming is available even
while the editor canvas is loading. Paid-generation confirmation remains.

Tests cover pending/empty/completed queues, editor and normal views, stop,
explicit reservation, concurrent clicks, and paid cancellation. Full-suite run:
215 of 216 suites passed; the remaining temporary-scene fixture exposed an
optional-metadata guard, corrected and verified in a focused four-suite rerun
(67 tests passed). Typecheck and production build passed. Isolated packaged-app
check confirmed ten pending images remained ten after Play; network was blocked.

## Prompt/input verification and character toggle, 2026-11-17

A reported ineffective edit could not be reproduced from its original work,
which had already been deleted. Investigation found a separate concrete defect:
single-prompt Inpaint/I2I included characters with `enabled: false`. Combination
layouts already filtered them. The single-prompt handler now respects the toggle.

Validation: 130 targeted tests passed, including edited weighted character/base
prompts, shared/snapshot/single layouts, empty versus painted masks, immutable
earlier reservations, and intercepted V4.5/V5/V5 Medium API payloads. Empty masks
produce `img2img`; painted masks produce `infill`. An isolated Chromium canvas
check passed 14 interactions and checked the composited drawing's actual pixels.
No paid generation or personal data writes. These checks establish request
contents, not a guarantee that the image model follows a requested visual edit.


## Drag preview origin correction (2026-11-17)

Virtual grid cells retain absolute row/column offsets when cloned. Reset the
floating clone's position and transform; its host alone follows the pointer.
Suppress the clone's image entrance animation so pixels stay attached to the
shadow from drag start. Keep stacked multi-selection, scrolling, Escape and
click suppression unchanged.

Regression: drag a cell away from the grid origin and move the pointer again.
Assert clone/host alignment and preserve the original cell position. Verified
single and multiple drags in the isolated packaged app with synthetic images.
