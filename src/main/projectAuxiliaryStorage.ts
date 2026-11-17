import * as fs from 'node:fs';
import * as path from 'node:path';

type Move = [string, string];

// All callers supply a verified physical project root. Never traverse a junction or a parent segment.
function local(root: string, relative: string, parents = false) {
  let current = root;
  if (!fs.lstatSync(root).isDirectory()) throw Error('프로젝트 폴더를 확인해 주세요.');
  const parts = relative.split('/');
  for (const [index, part] of parts.entries()) {
    if (!part || part === '.' || part === '..' || /[\\/:]/.test(part)) throw Error('잘못된 프로젝트 하위 경로');
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink() || (index < parts.length - 1 && stat && !stat.isDirectory()))
      throw Error('링크 또는 파일 경로는 이동하지 않습니다: ' + relative);
    if (!stat && parents && index < parts.length - 1) fs.mkdirSync(current);
  }
  return current;
}

function present(root: string, relative: string) {
  return fs.lstatSync(local(root, relative), { throwIfNoEntry: false });
}

function checkDestinations(root: string, moves: Move[]) {
  for (const [, to] of moves) {
    if (present(root, to)) throw Error('대상 경로에 이미 데이터가 있습니다: ' + to);
  }
}

/** Preflight every destination and roll back earlier renames if a later one is locked. */
function moveTogether(root: string, moves: Move[]) {
  const done: Move[] = [];
  checkDestinations(root, moves);
  try {
    for (const [from, to] of moves) {
      fs.renameSync(local(root, from), local(root, to, true));
      done.push([from, to]);
    }
  } catch (err) {
    for (const [from, to] of done.reverse()) fs.renameSync(local(root, to), local(root, from, true));
    throw err;
  }
}

const imageRoots = ['outs', 'inpaints', 'inpaint_orgs', 'inpaint_masks', 'references', 'vibes'];
function outputName(parent: string) {
  return /^(outs|inpaints)$/.test(parent) ||
    /^\.trash\/scenes\/(outs|inpaints)$/.test(parent) || /\/variants$/.test(parent);
}

/** Move highest-value data intact, including its original recovery manifest and expiry timestamp.
 * Visit children first: a deleted scene may itself contain deleted images and thumbnail folders. */
export function planProjectAuxiliary(root: string) {
  const moves: Move[] = [];
  function visit(source: string, owner: string) {
    const dir = local(root, source);
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const child = source + '/' + item.name;
      let target = owner + '/' + item.name;
      if (item.name === 'fastcache' && !outputName(owner)) {
        moves.push([child, 'fastcache/' + owner]);
        continue;
      }
      if (item.name === '.unused' && (owner === 'vibes' || owner.endsWith('/vibes'))) {
        moves.push([child, '.unused/' + owner]);
        continue;
      }
      if (item.name === '.trash') {
        target = imageRoots.includes(owner) && owner !== 'vibes' && owner !== 'references'
          ? '.trash/scenes/' + owner : '.trash/images/' + owner;
      } else if (item.name.startsWith('.')) continue;
      visit(child, target);
      if (item.name === '.trash') moves.push([child, target]);
    }
  }
  for (const name of imageRoots) if (present(root, name)?.isDirectory()) visit(name, name);
  checkDestinations(root, moves);
  return moves;
}

export function migrateProjectAuxiliary(root: string) {
  const moves = planProjectAuxiliary(root);
  moveTogether(root, moves);
  return moves.length;
}

function companionPrefixes(relative: string) {
  if (!/^(outs|inpaints)\/[^/]+(?:\/.*)?$|^\.trash\/scenes\/(outs|inpaints)\/[^/]+(?:\/.*)?$/.test(relative)) return [];
  return ['.trash/images/', '.unused/', 'fastcache/', 'fastcache/.trash/images/'];
}

export function moveProjectDirectory(root: string, from: string, to: string, includeOwner = true) {
  if (from === to) return;
  if (process.platform === 'win32' && from.toLowerCase() === to.toLowerCase()) {
    // NTFS already resolves both spellings to the same owner and its companions.
    if (includeOwner) fs.renameSync(local(root, from), local(root, to));
    return;
  }
  const moves: Move[] = [];
  for (const prefix of companionPrefixes(from)) {
    if (present(root, prefix + from)) moves.push([prefix + from, prefix + to]);
  }
  if (includeOwner) moves.push([from, to]);
  moveTogether(root, moves);
}

export function removeProjectCompanions(root: string, relative: string) {
  for (const prefix of companionPrefixes(relative)) {
    const target = local(root, prefix + relative);
    if (fs.lstatSync(target, { throwIfNoEntry: false })?.isDirectory())
      fs.rmSync(target, { recursive: true });
  }
}

// Inspect only files in the application's thumbnail naming format. Yield between directories.
export async function pruneProjectThumbnails(root: string) {
  async function visit(scope: string) {
    const dir = local(root, 'fastcache' + (scope ? '/' + scope : ''));
    if (!(await fs.promises.lstat(dir).catch((err) => { if (err.code !== 'ENOENT') throw err; }))?.isDirectory()) return;
    const ownerDir = scope ? local(root, scope) : root;
    for (const item of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (item.isDirectory()) {
        await visit(scope ? scope + '/' + item.name : item.name);
        continue;
      }
      const original = /^(?:200|400|500)_(.+\.(?:png|webp|jpe?g))$/i.exec(item.name)?.[1];
      if (!item.isFile() || !original || !scope) continue;
      const inspect = (file: string) => fs.promises.lstat(file).catch(err => { if (err.code !== 'ENOENT') throw err; });
      const thumb = path.join(dir, item.name);
      const [source, cached] = await Promise.all([inspect(path.join(ownerDir, original)), inspect(thumb)]);
      if (cached?.isFile() && (!source || (source.isFile() && source.mtimeMs > cached.mtimeMs))) {
        const checked = local(root, 'fastcache/' + scope + '/' + item.name);
        await fs.promises.unlink(checked).catch(err => { if (err.code !== 'ENOENT') throw err; });
      }
    }
  }
  await visit('');
}
