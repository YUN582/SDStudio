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

Installation replacement is pending the local release configuration decision.
The earlier port report describes the state before this follow-up; its statement
that no packaged app had been tested is superseded by the checks above.
