# Project folder naming and work assets

Base: da8cd8b. Scope approved 2026-11-18.

1. Rename workspace directories with project display names; retain stable IDs. Flush writes, reject collisions and unsafe in-flight generation, update path caches and trash identity, roll back failed moves. Keep external folder rename compatibility.
2. Store editing inputs, masks and drawing layers per work. Preserve legacy flat vibe references and unrelated reference images. Update import/export, copy, template and snapshot consumers before migration.
3. Link asset retention to trash, restoration and permanent deletion. Protect references held by live projects, deleted work, queues and undo. Migrate existing work without overwriting source files; isolate unreferenced legacy candidates for review.
4. Test filesystem failure/recovery, nested edits, shared references, delete/restore and export round trips. Build and test isolated data, commit by feature, prepare installation backup/replacement after app closure.

No PR or push. No live project mutation during development or tests. No generation API calls. Preserve local desktop OAuth only in build environment. Do not classify unknown files as disposable solely from filenames or one JSON snapshot.

## Implemented behavior

- Desktop rename moves the entire workspace directory to `<new name>__<same ID prefix>`. Reject collisions and in-flight generation or external editor watches. Preserve existing Explorer folder names until an in-app rename.
- Inputs, masks and drawing layers use `outs/<source scene>/variants/<work>/vibes/`. Standalone work uses `inpaints/<work>/vibes/`. Project-wide references stay in the shared `vibes/` folder. Legacy flat names still resolve. Work duplication detaches nested metadata and copies assets. Project archives retain relative paths.
- Startup/manual maintenance migrates active and deleted work, after verified file copies. Keep original JSON and source bytes in `work-assets-backup-v2` when migrating flat files or the previous `vibes/works/<ID>/` layout; do not automatically delete this migration recovery copy.
- Trash references retain assets. Permanent deletion and other removals make only unreferenced assets eligible for cleanup. Protect current JSON, scene trash and recovery `.bak`. Loaded/queued projects defer cleanup until next startup; multiple app windows defer maintenance.
- Unreferenced files enter `vibes/.unused` for 14 days. Restore automatically if a reference reappears before cleanup; otherwise remove after retention. Missing/corrupt trash, conflicting writes, missing required input or junctions defer maintenance. Shared references remain intact.
- Scene restoration refreshes its gallery immediately. Whole-project permanent deletion continues to remove the entire project directory.

## Scene-local layout verification

The Windows Electron build migrated a flat layout and a previous `works/<ID>/` layout in an isolated project. Four input, mask and drawing files reopened from their work folders after project rename and a TAR export/import round trip. A deleted work kept its input in its own trash slot. Cross-project input copies also have a regression test.

## Previous layout validation — 2026-11-18

- Typecheck passed. Full Jest run: 220 suites / 3,055 tests passed. After runtime fixes, seven affected suites / 129 tests passed again.
- Isolated Windows Electron build with synthetic data only, network requests blocked. No generation API calls or live project mutations.
- Startup migration grouped inputs, masks and drawings, including deleted work; repeated startup retained them. Editor opened the migrated input at its original size.
- In-app rename moved the physical folder with stable ID. Favorites, linked child work and existing scene trash survived without restart. Restored work opened after rename.
- Work duplication left the original drawing metadata unchanged and allocated independent input/mask/drawing files. Delete retained assets, Ctrl+Z restored them, and the editor reopened. A restored result immediately counted as one image.
- Actual project TAR export/import: 52 entries, eight nested work assets compared byte-for-byte; imported project received a new ID. Quarantine and migration backups were excluded from the portable archive.
- Production build completed; existing local desktop Drive OAuth retained only in the built package. Runtime dependencies preserved. Installation pending app closure; do not run the candidate against live data during testing.

Local feature commits: `198508c` (project folders), `4c8da2f` (work assets), `35cd0bb` (migration/cleanup/restore). No push or PR.
