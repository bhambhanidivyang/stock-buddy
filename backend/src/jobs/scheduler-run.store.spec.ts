import { SchedulerRunStore } from './scheduler-run.store';

describe('SchedulerRunStore.claim', () => {
  function makeStore(existing: unknown) {
    const runs = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation((row: unknown) => row),
      save: jest.fn().mockImplementation(async (row: unknown) => row),
    };
    return {
      store: new SchedulerRunStore(runs as never),
      runs,
    };
  }

  it('claims when no prior run', async () => {
    const { store, runs } = makeStore(null);
    await expect(store.claim('nse_sync', '2026-08-05')).resolves.toBe(true);
    expect(runs.save).toHaveBeenCalled();
  });

  it('skips when already successful', async () => {
    const { store } = makeStore({
      jobName: 'nse_sync',
      runDate: '2026-08-05',
      status: 'success',
      startedAt: new Date(),
    });
    await expect(store.claim('nse_sync', '2026-08-05')).resolves.toBe(false);
  });
});
