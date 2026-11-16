const state = {
  imageGridFocusable:false,resultViewerOpen:false,dialogs:[],floatViewCount:0,undoFloatViewCount:0,
  configScreenOpen:false,pieceEditorOpen:false,findReplaceOpen:false,batchInsertOpen:false,
};
jest.mock('../AppService',()=>({appState:state}));
jest.mock('..',()=>({isMobile:true}));
jest.mock('../../componenets/contextMenuBack',()=>({hasOpenContextMenu:()=>false}));
import { gridKeyboardMove, focusGridSurface } from '../gridSelection';
import { KeyboardShortcutService } from '../KeyboardShortcutService';

test('Shift range grows and shrinks from the same anchor, including vertical movement',()=>{
  const keys=['a','b','c','d','e','f','g'];
  const down=gridKeyboardMove(keys,'b',undefined,'down',3,true)!;
  expect([...down.keys!]).toEqual(['b','c','d','e']);
  const left=gridKeyboardMove(keys,down.key,down.anchor,'left',3,true)!;
  expect([...left.keys!]).toEqual(['b','c','d']);
  const before=gridKeyboardMove(keys,left.key,left.anchor,'up',3,true)!;
  expect([...before.keys!]).toEqual(['a','b']);
  const plain=gridKeyboardMove(keys,before.key,before.anchor,'right',3,false)!;
  expect(plain).toEqual({key:'b',anchor:'b',keys:undefined});
});

test('initial, filtered, final-row and empty-grid boundaries stay within the visible order',()=>{
  expect(gridKeyboardMove(['a','c'],undefined,undefined,'down',4,true)?.keys).toEqual(new Set(['a']));
  expect(gridKeyboardMove(['a','c'],'c','removed','down',4,true)?.keys).toEqual(new Set(['c']));
  expect(gridKeyboardMove([],undefined,undefined,'left',4,false)).toBeUndefined();
});

test('scene and image shortcuts route arrows, Shift arrows and Ctrl+Space only to the active grid',()=>{
  const service=new KeyboardShortcutService(), received:string[]=[];
  const listen=(event:Event)=>received.push((event as CustomEvent).detail.action);
  window.addEventListener('shortcut-action',listen);
  const press=(key:string,init:KeyboardEventInit={})=>service.handleKeyDown(new KeyboardEvent('keydown',{key,...init,cancelable:true}));
  try {
    press('ArrowRight'); press('ArrowDown',{shiftKey:true}); press(' ',{ctrlKey:true});
    expect(received).toEqual(['scene-right','scene-extend-down','scene-toggle-select-space']);
    state.imageGridFocusable=true;
    press('ArrowLeft',{shiftKey:true});
    expect(received.at(-1)).toBe('image-extend-left');
    state.imageGridFocusable=false; state.floatViewCount=1;
    press('ArrowLeft');
    expect(received).toHaveLength(4);
  } finally {
    state.imageGridFocusable=false; state.floatViewCount=0;
    window.removeEventListener('shortcut-action',listen);
  }
});

test('clicking grid content releases search focus; inputs and buttons retain native focus',()=>{
  const input=document.createElement('input'),grid=document.createElement('div'),card=document.createElement('div'),button=document.createElement('button');
  grid.tabIndex=0;grid.append(card,button);document.body.append(input,grid);
  try {
    input.focus();focusGridSurface({target:card,currentTarget:grid});expect(document.activeElement).toBe(grid);
    button.focus();focusGridSurface({target:button,currentTarget:grid});expect(document.activeElement).toBe(button);
    input.focus();const service=new KeyboardShortcutService();
    const event=new KeyboardEvent('keydown',{key:'ArrowLeft',shiftKey:true,cancelable:true});
    service.handleKeyDown(event);expect(event.defaultPrevented).toBe(false);
  } finally {input.remove();grid.remove();}
});
