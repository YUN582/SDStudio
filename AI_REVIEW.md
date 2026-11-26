# SDStudio fork review guide

Current integration: upstream 5.8.1 features were ported under Gemini supervision on 2026-11-26. Read [the current integration review](docs/UPSTREAM_5_8_1_AI_REVIEW.md) and [validation evidence](docs/UPSTREAM_5_8_1_VALIDATION.json) first.

The source changes are pushed to the user fork. A separate review package is prepared; the installed application remains unchanged. Previous 5.8.0 merge: a918f0b396c01903242cbfd13d778078234a8781.

The remainder records the historical 2026-11-21 review handoff; its unmerged-upstream counts and test snapshot are historical. Code and documentation were authored/modified with Codex/GPT assistance. Human-facing overview: [CHANGES.ko.md](CHANGES.ko.md).

## Review scope and immutable references

| Field | Value |
| --- | --- |
| Review date | 2026-11-21, Asia/Seoul |
| Fork | [YUN582/SDStudio](https://github.com/YUN582/SDStudio) |
| Application code snapshot | `3d5ae198e8088a28007fdead3348a10587107d1b` |
| Latest upstream inspected | `0d67884e2c97041247b8566396fda71044572972` |
| Common ancestor | `99c0831d5b89174362192631e9048b4563770af5` |
| Commits beyond the common ancestor | Fork: 102; upstream: 26 |
| Fork-introduced diff | 209 files, +15,921 / -3,757 lines, including tests and documents |
| Direct latest-upstream versus fork tree diff | 298 files, +19,467 / -21,474 lines; includes upstream changes absent from the fork, so do not attribute all deletions to this fork |

The documentation commit containing this guide comes after the application snapshot; it does not change application behavior. Re-check these references if reviewing a later fork revision.

The existing port report and feature plans are dated development records, not current branch/publication status. In particular, their statements such as "no push", "installation pending", and older queue/work-creation behavior may have been superseded. Read the final code snapshot and the later commits in this guide.

Some source comments refer to private/local `SPEC_GUIDE.md` or `guides/` documents that are not tracked in this repository. Use the committed implementations/tests for review and flag missing rationale instead of assuming those documents are included in this handoff.

## Review procedure

1. Read the human overview and this guide. Inspect actual code and tests; commit titles are navigation aids, not proof of behavior.
2. Compare each desired feature against current upstream. Preserve upstream fixes for persistence, multi-window synchronization, undo, exports, and menu/accessibility behavior.
3. Choose a complete feature bundle. Several commits are follow-up fixes or reversals of earlier behavior. The bundles below are suggested review units, **not verified independent cherry-pick recipes**.
4. For storage-related work, use disposable copies with both active and deleted work, nested edits, favorites, manual order, and naming collisions. Do not run startup migration against the only copy of real data.
5. Report useful changes, overlap, required dependencies, compatibility risks, and missing evidence. Leave unrelated application/source changes and distribution decisions to a separately requested implementation step.

To select individual changes for upstream, start from its current revision and port the intended final behavior with its tests. Do not squash all fork commits into a proposed all-or-nothing patch. Do not resolve conflicts by replacing upstream files wholesale with fork versions.

## Important upstream overlap

These upstream changes are not yet integrated into the fork:

| Topic | Upstream commits to inspect | Fork area potentially affected |
| --- | --- | --- |
| Shared project/folder duplication and attached variant files | `764882f`, `226ee44`, `a17e03b` | `SessionService`, working-copy file enumeration, project creation |
| Folder/image exports and selecting variant inclusion | `122b1a7`, `b9681c0`, `27ab327`, `f7903bc` | Export settings, preset manager, gallery ownership, mobile download |
| Global-store read safety and Android background persistence | `f6cedfd`, `ba5eb86`, `6d03faf` | Global preset/library modifications must retain those protections |
| Multi-window preset/template synchronization and undo | `cab2b3a`, `e361d51`, `ebf2c4a`, `060757a`, `f42efc8`, `7dbdc4a` | Character workspace, preset actions, template/backup consumers |
| Icons, menu presentation, toolbar labels, backup controls | `ebac1f2`, `08b7010`, `4e3eb2a`, `dd11d9f`, `8006229`, `791ee08` | Shared library menus, top bar, scene controls |
| Prompt comment display, UI scale/layout, common settings components | `590fc66`, `c87f79c`, `0a5cba6`, `0d67884` | Prompt highlighting, CSS, dialogs, settings |

PR [#10](https://github.com/Dd154663/SDStudio/pull/10) (paste newline normalization) and [#11](https://github.com/Dd154663/SDStudio/pull/11) (bundled examples and automatic insertion removal) are already merged upstream and are ancestors of this review base. Do not propose duplicate changes.

## Final behavior and dependency map

| Bundle | Final behavior to review | Main implementation / verification entry points |
| --- | --- | --- |
| Prompt editing | Ctrl+3 comments include the trailing comma, not the following separator space. Weight adjustments work within comments while keeping them disabled. Adjacent active weights/autocomplete/highlights remain independent. Comments are not italic. | `PromptService.ts`, `promptTransforms.ts`, `promptAutocomplete.ts`, `PromptEditTextArea.tsx`; prompt comment/highlight/autocomplete tests |
| Random prompt choices | Preserve `||...||` candidates during parsing; resolve per generated request, including UC and character fields. Retain editable source metadata separately. Multi-line pieces split outside paired comments; exclude comment-only rows, preserve deliberately blank rows. | `promptRandomizer.ts`, `PromptService.ts`, `TaskHandlers.ts`; `promptRandomizer.test.ts`, `promptRandomizerRequest.test.ts` |
| Desktop editor / metadata | Custom editor executable; restore generation metadata to edited/copied PNGs. Metadata apply supports source sections and selected fields. Full-client modal, selectable data, and grouped parameter layout. Selection controls remain independent. | `customImageEditor.ts`, `editedImageMetadata.ts`, `ExternalImageView.tsx`, `sdstudioPromptImport.ts`; associated main-process and metadata-import tests |
| Project identity / storage | Follow stable project identity across external directory changes; rename physical folders with display names; nest linked outputs and per-work inputs; centralize auxiliary folders. See storage section. | `workspaceAccess.ts`, `projectPaths.ts`, `storageLayout.ts`, `SessionService.ts`, `variantOutputMigration.ts`, `workAssetMaintenance.ts`, `projectAuxiliaryStorage.ts` |
| Working copies | Project and folder duplication use the same working-file snapshot: preserve live images, favorites, links, masks/drawings; omit recoverable trash, unused assets and reproducible caches. | `SessionService.ts`, main `copy-folder-projects`, work-asset copy/round-trip tests |
| Combined gallery | Resolve original and variant image owners consistently for order, favorites, thumbnails, counts, selection, deletion, export, and favorite-first/latest sort. | `sceneImageVariants.ts`, `galleryReorder.ts`, `ImageService.ts`, `GameService.ts`, `ResultViewer.tsx`, `TrashService.ts`; combined-gallery tests |
| Scene merge | Choose target; merge/replace combinations. Preserve images, favorites, linked edits and gallery order despite filename collisions. | `sceneMerge.ts`, `sceneMergeCombinations.ts`, `SceneMergeDialog.tsx`; `sceneMerge.test.ts`; depends on storage and owner-aware gallery |
| Image-derived editing | Explicit new work from an image remains available even if related work exists. Record immediate parent for chained edits. Obtain the source image's single combination; character/layout handling preserves the selected sharing/copy mode. | `sourceVariant.ts`, `sourceImageCombination.ts`, `singleImageEdit.ts`, `comboSource.ts`; single-image, variant-link and source tests |
| Input / canvas | Live source input unless explicitly detached; new generated results do not silently replace the editing base. Empty mask uses I2I. Empty inpaint seed stays random. Drawing layer, erase, undo/redo, pan/zoom/view rotation, brush preview and held eyedropper/loupe. | `inpaintInput.ts`, `InPaintEditor.tsx`, `InpaintDrawingTools.tsx`, `BrushTool.tsx`, `canvasPointer.ts`, `WorkflowCanvas.tsx`; input, canvas and task-handler tests |
| Queue | Existing reservations: play resumes them without appending another full set. Empty queue: reserve the requested current scope, then play. Image-derived editing schedules only one source combination. Snapshot masks/drawings for queued work. | `generationControl.ts`, `TaskQueueService.ts`, `TaskHandlers.ts`, `GenControlWidget.tsx`; generation-control, single-image and generation-snapshot tests |
| History / quick generation | History preview returns to prior view; go-to-scene selects it. History drag transfers images and uses existing preview. Quick generation supports count, chronological browsing, and chosen random size set. | `ImageHistory.tsx`, `HistoryImageDrag.tsx`, `historyImageDrop.ts`, `QuickModeTab.tsx`, `quickResolution.ts`; history/quick tests |
| Libraries | Shared selection/checkbox visuals, stable add cards, Ctrl/Shift/box selection, keyboard focus and range movement; menus have no parenthetical counts. Character management is a global-first tab; project-local applied copies remain internal. Global add captures current settings; image add uses image metadata/profile; batch PNG export selects a directory once. | `LibraryGridSelection.tsx`, `LibraryCardVisuals.tsx`, three library surfaces, `gridSelection.ts`, `KeyboardShortcutService.ts`, `globalPresetPngExport.ts`; library keyboard/export tests |
| General UI | Project controls above workspace, generation below; optional startup help and lazy web browser; compact prompt combination cards; consistent search/toolbars and confirmation layout. | `ProjectTopBar.tsx`, `App.tsx`, `App.css`, `GenControlWidget.tsx`, `SceneEditor.tsx`, `ModalOverlay.tsx`, settings and layout tests |

Dependencies requiring particular care:

- **Storage + gallery + trash + merge:** nested output paths require owner-aware metadata and backup/restore/copy/export behavior. Taking only the UI or only a path builder is insufficient.
- **Editing + queue + source metadata:** initial work-reuse and play-append commits were corrected later. Inspect `bac791e`, `1c7ab40`, `66d85c8`, `f883739`, `0b8cbd4` together with their earlier implementations.
- **Prompt choices + comments + autocomplete:** stripping all comments before parsing NAI choice boundaries can change the grammar. Consult `7242c82`, `615c5cb`, `1049c8e`, `8dac32b` and tests as a group.
- **Library UI + keyboard:** shared hooks/components, activation markers, keyboard shortcut routing and the non-selectable add tile's grid position are one interaction change. Preserve actual card application/detail behavior.
- **Text selection:** `7594dae` added the global restriction. Later selectable-text opt-ins in `SceneEditor`, `ExternalImageView`, `ResultViewer`, the shortcut service and `index.tsx` are needed to avoid blocking copyable information.

## Storage and compatibility

This fork continues to use the existing workspace storage-v2 root; it does not replace it with an independently versioned, fully reversible new schema. Physical paths and several JSON fields still change. Treat this as a compatibility boundary.

Desktop workspace layout, simplified:

```text
workspace/<display name>__<stable ID prefix>/
  meta.json                         # ID/name/folder; auxiliaryLayout: 1 after relocation
  project.json                      # scene data/order and work references
  vibes/                            # shared project reference/profile assets; legacy tokens supported
  outs/<source scene>/
    <original image>
    variants/<work>/
      <result images>
      vibes/                        # that work's input, mask, drawing assets
  inpaints/<standalone work>/        # standalone work remains supported
    <result images>
    vibes/
  .trash/images/<relative owner>/    # deleted image files / retention metadata
  .trash/scenes/<relative owner>/    # deleted scene/work directories
  .unused/<relative asset owner>/   # quarantined unreferenced assets
  fastcache/<relative owner>/        # size-specific previews requested on demand
  variant-output-backup-v1/          # prior JSON/output recovery, when created
  work-assets-backup-v2/             # prior JSON/asset recovery, when created
```

The tree is illustrative; not every project has every directory. Legacy/mobile/deferred auxiliary layouts use fallback paths. `trash.json` remains a data-root record; keeping deleted files in a project-local directory does **not** move every metadata record into that directory.

Changed contracts / review targets:

| Contract | Implementation and required checks |
| --- | --- |
| Identity and naming | `workspaceAccess.ts` and `SessionService.ts` compare stable IDs and disk revisions. Test external rename/delete/recreate with a reused display name, duplicate IDs, missing metadata, open projects, and pending writes. Desktop in-app rename moves the physical folder; display name is not the identity. |
| Variant location | `variantOutputMigration.ts` relocates linked results under the root source scene; `sourceInpaint` records immediate parent independently. Preserve ordinary/standalone work, nested chains, filename collision handling and source mapping. Old work without an immediate-parent record cannot be reliably reconstructed just from names. |
| Work assets | `workAssets.ts` / `workAssetMaintenance.ts` handle legacy flat tokens, prior `vibes/works/<ID>/` tokens, and per-work `vibes` tokens. `sdstudio.workAssets.v1` tracks managed work identity. Queued masks/drawings are snapshots; new results must not replace the base. |
| Auxiliary relocation | `projectAuxiliaryStorage.ts` plans moves and rolls back failed renames; `workspaceAccess.ts` writes `meta.json.auxiliaryLayout = 1` after relocation. Test locked destinations, partially relocated roots, collisions, and links/junctions. Failed relocation must remain on compatible deferred paths. |
| Cleanup | `workAssetMaintenance.ts` cross-checks live/deleted references and recovery records. Unreferenced eligible assets enter `.unused`; retention is 14 days. Missing/corrupt trash, required inputs, conflicting writes, and active/queued/multi-window access need conservative handling. Review deletion eligibility, not merely folder names. |
| Recovery | Output and work-asset migration backup folders are recovery evidence; do not equate them to a full-data-root backup or a tested downgrade procedure. Auxiliary relocation and other changes do not all have the same recovery mechanism. |
| Favorites/order | `__sdstudioGalleryOrderV1` and owner-aware gallery entries combine original and edited outputs. Test rename, moving/copying work, merge collisions, trash/undo, preview pixels, and export ordering. |
| Copy/archive/template consumers | Project/folder working copies and portable export/import must include required work inputs/masks/drawings. Trash/quarantine/cache exclusions differ from disaster-recovery backups. Inspect the actual file-enumeration policy for each consumer. |

Minimum compatibility scenarios before accepting the storage bundle:

1. Clone a legacy project containing originals, linked/standalone/chained work, masks, drawings, favorites, deleted work/images, and a shared vibe reference. Load/migrate, reopen, and repeat startup; verify bytes and references.
2. In-app and Explorer rename; external delete/recreate with the same name; collision/locked-file failure. Verify no stale writes resurrect or overwrite another project.
3. Delete, undo/redo, restore, permanently delete, then run cleanup. Active, queued, shared and recoverable references must remain valid; verify both pre- and post-retention behavior.
4. Duplicate project and folder; export/import; reopen work and compare masks/drawings/results. Confirm omissions are limited to intentionally excluded files.
5. Test multiple windows and relevant mobile/platform fallbacks. Do not assume Windows synthetic-fixture acceptance covers these configurations or downgrade behavior.

## Validation

Fresh checks on 2026-11-21 for application snapshot `3d5ae19`:

| Check | Result |
| --- | --- |
| `npm test -- --runInBand --silent` | **236 suites passed, 2 failed; 3,202 tests passed, 2 failed; 3,204 total.** About 164 seconds. |
| `npm run typecheck` | Passed. |
| Merge simulation with inspected upstream | Conflicts in 24 files; no combined integration build/test was performed. |
| Production build / app replacement during this documentation handoff | Not performed. Application code and the installed app were left unchanged. |

Unresolved failures, not hidden by changing application behavior or weakening tests:

1. `src/renderer/models/__tests__/pcUxDefects4.test.tsx`, `하드코딩 bg-{색}-500 잔존 = 제외 목록 / 파일별 건수 정확 일치`: the expected map still includes one `bg-...-500` occurrence in `CharacterPresetCards.tsx`; the current shared selection implementation has none there. Review and update this stale exact-count expectation while preserving the intended shared card style. It is not an observed runtime rendering failure.
2. `src/renderer/models/__tests__/specGuard.test.ts`, `ModalOverlay 자식 vh 높이 — 높이 규칙 우선순위(2026-11-15)`: `ResolutionPicker.tsx:148` introduces `max-h-[70vh]`, which the repository's frozen-height guard disallows. Although this is a popover, the current guard explicitly covers popovers too. Review the popup height/scroll policy; do not simply disable the rule or claim this failure is a timeout.

The current snapshot is therefore **not an all-green test baseline**. Full test output was inspected locally; the actionable failure details are reproduced here without including local test profiles, logs, account data or packaged binaries.

An isolated rerun of those two suites reproduced the same two failures: 49 tests passed, 2 failed, 51 total. These failures were not attributed to resource contention.

Historical evidence, scope-limited:

- The Nov 17 source-port report records a full main/renderer production build and earlier full-suite results, followed by later changes.
- Later isolated Windows/Electron runs exercised synthetic storage migrations, project rename, work duplication, trash/restore, project archive round trips and native canvas gestures. See [PROJECT_ASSET_STORAGE.md](docs/PROJECT_ASSET_STORAGE.md) and [VARIANT_GRID_FOLLOWUP.md](docs/VARIANT_GRID_FOLLOWUP.md). These are not current-upstream integration acceptance.
- The final library-selection snapshot has a passing two-suite/10-test run and isolated Electron smoke for all three libraries, matching box/checkbox styles, stable add-card positions, and actual keyboard selection.
- Later focused prompt-request checks covered standard/I2I/inpaint final strings and raw editable metadata separately. Treat raw source metadata and conditioning input as distinct fields.
- No live paid generation, Android/macOS device run, or combined latest-upstream build was performed for this handoff. Local Windows usage and mock/offline tests do not establish model-output parity or exhaustive data compatibility.
- No package manifests, lockfiles, native package manifest or release/app dependency manifest differ from the common ancestor in this fork's patch set. Local smoke/package scripts and binaries are not a portable substitute for a clean build.
- Repository build workflows are manual/release-triggered; opening or linking this fork does not imply that a PR CI build has run. A clean desktop build needs the normal native dependencies. Drive OAuth client settings, when needed, are supplied through the existing build environment variables.

Suggested review commands, after dependency setup and in a disposable checkout:

```text
git diff 99c0831..3d5ae19 -- <feature paths>
git log --reverse --oneline 99c0831..3d5ae19 -- <feature paths>
npm test -- --runInBand
npm run typecheck
npm run build
```

Run the full tests and production build sequentially when diagnosing timeouts; an earlier concurrent run had a timeout that passed in isolation.

## Automatically generated appendices

The conflict list and complete 102-commit catalogue below refer to the immutable snapshots at the top. They are not statements that every commit can be accepted independently.

<!-- GENERATED_REVIEW_APPENDICES -->

## Merge simulation with latest inspected upstream

A local `git merge-tree --write-tree --name-only --no-messages 0d67884e2c97041247b8566396fda71044572972 3d5ae198e8088a28007fdead3348a10587107d1b` simulation returned exit code 1 and **24 conflicted files**. No integration commit was made, and the checkout was not replaced by a merge result. Resolving textual conflicts alone will not prove behavioral compatibility.

```text
src/renderer/componenets/App.css
src/renderer/componenets/AppContextMenu.tsx
src/renderer/componenets/CharacterPresetCards.tsx
src/renderer/componenets/CharacterPresetEditor.tsx
src/renderer/componenets/ConfigPersonalTab.tsx
src/renderer/componenets/DirectExportDialog.tsx
src/renderer/componenets/ExportSettingsFields.tsx
src/renderer/componenets/GlobalPresetTab.tsx
src/renderer/componenets/InPaintEditor.tsx
src/renderer/componenets/PromptEditTextArea.tsx
src/renderer/componenets/ResultViewer.tsx
src/renderer/componenets/SceneEditor.tsx
src/renderer/componenets/SceneQueueControl.tsx
src/renderer/componenets/SessionSelect.tsx
src/renderer/componenets/TaskQueueControl.tsx
src/renderer/componenets/TobBar.tsx
src/renderer/models/AppService.ts
src/renderer/models/ExportPresetService.ts
src/renderer/models/SessionService.ts
src/renderer/models/__tests__/projectBarLabels.test.tsx
src/renderer/models/configSync.ts
src/renderer/models/exportSettings.ts
src/renderer/models/iconDictionary.ts
src/renderer/models/uiLayout.ts
```

## Complete fork commit catalogue

Each commit appears once under a primary review category. Cross-category dependencies are described above. Original commit titles are retained; later commits can supersede an earlier title/implementation.

### Prompt editing and choice resolution — 12 commits

| Commit | Date | Original title |
| --- | --- | --- |
| [`25f307b`](https://github.com/YUN582/SDStudio/commit/25f307b788394cf2be98d6ad8e800a63c1cf99c5) | 2026-11-17 | fix(prompt): keep weight adjustments outside comments |
| [`0e75c84`](https://github.com/YUN582/SDStudio/commit/0e75c84d07c23d58a0dd419dcef3d9332da0e379) | 2026-11-17 | feat(prompt): toggle comments with Ctrl+3 including separators |
| [`8eb8deb`](https://github.com/YUN582/SDStudio/commit/8eb8deb95cb07c4eacf4491aec7628b756c32d8f) | 2026-11-18 | fix: keep space after a commented prompt comma |
| [`ffb3183`](https://github.com/YUN582/SDStudio/commit/ffb31838c04310cd061ec1d0a09f64a523591ae3) | 2026-11-18 | fix: adjust weights inside prompt comments |
| [`3e05b8b`](https://github.com/YUN582/SDStudio/commit/3e05b8b3789f9de6628b7db21b9364851eda753a) | 2026-11-19 | fix: highlight weighted tags beside comments |
| [`036de98`](https://github.com/YUN582/SDStudio/commit/036de985bd4913603b74bd90390dba888d1fda40) | 2026-11-19 | fix: exclude padding from weight highlights |
| [`7242c82`](https://github.com/YUN582/SDStudio/commit/7242c8233cb04c69ac431dbd3276563d3c521486) | 2026-11-19 | feat: resolve NAI prompt choices per image |
| [`feefa0a`](https://github.com/YUN582/SDStudio/commit/feefa0abe967d9df90b17396d25b684644b46e3f) | 2026-11-19 | style: layer randomizer prompt highlights |
| [`615c5cb`](https://github.com/YUN582/SDStudio/commit/615c5cb2c665039b0ecdcd827bca2d05dd7731ea) | 2026-11-19 | fix: autocomplete prompt choices after pipes |
| [`1049c8e`](https://github.com/YUN582/SDStudio/commit/1049c8eaf930bce6d04ba1179cb67e3e54d7478b) | 2026-11-19 | fix: autocomplete tags beside prompt comments |
| [`8dac32b`](https://github.com/YUN582/SDStudio/commit/8dac32b793a811e68269b999bb66e9c95b84a10d) | 2026-11-19 | fix: exclude commented random piece rows |
| [`b400412`](https://github.com/YUN582/SDStudio/commit/b4004126a4391be6302677ff31132c3b1e49c2a5) | 2026-11-19 | style: remove italics from prompt comments |

### External editor and generation metadata — 10 commits

| Commit | Date | Original title |
| --- | --- | --- |
| [`b8d05de`](https://github.com/YUN582/SDStudio/commit/b8d05de0adfdd179d09212601cc05ea7fa2f83df) | 2026-11-17 | feat(editor): support a custom Windows image editor |
| [`49be606`](https://github.com/YUN582/SDStudio/commit/49be6061c2499a40c669c4a75bd1b711889e3f2e) | 2026-11-17 | feat(editor): restore generation metadata to exported PNG copies |
| [`da8cd8b`](https://github.com/YUN582/SDStudio/commit/da8cd8bf117a916b1bba38449a71d32485c7ac42) | 2026-11-17 | fix(metadata): preserve source combinations on edit |
| [`847b50f`](https://github.com/YUN582/SDStudio/commit/847b50f991d0934ccbbdeddb7c5ad99cb601b3a3) | 2026-11-18 | feat: show image metadata from context menus |
| [`13181f4`](https://github.com/YUN582/SDStudio/commit/13181f41b2fabb10204329bd1c00d24068fe6fb2) | 2026-11-19 | feat: streamline metadata import overlay |
| [`1945312`](https://github.com/YUN582/SDStudio/commit/19453129d42546d317f70ac2ffa0f5f559802ff8) | 2026-11-19 | feat: simplify and expand metadata import |
| [`d06f967`](https://github.com/YUN582/SDStudio/commit/d06f967bbec772a4c81347699a348a391dc9bd35) | 2026-11-19 | fix: apply metadata without extra confirmation |
| [`efaff44`](https://github.com/YUN582/SDStudio/commit/efaff44bea9d23fc0bc19d804b4be29648e45067) | 2026-11-19 | fix: allow copying and compact metadata details |
| [`ec41f7d`](https://github.com/YUN582/SDStudio/commit/ec41f7d020fd7e11481a91d0612151cc07cd7d69) | 2026-11-19 | fix: allow selecting image detail text |
| [`a823fa5`](https://github.com/YUN582/SDStudio/commit/a823fa56ae3b433eebe836a1d3eacdb03f2f210f) | 2026-11-19 | style: align seed and resolution in two columns |

### Project identity, storage, migration and working copies — 13 commits

| Commit | Date | Original title |
| --- | --- | --- |
| [`a1c7452`](https://github.com/YUN582/SDStudio/commit/a1c7452cecccd1f058d5edaf108c39eeefd4e85a) | 2026-11-17 | feat(storage): nest linked variant outputs under source scenes |
| [`f09027d`](https://github.com/YUN582/SDStudio/commit/f09027d400870ed0950d7d2bb2eeac251b8932f8) | 2026-11-17 | fix(windows): avoid locking nested image directories with watchers |
| [`74d998e`](https://github.com/YUN582/SDStudio/commit/74d998e2970e13026a061278cf0ed926cee81a8d) | 2026-11-17 | fix(workspace): follow project identity across external folder changes |
| [`8192c45`](https://github.com/YUN582/SDStudio/commit/8192c456c29a07aa31ee8bb6f18f151cede6500e) | 2026-11-17 | feat(storage): migrate unused variant outputs from system settings |
| [`a778b7b`](https://github.com/YUN582/SDStudio/commit/a778b7bb235b9a3c897745a9421a673f6fd3d7ab) | 2026-11-17 | fix(projects): preserve galleries after renaming |
| [`198508c`](https://github.com/YUN582/SDStudio/commit/198508c7bb94dfaeb235cdc8ea3e693ab5b8662d) | 2026-11-18 | feat(projects): rename workspace folders with projects |
| [`4c8da2f`](https://github.com/YUN582/SDStudio/commit/4c8da2f49963bb4d3f319dcd9ca31ee2734b5672) | 2026-11-18 | feat(storage): group variant work assets |
| [`35cd0bb`](https://github.com/YUN582/SDStudio/commit/35cd0bb198bc038c815b9fd62dbef2b3c4e48793) | 2026-11-18 | feat(storage): retain and clean unused work assets |
| [`3e4b4d4`](https://github.com/YUN582/SDStudio/commit/3e4b4d42af70634084fe42cb024c0b5baa4ec77e) | 2026-11-18 | docs: record project asset migration checks |
| [`e8d9c3d`](https://github.com/YUN582/SDStudio/commit/e8d9c3da38ee07e64f48bf74b9ad43febf4f7e7b) | 2026-11-18 | feat(storage): keep editing assets inside each work folder |
| [`ac97786`](https://github.com/YUN582/SDStudio/commit/ac977868a6aa600e0a397b0600458361609de1de) | 2026-11-18 | fix: share working project copies across folder duplication |
| [`0b8cbd4`](https://github.com/YUN582/SDStudio/commit/0b8cbd420a5fcd4ab2e8aed750d37153c1756a52) | 2026-11-18 | fix: keep queued inpaint mask snapshots in memory |
| [`9012e53`](https://github.com/YUN582/SDStudio/commit/9012e534cc35819d1518d5480cb8c7161a48c10c) | 2026-11-18 | feat: centralize desktop project trash, thumbnails and unused assets |

### Gallery, selection, ordering, favorites and export — 14 commits

| Commit | Date | Original title |
| --- | --- | --- |
| [`6784c4a`](https://github.com/YUN582/SDStudio/commit/6784c4a7aa261bb17cfca1ff8cd3f7798c3832fe) | 2026-11-17 | fix(viewer): retain image and upscale state across list refreshes |
| [`b4b31e9`](https://github.com/YUN582/SDStudio/commit/b4b31e9320de25b462435ef70d02829c9803674c) | 2026-11-17 | feat(gallery): browse linked variants with synchronized scene navigation |
| [`db73c4c`](https://github.com/YUN582/SDStudio/commit/db73c4c042f8ce47092431d6f8c511c6912746d0) | 2026-11-17 | feat(export): export selected images through existing presets and dialogs |
| [`d206310`](https://github.com/YUN582/SDStudio/commit/d206310b8c3172232b4c1c87d5d9564f1890ce2b) | 2026-11-17 | fix(gallery): share variant ordering, favorites and export ownership |
| [`06c4661`](https://github.com/YUN582/SDStudio/commit/06c4661adff239d7d56221674d7559684e336a03) | 2026-11-17 | test(gallery): type the variant favorite fixture |
| [`8d19451`](https://github.com/YUN582/SDStudio/commit/8d1945144b9bc4eb66ce0e08400d8cfa5a01c459) | 2026-11-17 | feat(gallery): unify modifier selection and scrollable multi-card reordering |
| [`2d6847b`](https://github.com/YUN582/SDStudio/commit/2d6847b57d67ea01a210854458a847791f9b718e) | 2026-11-17 | fix(gallery): retain deletion scope choices for variant-only scenes |
| [`89bd200`](https://github.com/YUN582/SDStudio/commit/89bd200a7d0b783b0b692d93c3341e7d4c974bd5) | 2026-11-17 | fix(viewer): stabilize detail layout and retain scene keyboard navigation |
| [`99f11c7`](https://github.com/YUN582/SDStudio/commit/99f11c71fa60bee948afdfaef08cba6512d88d10) | 2026-11-17 | fix: choose scene previews in combined favorite order |
| [`db27d06`](https://github.com/YUN582/SDStudio/commit/db27d067903280acb01494dcd73367b9cec308cf) | 2026-11-17 | feat: unify scene and image grid keyboard range selection |
| [`63b9bea`](https://github.com/YUN582/SDStudio/commit/63b9beac317c7f4540c31f608c9c79c1547c5de0) | 2026-11-17 | fix(grid): align dragged image pixels with the floating card |
| [`a9a7402`](https://github.com/YUN582/SDStudio/commit/a9a7402cd7e0248c4167efcc16b47c53013b9b96) | 2026-11-17 | feat(gallery): add favorite-first newest image sorting |
| [`7594dae`](https://github.com/YUN582/SDStudio/commit/7594daea831a2e646b3b77704ca87ee9aec28b24) | 2026-11-17 | fix(ui): prevent document selection outside text fields |
| [`3c6e2ea`](https://github.com/YUN582/SDStudio/commit/3c6e2eadf249a821eabca01bcea7239963125bd0) | 2026-11-17 | fix(ui): clarify variant badges and prompt comments |

### Scene merging — 2 commits

| Commit | Date | Original title |
| --- | --- | --- |
| [`d118950`](https://github.com/YUN582/SDStudio/commit/d118950a37de48815edc3e7ec6015b48788f9351) | 2026-11-17 | feat(scenes): merge combinations, images, favorites and linked work |
| [`b4e427b`](https://github.com/YUN582/SDStudio/commit/b4e427bb6c1174588688d85a4bd915fbf3adac26) | 2026-11-17 | fix(scenes): retain combined gallery order when merging scenes |

### Image-derived work, inpaint input and canvas tools — 9 commits

| Commit | Date | Original title |
| --- | --- | --- |
| [`cdc058b`](https://github.com/YUN582/SDStudio/commit/cdc058b3a1f4019fd35c645952decb3ea722d95a) | 2026-11-17 | fix(inpaint): use a random seed when its seed is empty |
| [`d81881f`](https://github.com/YUN582/SDStudio/commit/d81881ff230164a57e9569d88b6cb14bb9b7bbc1) | 2026-11-17 | fix(inpaint): resolve live input and use I2I for empty masks |
| [`cef10e4`](https://github.com/YUN582/SDStudio/commit/cef10e435d6d8e35a8e65a8b908107fa3a808340) | 2026-11-17 | fix(variants): derive reusable edit work from a single source image |
| [`3fe35ed`](https://github.com/YUN582/SDStudio/commit/3fe35ed5e0e8179e1728ca52c698ee2c5fa88ad0) | 2026-11-17 | feat(inpaint): add drawing history, brush gestures and shared queue controls |
| [`187907e`](https://github.com/YUN582/SDStudio/commit/187907ebb48b40d50328c095d96a233f18f497c4) | 2026-11-17 | feat(viewer): manage linked edit work below image details |
| [`bac791e`](https://github.com/YUN582/SDStudio/commit/bac791e9e4e23a22644b4c6149f1196eee35ac59) | 2026-11-17 | fix: restore variant creation choices and immediate source links |
| [`1c7ab40`](https://github.com/YUN582/SDStudio/commit/1c7ab40ecec0b0d6eb71aeed80f3d1159cbf79f0) | 2026-11-17 | fix(inpaint): preserve only the source image combination across layouts |
| [`f883739`](https://github.com/YUN582/SDStudio/commit/f8837392e6f49e5f0b3f2ed56a678595c70f877c) | 2026-11-17 | fix(inpaint): exclude disabled characters from single-prompt jobs |
| [`e1b4348`](https://github.com/YUN582/SDStudio/commit/e1b4348d87e6c5351b9f8d63b321c90d03f0d6d4) | 2026-11-17 | fix(inpaint): restore eraser and input recovery |

### Generation queue and play behavior — 2 commits

| Commit | Date | Original title |
| --- | --- | --- |
| [`5801e51`](https://github.com/YUN582/SDStudio/commit/5801e51a4748f1c492ade1b5ba714ae847698bff) | 2026-11-17 | feat(queue): append the current scope before playing generation |
| [`66d85c8`](https://github.com/YUN582/SDStudio/commit/66d85c84acd4cab71851ad9748a2ec307d7e43e8) | 2026-11-17 | fix(queue): resume pending tasks without adding new reservations |

### History and quick generation — 7 commits

| Commit | Date | Original title |
| --- | --- | --- |
| [`cd56630`](https://github.com/YUN582/SDStudio/commit/cd56630ed2575b9a4d7545bc5fad5994b20670c8) | 2026-11-17 | feat(history): open image previews without leaving the current view |
| [`0a68f41`](https://github.com/YUN582/SDStudio/commit/0a68f4153f28dc316da842eb2659b784099fbfff) | 2026-11-18 | feat: drag history images to desktop apps |
| [`b868b78`](https://github.com/YUN582/SDStudio/commit/b868b7892f190f5e7d69dbaef0168d76f2e05abc) | 2026-11-18 | feat: choose quick generation count |
| [`ff85a5d`](https://github.com/YUN582/SDStudio/commit/ff85a5d08a1f43fd377dd89434cd9b4ba515a84f) | 2026-11-18 | feat: move history images with shared drag feedback |
| [`a5e6766`](https://github.com/YUN582/SDStudio/commit/a5e6766c25f9a53613118f852e8aca6d11751423) | 2026-11-18 | feat: browse quick generation images with arrows |
| [`07aaf5c`](https://github.com/YUN582/SDStudio/commit/07aaf5c1499a1dcaedd7e17c757f17ea12e9327f) | 2026-11-18 | fix: restore quick image arrow navigation |
| [`bfedcc0`](https://github.com/YUN582/SDStudio/commit/bfedcc06dc2023e9ffaab931ce7beeab1095ee51) | 2026-11-19 | feat: randomize quick generation image sizes |

### Preset libraries and shared library controls — 17 commits

| Commit | Date | Original title |
| --- | --- | --- |
| [`4ff0a73`](https://github.com/YUN582/SDStudio/commit/4ff0a73be325760b37a13a566ec246255f55a196) | 2026-11-18 | Align library search toolbars and add a new global preset card |
| [`d071e51`](https://github.com/YUN582/SDStudio/commit/d071e51c898456e0fb116f36fbe52f9017b2e206) | 2026-11-18 | Reuse scene grid dragging for persistent global preset ordering |
| [`3f7ce9b`](https://github.com/YUN582/SDStudio/commit/3f7ce9bf2ccc509e1d352ff7282a0bf41b280e8e) | 2026-11-18 | Share the scene grid header across preset and artist libraries |
| [`f879575`](https://github.com/YUN582/SDStudio/commit/f8795757a1cc4762e8c922ba4ed42ae7d2b6b93b) | 2026-11-18 | fix: save current settings from global preset add |
| [`777366b`](https://github.com/YUN582/SDStudio/commit/777366bed9d1b839bf60fd823a1f2455545259b6) | 2026-11-19 | feat: select library cards with modifiers |
| [`d390171`](https://github.com/YUN582/SDStudio/commit/d390171041c39112b9cb0c2b2b1c159e810db647) | 2026-11-19 | feat: add character preset workspace |
| [`e250101`](https://github.com/YUN582/SDStudio/commit/e250101cc4d42c3c6ffbb461b806bbd111ff972a) | 2026-11-19 | style: clarify character preset toolbar |
| [`5fd785a`](https://github.com/YUN582/SDStudio/commit/5fd785af917e01f3804945f90bf08463c5d8c8b8) | 2026-11-19 | feat: apply global presets by card click |
| [`2b8a243`](https://github.com/YUN582/SDStudio/commit/2b8a243c066fb5d7b6661f73951040ac9d724b83) | 2026-11-19 | style: align artist library card actions |
| [`1499df1`](https://github.com/YUN582/SDStudio/commit/1499df1f8a1a10157759a996566fe1354592d0a3) | 2026-11-19 | fix: show one character application toast |
| [`0f9e89b`](https://github.com/YUN582/SDStudio/commit/0f9e89ba3a6d34eb21f62d85885c5fb9ad895332) | 2026-11-19 | feat: add library card context menus |
| [`b0f7b22`](https://github.com/YUN582/SDStudio/commit/b0f7b220656ea52a078c59d9bb9b590e2f184b36) | 2026-11-19 | feat: export selected presets as PNGs |
| [`824ceb7`](https://github.com/YUN582/SDStudio/commit/824ceb7110a4018a3f1a9d5a0504ab52f7dad2b1) | 2026-11-19 | style: unify library preset cards |
| [`18c9311`](https://github.com/YUN582/SDStudio/commit/18c93118cbddbbc520348d7270df6cf92f23eead) | 2026-11-19 | fix: remove hover effects from add cards |
| [`3ca0d5c`](https://github.com/YUN582/SDStudio/commit/3ca0d5c613ea262a66568e1fb4e4d5513844799c) | 2026-11-19 | fix: add preset saving to history image menus |
| [`ceeec53`](https://github.com/YUN582/SDStudio/commit/ceeec531fc734dacc62ceae3392ce6e95684d36c) | 2026-11-19 | style: shorten image preset menu label |
| [`3d5ae19`](https://github.com/YUN582/SDStudio/commit/3d5ae198e8088a28007fdead3348a10587107d1b) | 2026-11-19 | feat: unify library selection and keyboard controls |

### General UI, layout, settings and dialogs — 12 commits

| Commit | Date | Original title |
| --- | --- | --- |
| [`2152998`](https://github.com/YUN582/SDStudio/commit/21529988fd38fefb43c44380966c6fb19b01ec91) | 2026-11-17 | feat(context-menu): edit images and suppress unrelated native menus |
| [`002b329`](https://github.com/YUN582/SDStudio/commit/002b329582e44f72c211be42aa645c99cacbb841) | 2026-11-17 | fix(dialog): center confirmation actions and align opt-out checkboxes |
| [`b71289a`](https://github.com/YUN582/SDStudio/commit/b71289ab3c8707d9d94d5c06bf99c18e1bbbf634) | 2026-11-17 | feat(editor): improve prompt combination cards |
| [`7ae0739`](https://github.com/YUN582/SDStudio/commit/7ae073932442a01e5cb40162db78a70da4f4d9ac) | 2026-11-18 | Make desktop web search optional and start its browser on demand |
| [`9afd884`](https://github.com/YUN582/SDStudio/commit/9afd8841b650bde86b3797cdf30c71cad6ba0bef) | 2026-11-18 | feat: skip style deletion prompts for the session |
| [`dbf6cd5`](https://github.com/YUN582/SDStudio/commit/dbf6cd5474399944c40f3379538a3f325c5bca85) | 2026-11-18 | ui: place undo controls beside generation count |
| [`e967c0e`](https://github.com/YUN582/SDStudio/commit/e967c0e67cce4a5f28c8a4db9e36a60eb6d54fd8) | 2026-11-18 | feat: expand prompt editor with find and replace |
| [`aed2a79`](https://github.com/YUN582/SDStudio/commit/aed2a79326c57e69c51e16142f73ca5963dd3a73) | 2026-11-18 | ui: reduce expanded prompt editor height |
| [`1488285`](https://github.com/YUN582/SDStudio/commit/1488285adbe644c2d0c5419a2e0acea1e2015654) | 2026-11-19 | feat: move project controls above workspace |
| [`54c4d95`](https://github.com/YUN582/SDStudio/commit/54c4d9564daf2c2ee38a379f7b2b4b6ce3fd4679) | 2026-11-19 | feat: make startup shortcut help optional |
| [`ee8e45b`](https://github.com/YUN582/SDStudio/commit/ee8e45b2ccb597b6a668bcee73c642546c7f3ec7) | 2026-11-19 | refactor: compact title and app status bars |
| [`7a522cc`](https://github.com/YUN582/SDStudio/commit/7a522cc64a1f6eebe9c8568448daeacaf188b993) | 2026-11-19 | fix: restore generation control docking |

### Port validation and historical reports — 4 commits

| Commit | Date | Original title |
| --- | --- | --- |
| [`d671fdd`](https://github.com/YUN582/SDStudio/commit/d671fddaff77b3d27f7211c312f285436a91c8d2) | 2026-11-17 | test(ui): align regression checks with persistent search and themed controls |
| [`4509f5a`](https://github.com/YUN582/SDStudio/commit/4509f5a355439fbf752d6baec42ce49c4d505155) | 2026-11-17 | docs: record patch coverage, validation and small PR candidates |
| [`4b551f4`](https://github.com/YUN582/SDStudio/commit/4b551f4d7c5ef5e1af4392745bd080903fcb2158) | 2026-11-17 | docs: record source build regression validation |
| [`2d22865`](https://github.com/YUN582/SDStudio/commit/2d228659ef76241a87835bad8708418c73621eca) | 2026-11-17 | docs: record verified local source build installation |
