const refreshList = jest.fn(async () => {});
const invoke = jest.fn(async () => ({ migrated: 2, deferred: 1 }));
const state = {
  isMobile: false,
  sessionService: { loadedNames: () => ['open'], refreshList },
  taskQueueService: {
    queue: [undefined, { params: { session: { name: 'queued' } } }],
  },
};
jest.mock('..', () => state);
import { migrateUnusedVariantOutputs } from '../variantMigrationRuntime';
import { registerProjectDir, setWorkspaceLayoutActive } from '../storageLayout';

beforeEach(() => {
  jest.clearAllMocks();
  state.isMobile = false;
  setWorkspaceLayoutActive(false);
  registerProjectDir('open', 'renamed__id1');
  registerProjectDir('queued', 'waiting__id2');
  (window as any).electron = { ipcRenderer: { invoke } };
});

test('manual migration excludes loaded and queued project directories before refreshing', async () => {
  expect(await migrateUnusedVariantOutputs()).toEqual({
    migrated: 2,
    deferred: 1,
  });
  expect(invoke).toHaveBeenCalledWith('migrate-variant-outputs', [
    'renamed__id1',
    'waiting__id2',
  ]);
  expect(refreshList).toHaveBeenCalledTimes(1);
  expect(invoke.mock.invocationCallOrder[0]).toBeLessThan(
    refreshList.mock.invocationCallOrder[0],
  );
});

test('mobile never invokes a desktop migration', async () => {
  state.isMobile = true;
  await migrateUnusedVariantOutputs();
  expect(invoke).not.toHaveBeenCalled();
  expect(refreshList).not.toHaveBeenCalled();
});
