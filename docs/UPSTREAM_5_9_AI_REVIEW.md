# Upstream 5.9 integration review

2026-11-28. Codex implementation; no Gemini session or delegated agents. User authorized source integration and fork main push; installation explicitly deferred.

## Pinned inputs

- Previous integrated upstream: `31e5e8e36e90a60191043bd345aa8732ce9947ae`, 5.8.1.
- New upstream: `17044ed836b0edfa3952463c2b76e9e1be9ec90d`, 5.9.0.
- Fork before integration: `f44ae6e41dcce460664d2f8be8d8863d2a3b6daa`.
- Port the incremental delta between these upstream revisions. Do not infer integration status from merge ancestry: the earlier 5.8.1 port was selective.

## Conflict decisions

- History: raise the global cap to 200, retain existing nested-work path reconstruction, persistence, migration and owner resolution. Virtualize both the side panel and full history grid; use shared progressive-image helpers.
- Single history image: keep the fork's shared `ResultDetailView`. History navigation receives explicit neighboring entries and stays inside the filtered scope. Cross-project navigation resolves each entry's actual session. Vertical browsing uses the upstream stream layout; its images return to the shared viewer and reuse the fork's internal/native file drag hook.
- Preview lifetime: observe the selected history entry outside the async effect. Removing or failing to resolve that entry closes the preview and releases its keyboard gate, even when its scene still contains other images. Guard late async completions with the request counter.
- Scene image views: preserve cards as the default. Add byScene, rows and recent at the existing toolbar position. Use `getSceneGalleryEntries`, not a raw output-folder list. Carry full paths through sorting, layout and focus; route favorite/context mutations to each entry's real owner. Keep source scene grouping when opening the combined gallery.
- Direct detail: reuse the existing viewer with an explicit close callback. Select the full path before the first render; equal basenames in separate work folders must remain distinct. Escape returns to the originating list; ordinary grid entry retains its previous close behavior.
- Context menu: reuse the fork's icons, clipboard/edit/metadata actions and navigation grouping. Keep `이미지 그리드로 이동`, not the upstream wording. Close history overlays before scene/grid navigation or metadata application.
- Keyboard: keep the fork's card selection, Ctrl/Shift selection, shortcuts and raw-key modal guards. New image-view modes use upstream browsing semantics; scene selection/reordering remains in cards mode. Register virtual scene revealers for history navigation, find and bookmarks. Scene navigation still selects and focuses its target.
- Capture: use visible virtual rows for the visible-scene scope. Existing combined-owner capture paths remain unchanged.
- Size tests: upstream assumed a 240px medium scene card; the approved fork uses 256px and a 384px fixed height. Adapt expectations to the fork rather than changing approved sizing.

## Compatibility boundaries

Feature commits: `9242506` adds history browsing and the shared layout/reveal primitives; `2ef2f2f` wires owner-aware scene views and their toolbar/selection behavior. Version and review records follow separately.

No main-process/backend, dependency or project-schema changes were required. Existing per-preset models, input/mask/drawing storage, project auxiliary directories and frozen queue geometry remain in place. History JSON format is unchanged; only its cap rises. New view preferences live in localStorage. Older applications may truncate history metadata to their smaller cap; original images survive.

History widgets do not reintroduce persistent thumbnail storage. They call the fork's existing `ImageService` and preserve its cache policy. User projects, installed executable/archive, credentials and OAuth settings were not changed.

## Validation limits

See the adjacent validation JSON for exact counts and path dispositions. Focused suites cover history, variant ownership with colliding filenames, scene-view layout/navigation, input handling, preset models, queue sources, gallery order, work assets, keyboard and drag behavior. A separate executable used synthetic data and blocked HTTP/HTTPS; no paid generation occurred.

The renderer smoke candidate reused the installed main/runtime only for validation; its embedded runtime package version remains 5.8.1. Source version metadata is 5.9.0. This temporary smoke archive is not a release installer and must not be installed as the final package.

Native screenshot capture was unavailable because no display surface was available. Runtime DOM interactions and measured geometry passed; final visual inspection on the user's display remains pending. Five overlapping legacy UI suites retain the same 20 failures as an isolated pre-change snapshot; no newly failing test names. This is not a claim that the complete historical suite passes.
