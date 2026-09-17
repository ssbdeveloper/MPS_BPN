import { describe, expect, it, vi } from 'vitest';
import { createLatestRequest } from './latestRequest.js';

describe('createLatestRequest', () => {
  it('membatalkan request lama ketika pencarian baru dimulai', async () => {
    const first = deferred();
    const second = deferred();
    const loader = vi.fn()
      .mockImplementationOnce(({ signal }) => {
        signal.addEventListener('abort', () => first.reject(abortError()));
        return first.promise;
      })
      .mockImplementationOnce(() => second.promise);
    const latest = createLatestRequest(loader);

    const oldRequest = latest.run();
    const newRequest = latest.run();
    second.resolve(['latest']);

    await expect(oldRequest).rejects.toMatchObject({ name: 'AbortError' });
    await expect(newRequest).resolves.toEqual(['latest']);
  });

  it('cancel membatalkan request yang sedang berjalan saat page unmount', async () => {
    const pending = deferred();
    const loader = vi.fn(({ signal }) => {
      signal.addEventListener('abort', () => pending.reject(abortError()));
      return pending.promise;
    });
    const latest = createLatestRequest(loader);

    const request = latest.run();
    latest.cancel();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function abortError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}
