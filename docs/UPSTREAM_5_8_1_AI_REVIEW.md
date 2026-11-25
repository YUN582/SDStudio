# Upstream 5.8.1 review

Codex-only inspection, 2026-11-25. No Gemini or delegated-agent calls. Human decisions: [Korean review](UPSTREAM_5_8_1_REVIEW.ko.md).

## Immutable comparison

- Upstream: `Dd154663/SDStudio`, `31e5e8e36e90a60191043bd345aa8732ce9947ae`, package 5.8.1.
- Previously integrated upstream / merge base: `d95c674061aef309bbc506aaaea3d61790451b96`.
- Fork application snapshot at inspection start: `149d938eda3d214ef08aa0b31eb287bb88571178`.
- New upstream commits: 6; changed paths: 56; direct conflicted paths in the simulated merge: 7.
- `git fetch upstream --no-tags` refreshed refs. `git merge-tree --write-tree --name-only --no-messages HEAD upstream/main` created only a hypothetical tree object. No merge, checkout replacement, version bump or installation was performed.
- The same turn separately implements the user's metadata loading and image-use requests. Those changes are not a 5.8.1 integration. Recompute conflicts against the eventual feature head before applying upstream changes.

## Direct conflicts and resolution boundaries

| Path | Required resolution |
| --- | --- |
| `CharacterPresetInnerEditor.tsx` | Keep the fork media panels, click removal, upload placement and prompt layout. Port `referenceDefaultsFor` and `ReferenceTypeControl` into those panels. Do not accept upstream's whole body layout. |
| `InPaintEditor.tsx` | Preserve live input resolution, cancellation/request guards and `storeWorkImage(session, scene, 'mask', ...)`. Add pending-save tracking and await it before reading a mask. Do not restore root-vibes mask storage. |
| `MobileKeyboardChip.tsx` | Keep inline find removed. Port keyboard visibility tracking only to the retained weight/comment and selected-tag controls. |
| `ResultViewer.tsx` | Port the optional scene-mode header and background-key guards without replacing owner-aware selection, ordering, linked works, expanded prompts or the approved detail toolbar. Capture wiring is deferred. |
| `SceneQueueControl.tsx` | Keep combined galleries and original/result owners. Port state transitions deliberately; upstream's `EDITOR_CLOSE_CLOSES_GRID = true` changes Escape behavior and must not be accepted implicitly. Keep declaration order before memoized render consumers. |
| `TobBar.tsx` | Add reference-spend data to the fork account controls. Preserve project/generation toolbar placement and title-bar height. |
| `models/__tests__/mobileKeyboardChipFind.test.tsx` | Keep the obsolete inline-finder test deleted. Transfer relevant new keyboard-visibility assertions to the retained mobile-control tests. |

Paths above are relative to `src/renderer/componenets`, except the explicitly prefixed test path.

## Semantic conflicts beyond Git markers

- `captureSheetRun.captureSceneData` reads `gameService.getOutputs(session, scene)`, `scene.mains` and one output directory. This misses linked results belonging to other work owners. Use the fork combined gallery entries and `galleryPreviewEntry`, preserving actual owner paths, favorites and manual order. Update capture scope collection as well as rendering. User wants capture later, after current error fixes and image-use improvements.
- Upstream `ImageService.storeVibeImage(..., primeCache, primeThumbnail)` adds a fourth flag. In this fork the existing three arguments retain their meaning. `primePickerThumbnail` must use the fork `getSmallImagePath`; keep `getVibeImagePath` asset-token resolution and `storeWorkImage` unchanged.
- Model-family reference defaults need consistent use in all three editors and the new direct image-add route. The current direct route intentionally uses existing editor defaults until this upstream change is integrated.
- Removing reference-only paid-setting confirmation does not remove unrelated paid-generation checks. The spend badge uses the actual model-supported reference set.
- `07ee8c2` introduces reference changes, `8d28ff6` introduces scene mode switching, `3ed8971` fixes declaration order for that feature, `967ab68` adds capture, `c4a1c4e` bumps the version, and `31e5e8e` follows up mobile thumbnails/media scanning, caret controls and reference confirmation. Commit boundaries cross features; cherry-picking whole commits is not equivalent to selecting one feature.

## Independent metadata and image-use changes

- `ExternalImageView` distinguishes loading, empty, ready and error; clears old jobs and ignores stale extraction completions. Metadata absence is a terminal normal state.
- Footer actions consume the imported pixels. They append to current shared vibe/reference settings through `editWorkflowFields`; generation metadata import remains a separate explicit action. Model capabilities disable unsupported routes.
- `importedImageActions.createImportedI2I` reuses the established source-image flow for known generated images with metadata. Otherwise it creates one single-image work, uses metadata or current generation settings, stores input through `storeWorkImage`, and records creation undo. It does not enqueue generation.
- Optional source path is carried through AppState, App, the image menu and result detail viewer. Raw image import clears stale source context through `openExternalImage`.
- Preserve actual nested owners when carrying source context; foreign-project detail images do not attach their owners to the current project. Source-free images create standalone works.

## Verification boundary

Reviewing upstream source and a hypothetical merge is not integration validation. No upstream 5.8.1 combined build, Android/iOS runtime, paid generation or personal-project migration has been exercised. Isolated image-use checks and their focused test results are recorded separately under `E:/Temp/sdstudio-image-use-20261125`; installed files remain unchanged pending user review.

Independent image-use evidence: [validation result](IMAGE_USE_VALIDATION_20261125.json). Five focused suites / 65 tests passed; the final footer adjustment reran all 15 affected metadata-view tests. TypeScript and the production renderer build passed. Isolated Windows checks covered raw-file drop, metadata absence, actual vibe/reference writes, preserved source dimensions, a single source-free I2I work, a second linked nested-image I2I work, and Escape returning to metadata. Paid generation and personal data were not used.
