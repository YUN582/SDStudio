// Isolated browser check of the real canvas components. No app bootstrap, user data, or generation API.
// node .erb/scripts/verify-inpaint-canvas.cjs <output-directory> <chromium-executable>
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const webpack = require('webpack');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.argv[2] || path.join(root, '.canvas-check'));
const browser = process.argv[3];
if (!browser)
  throw new Error(
    'Pass a Chromium/Edge executable; an isolated profile will be used.',
  );
fs.mkdirSync(out, { recursive: true });
const q = (value) => JSON.stringify(value.replaceAll('\\', '/'));
const models = path.join(out, 'models.ts');
fs.writeFileSync(
  models,
  `import {fetchInpaintInput} from ${q(path.join(root, 'src/renderer/models/inpaintInput'))};
export const files=new Map<string,string>();
export const sessionService={markDirty:()=>{}};
export const imageService={
  writeVibeImage:async(_s:any,key:string,data:string)=>{files.set(key,'data:image/png;base64,'+data);},
  storeVibeImage:async(_s:any,data:string)=>{files.set('paint.png','data:image/png;base64,'+data);return 'paint.png';},
  fetchVibeImage:async(_s:any,key:string)=>files.get(key),
  fetchImage:async(key:string)=>files.get(key),getOutputDir:()=>'',
  fetchInpaintInput:async(s:any,w:any)=>fetchInpaintInput(imageService as any,s,w)
};`,
);
fs.writeFileSync(
  path.join(out, 'float.tsx'),
  `import {createContext} from 'react';export const FloatViewActiveContext=createContext(true);`,
);
fs.writeFileSync(
  path.join(out, 'app.ts'),
  `export const appState={dialogs:[],pushMessage:(text:string)=>{throw new Error(text);}};`,
);
fs.writeFileSync(
  path.join(out, 'entry.tsx'),
  `import React,{useState,useRef} from 'react';import {createRoot} from 'react-dom/client';
import WorkflowCanvas from ${q(path.join(root, 'src/renderer/componenets/WorkflowCanvas'))};
import {InpaintDrawingTools} from ${q(path.join(root, 'src/renderer/componenets/InpaintDrawingTools'))};
import {files} from './models';
const base=document.createElement('canvas');base.width=base.height=256;const c=base.getContext('2d')!;c.fillStyle='#336699';c.fillRect(0,0,256,256);const image=base.toDataURL();files.set('base.png',image);
const work={name:'fixture',workflowType:'SDInpaint',preset:{image:'base.png'},meta:new Map()};const session={name:'fixture',scenes:new Map()};
function Fixture(){const [tool,setTool]=useState<'mask'|'paint'>('mask'),[color,setColor]=useState('#ff0000'),[opacity,setOpacity]=useState(.5),[size,setSize]=useState(10),[history,setHistory]=useState({undo:false,redo:false,ready:false});const ref=useRef<any>(null);
(window as any).check={ref,setTool,tool,color,history,mask:()=>ref.current.getMaskBase64(),input:()=>ref.current.getInputImage(),paint:()=>Array.from(document.querySelector<HTMLCanvasElement>('.sds-paint-layer')!.getContext('2d')!.getImageData(64,64,1,1).data),hasMask:()=> (history as any).hasMask};
return <><InpaintDrawingTools tool={tool} setTool={setTool} color={color} setColor={setColor} opacity={opacity} setOpacity={setOpacity} history={history} canvas={ref} brushSize={size} setBrushSize={setSize} focusControl={<button>포커스</button>} onResetView={()=>{}}/><div style={{height:256,width:256,margin:24}}><WorkflowCanvas ref={ref} resetKey={work as any} session={session as any} image={image} imageWidth={256} imageHeight={256} brushSize={size} tool={tool} color={color} opacity={opacity} onHistoryChange={setHistory} inputRevision={0} onPickColor={setColor}/></div></>}
createRoot(document.getElementById('app')!).render(<Fixture/>);`,
);
const styles = fs.readFileSync(
  path.join(root, 'src/renderer/componenets/App.css'),
  'utf8',
);
const portStyle = styles.slice(
  styles.indexOf('/* Inpaint workflow refinement.'),
);
fs.writeFileSync(
  path.join(out, 'fixture.html'),
  `<!doctype html><meta charset="utf-8"><style>
:root{--c-line:#334155;--c-text:#eee;--c-text-sub:#bbb;--c-surface:#102030;--c-zone:#203040;--c-input-bg:#304050}body{background:#102030;color:#eee;font:14px sans-serif}button{color:inherit;background:#245470;border:0;border-radius:20px;padding:8px}.canvas-container{position:relative;height:100%;width:max-content}.canvas{position:absolute;inset:0;opacity:.5;z-index:2;max-width:100%;max-height:100%}.canvas-image{position:relative;max-width:100%;max-height:100%}${portStyle}</style><div id="app"></div><script src="fixture.js"></script>`,
);

