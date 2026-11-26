# Upstream 5.8.1 integration review

2026-11-26. User authorized Gemini direction and supervision for this integration. Gemini remained read-only; Codex implemented, tested, committed and pushed to the user fork. No upstream PR or installation replacement.

## Pinned inputs and method

- Upstream: `Dd154663/SDStudio`, `31e5e8e36e90a60191043bd345aa8732ce9947ae` (5.8.1).
- Previous integrated upstream: `d95c674061aef309bbc506aaaea3d61790451b96` (5.8.0).
- Fork before this objective: `f55671a1e7d854b0e49a025b6b3801e745cc81f8`.
- Local recovery ref: `backup/pre-upstream-581-20261126`.
- Application implementation snapshot: `ce58d0b`; version metadata changed separately to 5.8.1.
- Ported by feature. Do not infer Git ancestry from the application version: 5.8.1 upstream commits were not merged wholesale. The prior merge base remains relevant to future merge simulations.
- Upstream delta: 6 commits, 56 paths. Path-by-path disposition is in the validation JSON. Preserve the fork's different UI, asset ownership and queue semantics when reviewing overlapping files.

## Feature commits

| Commit | Scope |
| --- | --- |
| `b0a28e0` | Model-family reference defaults, shared type control, reference spend badge, picker thumbnail priming. |
| `6ec1390` | Mobile media paths, thumbnail decode and keyboard-chip visibility without restoring inline find. |
| `fb786ae` | Scene image/editor header and transitions, pending-mask tracking. |
| `bd257ad` | Gemini review corrections: track the full mask transaction, consume cached masks before awaits, reset mask state on scene changes; guard raw grid handlers behind editors. |
| `a47cebd` | Contact-sheet capture with combined owner-aware galleries and existing UI entry points. |
| `ce58d0b` | Final supervisor correction: block background shortcut/raw-key actions for modals while preserving dialog keys; register generation ownership at all inpaint editor entry points. |

The earlier metadata loading/image-use commits `821301f` and `855bfe9` remain distinct from upstream integration.

## Conflict resolutions and intentional differences

- `CharacterPresetInnerEditor`: retained approved media cards, uploads, click removal and prompt layout. Integrated `referenceDefaultsFor`, model limits and `ReferenceTypeControl` into that layout. External image actions use the same defaults.
- `referenceEditorSpec.newReferenceType`: retained compatibility export because the fork's imported-image route still consumes it. Removing the helper as upstream did would break that route.
- `ImageService`: existing three-argument `storeVibeImage` behavior retained. Optional fourth argument primes the picker thumbnail through the fork's project-level cache. Work tokens and `storeWorkImage` remain unchanged.
- `InPaintEditor`: await pending saves before mask reads; ignore stale loads. Explicit save tracks drawing, mask storage and path assignment as one promise. Consume cached masks before async work; unmount cleanup consumes its cache once. Keep work-local `vibes` paths and live input resolution.
- `SceneQueueControl`: declare transition handlers before memoized consumers. Keep the fork's scene setters and input workflows. Selection never replaces the scene name. `EDITOR_CLOSE_CLOSES_GRID=false`: Esc closes the editor to the previous grid.
- `ResultViewer`: preserve actual owners, filtering, manual order, selection, approved detail toolbar and linked work UI. Apply editor/capture guards to both shortcut dispatch and raw key listeners.
- `MobileKeyboardChip`: port height/caret visibility behavior only. Keep inline finder and its obsolete test deleted.
- `TobBar`: spend badge belongs to existing account controls; preserve current title/project/generation toolbar placement.
- Reference-only paid-setting confirmation removed as upstream intended; unrelated paid-generation checks remain.

## Capture ownership and order

`captureSceneData` reads `imageService.getSceneGalleryEntries(session, scene)`, not one output folder. Every output/favorite carries the real owner path; identical filenames in separate work folders remain distinct. Normal scene previews use `galleryPreviewEntry`, including variant-only favorites. Work input images retain opaque tokens and the mirror fallback.

