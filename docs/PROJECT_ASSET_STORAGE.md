# Project folder naming and work assets

Base: da8cd8b. Scope approved 2026-11-18.

1. Rename workspace directories with project display names; retain stable IDs. Flush writes, reject collisions and unsafe in-flight generation, update path caches and trash identity, roll back failed moves. Keep external folder rename compatibility.
2. Store editing inputs, masks and drawing layers per work. Preserve legacy flat vibe references and unrelated reference images. Update import/export, copy, template and snapshot consumers before migration.
3. Link asset retention to trash, restoration and permanent deletion. Protect references held by live projects, deleted work, queues and undo. Migrate existing work without overwriting source files; isolate unreferenced legacy candidates for review.
4. Test filesystem failure/recovery, nested edits, shared references, delete/restore and export round trips. Build and test isolated data, commit by feature, prepare installation backup/replacement after app closure.

No PR or push. No live project mutation during development or tests. No generation API calls. Preserve local desktop OAuth only in build environment. Do not classify unknown files as disposable solely from filenames or one JSON snapshot.
