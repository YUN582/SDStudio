# Upstream 5.8.0 integration review

Codex/GPT-assisted integration, 2026-11-25. Human-readable decisions: [Korean overview](UPSTREAM_5_8_INTEGRATION.ko.md). Machine-readable validation: [results](UPSTREAM_5_8_VALIDATION.json).

## Follow-up review and approved viewer implementation

Gemini review confirmed actual merge regressions, not only source-test mismatches. Follow-up menu/overlay fixes and preset-editor watcher ordering are recorded separately from the viewer redesign. The user approved Gemini's prototype before Gemini implemented the production UI. Codex reviewed integration, tested it, preserved runtime dependencies and local Drive configuration, backed up the installed archive, installed the verified package and relaunched it.

- Consolidate duplicate image edit, metadata/settings and history global-preset entries. Wire visible edit/metadata actions to actual handlers. History supplies scene context only for the current project.
- Render `FloatViewPane`, propagate `headerSlot` updates, and retain per-pane `FloatViewActiveContext` so only the top overlay accepts its keyboard actions.
- Portal `SceneQueueMenu` into the nearest theme root. Start image watching only after external editor launch succeeds.
- The viewer uses `ImageDetailInfo`, `buildImageDetailInfo`, `detailWideColumns` and the persisted `imageDetailInfoOpen`. Header icons retain actual image owners; transform choices use `ModalOverlay` and include all registered workflows, quick variants and the real upscale cost. Metadata restoration remains in the backend; only its viewer button was removed. History and nested result callers enable the same header slot. V2 callbacks remain explicit.
- Rendered behavior coverage: 5 suites / 62 tests passed, including 15 new detail-view tests for owners, modal key isolation, V2 actions, stale image/metadata requests, cache invalidation, retry and unsupported-upscale pixel dimensions. TypeScript check and production builds passed.
- Related full subset: 9 suites / 96 passed / 21 failed. Legacy assertions about source identifiers, exact JSX/CSS placement, duplicated menu entries and the old upscale button remain visible; they were not rewritten to claim a green suite. See [follow-up results](VIEWER_UI_VALIDATION_20261125.json) for exact failing names.
- Isolated Windows runtime: synthetic project only, network requests blocked. Verified favorite/bookmark toggles, all four editable transform workflows, live upscale cost, modal Escape/background-key isolation, one-step image navigation, nested viewer activation, selectable metadata and invariant header/toolbar/image-area heights. No paid generation request was sent. Android/iOS runtime and new paid generation outputs were not exercised.

The original full-run inventory below remains historical evidence. These focused fixes do not establish that all 126 failed tests are resolved. Unwired upstream viewer details, retained fork interactions and brittle source assertions need separate review.

## Exact references

- Upstream: `Dd154663/SDStudio`, `d95c674061aef309bbc506aaaea3d61790451b96` (5.8.0).
- Fork before integration: `YUN582/SDStudio`, `c3b29d401cf52d26cd68f696ba02cd9de84fd6d6`.
- Integration merge: `a918f0b396c01903242cbfd13d778078234a8781`; both references are its parents.
- Common ancestor: `99c0831d5b89174362192631e9048b4563770af5`.
- Upstream commits since ancestor: 63. Initial conflicting paths: 55.
- Local recovery branch: `backup/pre-upstream-20261125`.

The merge initially accepted nonconflicting hunks and preferred fork hunks at direct conflicts. That intermediate automatic result did not compile and was not deployed. Resolutions were then checked by final behavior. Two read-only reviewers audited storage/copy and prompt/library/queue overlap. The primary agent implemented and verified resolutions.

## Accepted upstream contracts

- StoreFile write guards, held entries, recovery copies, multi-window merge and global library trash. Global character storage uses upstream format. Reorder respects `canWrite()`.
- Global delete undo wrappers and trash UI are wired into fork library controls. PNG batch export uses upstream platform handling.
- Project trash captures template assignments before save and releases them only afterward; restore applies sidecars before list notification.
- V5 Full/Curated references, source dimensions and `preferSameOutfit`. ExternalImageView retains fork section/reference selection; no invented source dimensions.
- Windows root watcher uses `createImageChangeDetector`, root-loss shutdown and error cleanup; fork project-ID/rename/work maintenance remains.
- Shared export stages and folder export choices. Fork owner-aware gallery entries provide paths, favorites and exact image selection. Both legacy single-scene picks and owner maps are accepted.
- Quick count is stored in quick scene metadata, separately from ordinary generation count. Fork random resolution and chronological right-is-newer navigation remain.