async function main() {
  await new Promise((resolve, reject) =>
    webpack(
      {
        mode: 'development',
        devtool: false,
        target: 'web',
        context: root,
        entry: path.join(out, 'entry.tsx'),
        output: { path: out, filename: 'fixture.js' },
        resolve: {
          extensions: ['.tsx', '.ts', '.js'],
          modules: [path.join(root, 'node_modules'), 'node_modules'],
        },
        module: {
          rules: [
            {
              test: /\.tsx?$/,
              exclude: /node_modules/,
              use: {
                loader: require.resolve('ts-loader'),
                options: {
                  transpileOnly: true,
                  configFile: path.join(root, 'tsconfig.json'),
                  compilerOptions: {
                    module: 'esnext',
                    declaration: false,
                    sourceMap: false,
                  },
                },
              },
            },
          ],
        },
        plugins: [
          new webpack.NormalModuleReplacementPlugin(/^\.\.\/models$/, models),
          new webpack.NormalModuleReplacementPlugin(
            /^\.\/FloatView$/,
            path.join(out, 'float.tsx'),
          ),
          new webpack.NormalModuleReplacementPlugin(
            /^\.\.\/models\/AppService$/,
            path.join(out, 'app.ts'),
          ),
        ],
      },
      (error, stats) =>
        error || stats.hasErrors()
          ? reject(
              error || new Error(stats.toString({ all: false, errors: true })),
            )
          : resolve(),
    ),
  );
  // Each run owns its profile; a previous DevToolsActivePort must never be reused.
  const profile = fs.mkdtempSync(path.join(out, 'profile-'));
  const child = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      '--user-data-dir=' + profile,
      'file:///' + path.join(out, 'fixture.html').replaceAll('\\', '/'),
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  let socket;
  let id = 0;
  const pending = new Map();
  const results = [];
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let port;
    for (let i = 0; i < 150; i++) {
      try {
        port = fs
          .readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8')
          .split('\n')[0];
        break;
      } catch {
        await pause(100);
      }
    }
    if (!port) throw Error('Browser did not start');
    const tabs = await (
      await fetch('http://127.0.0.1:' + port + '/json/list')
    ).json();
    socket = new WebSocket(
      tabs.find((t) => t.type === 'page').webSocketDebuggerUrl,
    );
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? p.reject(msg.error) : p.resolve(msg.result);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const key = ++id;
        pending.set(key, { resolve, reject });
        socket.send(JSON.stringify({ id: key, method, params }));
      });
    const js = async (expression) => {
      const value = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (value.exceptionDetails)
        throw Error(JSON.stringify(value.exceptionDetails));
      return value.result.value;
    };
    for (
      let i = 0;
      i < 100 && !(await js('!!window.check?.history.ready'));
      i++
    )
      await pause(50);
    const check = async (name, expression) => {
      const ok = await js(expression);
      results.push({ name, ok });
      if (!ok) throw Error(name);
    };
    const point = await js(
      "(()=>{const r=document.querySelector('.canvas').getBoundingClientRect();return{x:r.x+64,y:r.y+64}})()",
    );
    const mouse = async (type, button = 'none', buttons = 0, modifiers = 0) =>
      send('Input.dispatchMouseEvent', {
        type,
        ...point,
        button,
        buttons,
        modifiers,
        clickCount: 1,
      });
    const stroke = async (button = 'left', modifiers = 0) => {
      const buttons = button === 'right' ? 2 : 1;
      await mouse('mouseMoved');
      await mouse('mousePressed', button, buttons, modifiers);
      await mouse('mouseReleased', button, 0, modifiers);
      await pause(80);
    };
    const key = async (value) => {
      await send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: value,
        code: 'Key' + value.toUpperCase(),
        windowsVirtualKeyCode: value.toUpperCase().charCodeAt(0),
        modifiers: 2,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: value,
        modifiers: 2,
      });
      await pause(80);
    };
    await check('initial blank mask', 'check.history.ready&&!check.hasMask()');
    await stroke();
    await check('mask stroke', 'check.hasMask()');
    await key('z');
    await check('mask Ctrl+Z', '!check.hasMask()');
    await key('y');
    await check('mask Ctrl+Y', 'check.hasMask()');
    await stroke('right');
    await check('right drag erases mask', '!check.hasMask()');
    await js("check.setTool('paint')");
    await pause(80);
    await stroke();
    await check(
      'paint opacity',
      'check.paint()[0]===255&&check.paint()[3]>=126&&check.paint()[3]<=129',
    );
    await key('z');
    await check('paint Ctrl+Z', 'check.paint()[3]===0');
    await key('y');
    await check('paint Ctrl+Y', 'check.paint()[3]>0');
    await js('check.ref.current.clearDrawing()');
    await pause(50);
    await check('clear drawing', 'check.paint()[3]===0');
    await key('z');
    await check('undo clear drawing', 'check.paint()[3]>0');
    await mouse('mousePressed', 'right', 2, 2);
    await pause(70);
    await check(
      'eyedropper magnifier',
      '!!document.querySelector(".sds-eyedropper-preview")',
    );
    await mouse('mouseReleased', 'right', 0, 0);
    await pause(70);
    await check(
      'eyedropper returns to paint',
      'check.tool==="paint"&&!document.querySelector(".sds-eyedropper-preview")',
    );
    await mouse('mouseMoved');
    await pause(50);
    await check(
      'actual brush outline',
      'document.querySelector(".sds-brush-preview circle").getAttribute("r")==="10"',
    );
    await check(
      'persisted drawing composes input',
      '(async()=>{const s=await check.input();return !!s&&s.length>100})()',
    );
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(
      path.join(out, 'canvas.png'),
      Buffer.from(shot.data, 'base64'),
    );
    fs.writeFileSync(
      path.join(out, 'results.json'),
      JSON.stringify({ passed: results.length, results }, null, 2),
    );
    console.log(JSON.stringify({ passed: results.length, output: out }));
    await send('Browser.close');
  } catch (error) {
    fs.writeFileSync(
      path.join(out, 'results.json'),
      JSON.stringify({ error: String(error), results }, null, 2),
    );
    throw error;
  } finally {
    socket?.close();
    child.kill();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
