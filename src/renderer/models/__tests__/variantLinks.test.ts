const move = jest.fn(async (..._args:any[])=>{});
const renameTrash = jest.fn(async (..._args:any[])=>{});
jest.mock('..',()=>({
  backend:{}, imageService:{renameInpaintSceneFiles:move},
  sessionService:{guardCrossWindowLock:async()=>true,withLock:async(_keys:any,run:any)=>run()},
  taskQueueService:{statsTasksFromScene:()=>({total:0,done:0}),onRenameScene:jest.fn()},
  trashService:{renameVariantTrashSource:renameTrash},
}));
jest.mock('../PersistenceService',()=>({persistService:{write:jest.fn()}}));
import { renameInpaintScene } from '../SessionService';
import { linkedImageVariants } from '../sceneImageVariants';

function fixture(){
  const parent={name:'parent',type:'inpaint',sceneRef:'root',outputInSourceScene:true};
  const child={name:'child',type:'inpaint',sceneRef:'root',sourceInpaint:'parent',sourceImage:'result.png'};
  const session={name:'project',inpaints:new Map<string,any>([['parent',parent],['child',child]])} as any;
  return {session,parent,child};
}
beforeEach(()=>{move.mockReset().mockResolvedValue(undefined);renameTrash.mockReset().mockResolvedValue(undefined);});

test('renaming a parent work updates live and trashed child links without changing the root scene',async()=>{
  const {session,parent,child}=fixture();
  await renameInpaintScene(session,'parent','renamed');
  expect(renameTrash).toHaveBeenCalledWith(session,'parent','renamed','inpaint');
  expect(child).toMatchObject({sourceInpaint:'renamed',sceneRef:'root',sourceImage:'result.png'});
  expect(linkedImageVariants(parent as any,session.inpaints.values(),'result.png')).toEqual([child]);
});

test('trash-reference failure rolls back moved files before changing names or child links',async()=>{
  const {session,parent,child}=fixture();renameTrash.mockRejectedValueOnce(new Error('save failed'));
  await expect(renameInpaintScene(session,'parent','renamed')).rejects.toThrow('save failed');
  expect(move).toHaveBeenLastCalledWith(session,'renamed','parent',parent);
  expect(parent.name).toBe('parent');expect(child.sourceInpaint).toBe('parent');
  expect(session.inpaints.has('renamed')).toBe(false);
});
