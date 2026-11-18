# Character workspace refresh

Keep SDStudio's existing theme tokens, 32px controls, main tab strip, search bars, and card selection feedback.

1. Move desktop project controls above the workspace. Keep generation controls below. Remove redundant labels, the applied-character chip, and button underlines. Add an opt-in startup shortcut-help setting.
2. Add a global-first character preset tab. Preserve project-local snapshots and older data paths internally. Card click toggles application by linked global ID; editing is explicit. Reuse library selection and existing batch operations for context menus.
3. Rebalance the editor: wider prompts, compact expanded filename options, then three adjacent media panels. Preserve negative prompt height, asset settings, save/cancel behavior, and unsaved-change protection. Image clicks remove draft attachments with clear hover feedback; no immediate physical-file deletion.
4. Verify selection/application/undo, uploads/removals/save cancellation, startup settings, responsive layout, and existing generation controls. Commit by feature, push only to the user's fork, back up before installing, then reopen the app.

Decision: local management UI is hidden in the new workspace; project snapshots remain for portability and backward compatibility. No upstream PR.
