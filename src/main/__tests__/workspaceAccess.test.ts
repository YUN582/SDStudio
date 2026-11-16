/** @jest-environment node */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createWorkspaceAccess } from '../workspaceAccess';

let root: string;
let access: ReturnType<typeof createWorkspaceAccess>;
const body = (name = 'Project') => JSON.stringify({ name, scenes: {}, presets: {} });
function put(dir: string, name = 'Project', id = 'project-id') {
  const location = path.join(root, 'workspace', dir);
  fs.mkdirSync(location, { recursive: true });
  fs.writeFileSync(path.join(location, 'meta.json'), JSON.stringify({ id, name }));
  fs.writeFileSync(path.join(location, 'project.json'), body(name));
  return location;
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdstudio-workspace-test-'));
  fs.mkdirSync(path.join(root, 'workspace'));
  access = createWorkspaceAccess(() => root, () => {});
});
afterEach(async () => {
  await access.close();
  // The target is exactly the unique test directory returned by mkdtemp.
  fs.rmSync(root, { recursive: true, force: true });
});

test('queued outputs follow a renamed project by ID and old writes do not recreate it', () => {
  const old = put('old');
  expect(access.snapshot().entries[0].state).toBe('active');
  fs.renameSync(old, path.join(root, 'workspace', 'renamed'));
  expect(access.resolveTaskOutput('workspace/old/outs/scene')).toBe('workspace/renamed/outs/scene');
  expect(() => access.writeWorkspaceFile(access.workspaceLocation('workspace/old/project.json')!, body(), 'utf8')).toThrow('WORKSPACE_CHANGED');
  expect(fs.existsSync(old)).toBe(false);
});

test('external project edits are preserved and block queued outputs', () => {
  const project = put('project');
  access.snapshot();
  fs.appendFileSync(path.join(project, 'project.json'), '  ');
  expect(() => access.writeWorkspaceFile(access.workspaceLocation('workspace/project/project.json')!, body(), 'utf8')).toThrow('WORKSPACE_CHANGED');
  expect(() => access.resolveTaskOutput('workspace/project/outs/scene')).toThrow('WORKSPACE_CHANGED');
  expect(fs.readFileSync(path.join(project, 'project.json'), 'utf8')).toBe(body() + '  ');
});

test('duplicate project IDs and replaced identities are refused', () => {
  const first = put('first');
  access.snapshot();
  put('copy');
  expect(() => access.resolveTaskOutput('workspace/first/outs/scene')).toThrow('WORKSPACE_CHANGED');
  fs.writeFileSync(path.join(first, 'meta.json'), JSON.stringify({ name: 'Project', id: 'other-id' }));
  expect(access.snapshot().entries.find(entry => entry.dir === 'first')?.state).toBe('conflict');
});

test('completed images are recovered when the project disappears during generation', async () => {
  const project = put('project');
  access.snapshot();
  fs.renameSync(project, path.join(root, 'detached'));
  await expect(access.saveWorkspaceData(access.workspaceLocation('workspace/project/outs/scene/out.png')!, new Uint8Array([1, 2, 3]))).rejects.toThrow('workspace_recovery/');
  const saved = fs.readdirSync(path.join(root, 'workspace_recovery'));
  expect(saved).toHaveLength(1);
  expect([...fs.readFileSync(path.join(root, 'workspace_recovery', saved[0]))]).toEqual([1, 2, 3]);
  expect(fs.existsSync(project)).toBe(false);
});

test('nested variant output can move to scene trash without copy-delete fallback', async () => {
  const project = put('project');
  const output = path.join(project, 'outs', 'source', '.variants', 'edit');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'result.png'), 'pixels');
  access.snapshot();
  await expect(access.renameWorkspaceDirectory('workspace/project/outs/source/.variants/edit', 'workspace/project/inpaints/.trash/edit')).resolves.toBe(true);
  expect(fs.existsSync(output)).toBe(false);
  expect(fs.readFileSync(path.join(project, 'inpaints/.trash/edit/result.png'), 'utf8')).toBe('pixels');
});

test('creating a same-name project after external deletion gets a new identity', () => {
  const first = put('first');
  access.snapshot();
  fs.renameSync(first, path.join(root, 'detached'));
  access.createProjectDirectory('workspace/second/meta.json', JSON.stringify({ id: 'new-id', name: 'Project' }));
  access.writeWorkspaceFile(access.workspaceLocation('workspace/second/project.json')!, body(), 'utf8');
  expect(access.snapshot().entries).toEqual([expect.objectContaining({ dir: 'second', id: 'new-id', state: 'active' })]);
});
