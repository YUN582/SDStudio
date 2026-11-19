# Prompt randomizer and batch PNG export

1. Snapshot selected preset IDs. Choose one output folder, build the existing PNG format, avoid filename collisions, and report partial failures.
2. Resolve `||a|b||` per generated image. Preserve standalone `|` interleaving and existing `{a|b}` syntax. Exclude fully commented candidates; keep comma-only empty candidates valid. In multi-line pieces, split rows outside paired comments and exclude comment-only rows from the draw. Preserve deliberate blank rows and the editable source.
3. Treat pipes as editor boundaries for weight/comment shortcuts and highlighting. Preserve original project text and caret offsets. API prompts and the image's generation metadata contain the resolved choice.
4. Verify parser/editor regressions, request payloads without paid generation, and PNG metadata. Commit by feature, push to the fork, back up before installation, then reopen the app.

## Verification

- Typecheck and production renderer build passed.
- Full Jest run: 3,154 passed; one filesystem merge test timed out during the parallel build. Its isolated rerun passed all six tests (3,155 distinct tests passed overall).
- Actual Electron checks: one folder selection exports three selected PNGs, preserves existing files, preserves importable preset metadata, and writes nothing on cancellation.
- Actual inline/expanded editors: Ctrl+3, Ctrl+Up, Ctrl+wheel, undo, and per-candidate weight highlighting passed.
- Captured standard/I2I/inpaint requests resolve positive, negative, and character choices per image. Project text and SDStudio prompt-source metadata retain the editable original. No paid generation was invoked.