Grid scopes snapshot `activePaths`. Selection is filtered in that visible order; favorites use owner-aware `isFavorite`. Existing all/original/variant filters apply. Trash and work-list tabs disable capture.

Scene scopes use the current filtered scene order, selection and viewport snapshot. Representative/favorite capture follows the combined gallery. The explicit recent-output mode sorts timestamps newest first and limits each row to the chosen column count, matching its label.

The scene registry entry remains overflow/edit. Grid capture sits next to download and is available in both mobile secondary tiers. Reuse `ModalOverlay`, segmented controls and existing button tones; PNG default. Sequential decode/render releases source images and the final canvas; pixel bounds, cancellation and unique output names remain enforced.

Capture writes an exported sheet, not project image state. It does not move originals, change favorites/order or enqueue generation.

## Independent imported-image behavior

- Loading/empty/ready/error are terminally distinguished; stale extraction cannot replace a newer image.
- Vibe/reference actions append through workflow-field undo and preserve current prompts. Capability checks disable unavailable routes.
- Raw I2I uses current generation settings and enabled character prompts in one single-image work. It stores the input through `storeWorkImage` and creates no queue entries.
- Known generated images retain their owner/source context and existing prompt-choice flow. Foreign-project owners are not attached to the current project.

## Verification and limits

Machine-readable evidence: [UPSTREAM_5_8_1_VALIDATION.json](UPSTREAM_5_8_1_VALIDATION.json). Human summary: [Korean change summary](UPSTREAM_5_8_1_REVIEW.ko.md).

- TypeScript and production main/renderer builds passed.
- Core regression subset: 43 suites / 676 tests passed. The deleted inline-finder suite was excluded; current expanded find/replace and single-image queue tests were included.
- Integration-focused subset: 10 suites / 111 tests passed. Final supervision fixes: 5 suites / 56 tests passed, including behavioral modal-key tests and generation-dock ownership. The updated toolbar-registry contract is covered by the full run.
- Full baseline: 324 suites, 4,390 passed / 126 failed tests. Integrated full run: 336 suites, 4,507 passed / 126 failed. Compared failure identities by file and full test name: no additions or removals. Existing failures are not declared harmless or resolved.
- Isolated Windows app: 13 checks passed, using copied synthetic fixtures and a separate profile. All HTTP(S) blocked. Checks cover metadata absence, V4.5/V5 defaults, raw I2I scope, scene toggle/Esc/background keys, actual capture PNG dimensions and tile pixels, selected order, transformed favorites, scene capture and immediate mask reopen after explicit and Esc saves. Actual scene-capture key probes confirmed Space/Enter/H/S/F/arrows/Ctrl+G did not dispatch background actions, Tab moved dialog focus, fresh vibe thumbnails appeared, and only one generation bar remained.
- Expected offline update-check failure is recorded separately. No paid generation or personal-project tests.
- Runtime packaging preserves 942 installed runtime files, unchanged dependency metadata and local Drive client settings without printing those values. Only compiled/data files and package version change.
- Installation archive remains unchanged. Android/mobile behavior has unit evidence only; Android device, macOS and paid requests were not exercised. No claim about downgrade compatibility or personal-data migrations.

## Supervisor disposition

Gemini final review found one blocking modal-key issue. Commit ce58d0b resolved it and the five missing inpaint generation owners. Follow-up code review found no remaining blocker and authorized a review package after actual validation. The rebuilt package passed the final 13 Windows checks; full-suite failure identities remain unchanged. Review-package decision: GO. Installation remains deferred for user review.

## Review focus

Verify the full pending-mask promise includes assigning a newly stored token. Do not move the assignment outside tracking. Audit all keyboard entry points, not only `imageGridFocusable`. Keep capture output paths owner-qualified. Do not revive the removed inline find UI when reapplying upstream tests. Future upstream merges must account for this feature port rather than treating a 5.8.1 version string as merge ancestry.
