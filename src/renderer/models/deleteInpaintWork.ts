import { appState } from './AppService';
import { InpaintScene, Session } from './types';
import {
  DELETE_RESULT_TEXT,
  deleteConfirmText,
  runTrashDelete,
} from './deleteFlowRules';
import { beginSceneDelete } from './deleteUndo';
import { SCENE_RETENTION_DAYS } from './TrashService';

export function confirmInpaintSceneDelete(
  session: Session,
  scene: InpaintScene,
  onDeleted?: () => void,
) {
  if (session.inpaints.get(scene.name) !== scene) return;
  appState.pushDialog({
    type: 'confirm',
    ...deleteConfirmText({
      kind: 'inpaintScene',
      name: scene.name,
      outcome: { trashDays: SCENE_RETENTION_DAYS },
    }),
    callback: async () => {
      if (session.inpaints.get(scene.name) !== scene) return;
      const record = beginSceneDelete(session);
      const outcome = await runTrashDelete({
        remove: () => record.trash(scene),
        stillExists: () => session.hasScene('inpaint', scene.name),
      });
      record.commit();
      if (outcome.kind === 'error') {
        appState.pushMessage(
          outcome.message || '씬을 휴지통으로 옮기지 못했습니다.',
        );
        return;
      }
      if (outcome.kind === 'still-present') {
        appState.pushMessage(DELETE_RESULT_TEXT.sceneStillPresent);
        return;
      }
      onDeleted?.();
    },
  });
}