## Storage resolutions requiring care

- Do not replace `sceneOutputDir`, per-work vibes, project auxiliary paths, recursive working-copy filters or stable project IDs with upstream flat path assumptions.
- `sceneCopyFlow` clones work assets with actual source/target sessions before publishing a work. A work copied alone across projects is detached from foreign scene/source-work links. Legacy asset tokens keep their prefixes.
- `importSessionShallow` materializes a real Session so owned asset paths can resolve. Work inputs are cloned and detached; shared vibes and references are copied separately. Folder shallow cloning uses the same entry point.
- `cloneWorkAssets` rehydrates presets through `fromJSON` when available. Assigning serialized vibe/reference arrays directly destroys item methods and breaks later serialization. Metadata is detached before reference replacement.
- Global profile/character image replacement saves the new record before deleting old images. Active entries and trash references protect shared files. A failed save retains old files.
- Deep copy and archives preserve nested result paths and owned input/mask/drawing references. Native round trips covered both legacy root-vibes and migrated work-vibes fixtures. Live personal projects were not test fixtures.

## Prompt and interaction resolutions

- Active-text highlighting and comment ranges use one consistent representation; automatic merge remnants were removed.
- PC/mobile autocomplete share comment-aware boundaries and include `|`, CR and LF. Completion does not insert a new space after a comment; actual separator whitespace is preserved.
- Fork randomizer parsing stays ahead of final comment removal. Do not strip comments before choosing candidates when that would destroy pipe structure.
- Fork Ctrl+3 includes a following comma, leaves following separator spaces outside, and supports selections. This intentionally differs from upstream exact-selection expectations.
- Inline find controls use upstream helpers; expanded prompt editing retains the fork portal, blur, search/replace and explicit closing behavior. Caret-coordinate retry checks selection again after animation-frame delay.
- Queue and SDWorkFlow retain one source-image combination, empty-mask I2I, drawing/live-input behavior, source metadata and existing-queue resume rules. No paid generation request was made.
- History uses the fork image viewer and internal/external drag behavior. Preview state gates background scene/grid actions while allowing its own active viewer and undo. Both panel and mobile drawer pass the opening callback.

## Retained UI differences

Fork library selection, keyboard focus, card captions/hover, persistent first add-card, top project controls, generation dock, inpaint tools and stable detail layout remain. Scene-card sizing accepts the new grid control. Upstream image-detail layout/collapse and separate view-order controls were not substituted wholesale for the fork viewer and persisted favorite/newest sort.

These choices leave upstream tests that inspect exact source strings, CSS classes, component counts or replaced UI structure failing. Keep those failures visible. Do not delete guards or report the default suite green. Some prompt boundary expectations also differ deliberately. Read the JSON inventory before deciding whether an individual failure is an intentional difference or a regression.

## Verification and limits

- TypeScript check and production main/renderer builds passed.
- Core subset in final full run: 39 suites / 655 tests, no failures. Includes work assets, shallow/deep copy, trash/template sidecars, source-image jobs, queue control, randomizers, pipe completion, find/replace, exports, V5 requests, settings and destructive-dialog keys.
- Default full run: 322 suites; 285 passed, 37 failed. Tests: 4,352 passed / 126 failed. One failed suite has a source-section extraction load error. This is not full regression approval.
- Isolated Windows UI: common library selection and keyboard, first add-card, caption/size/hover parity, character toggle and artist detail verified; synthetic geometry images only.
- Isolated native data: working copy, typed vibe items, masks/drawing, unchanged source, seven-image combined gallery, favorites, chained work, tar restore and global trash restore passed.
- Built archive preserves 942 runtime files and updates 33 build/data/manifest files. Runtime dependency maps match the installed launcher. Local Drive settings were recovered into ignored `.env` with prior authorization and compared without publishing values. Built archives and test data are not committed.
- Native UI was visually inspected. Accounts, Google OAuth network login, paid NAI generation and every possible personal project were not exercised.
