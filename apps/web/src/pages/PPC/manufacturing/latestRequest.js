// Menjamin hanya request terbaru yang boleh hidup. Dipakai search-as-you-type:
// debounce mencegah request sebelum mulai, tapi TIDAK membatalkan request lama
// yang sudah dikirim. Tanpa abort, response lama yang lambat dapat datang belakangan
// dan menimpa hasil query terbaru.
export function createLatestRequest(loader) {
  let controller = null;

  return {
    run(...args) {
      controller?.abort();
      controller = new AbortController();
      const ownController = controller;
      return Promise.resolve(loader(...args, { signal: ownController.signal }))
        .finally(() => {
          if (controller === ownController) controller = null;
        });
    },
    cancel() {
      controller?.abort();
      controller = null;
    },
  };
}
