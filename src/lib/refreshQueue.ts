export interface RefreshTask {
  signal: AbortSignal;
  readonly cancelled: boolean;
  readonly timedOut: boolean;
}

/**
 * Let slow requests finish, then combine refresh events received while loading
 * into one follow-up. Cancelling a view invalidates its results immediately.
 */
export function createRefreshQueue<Args extends unknown[]>(
  load: (task: RefreshTask, ...args: Args) => Promise<void>,
  timeoutMs = 20_000,
) {
  type Operation = {
    controller: AbortController | null;
    pending: Args | null;
    completion: Promise<void>;
  };
  let active: Operation | null = null;

  function refresh(...args: Args): Promise<void> {
    if (active) {
      active.pending = args;
      return active.completion;
    }
    const operation: Operation = { controller: null, pending: args, completion: Promise.resolve() };
    active = operation;
    operation.completion = Promise.resolve().then(async () => {
      try {
        while (active === operation && operation.pending) {
          const next = operation.pending;
          operation.pending = null;
          const controller = new AbortController();
          operation.controller = controller;
          let timedOut = false;
          const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs);
          try {
            await load({
              signal: controller.signal,
              get cancelled() { return active !== operation; },
              get timedOut() { return timedOut; },
            }, ...next);
          } finally {
            clearTimeout(timeout);
          }
        }
      } finally {
        if (active === operation) active = null;
      }
    });
    return operation.completion;
  }

  function cancel() {
    const previous = active;
    active = null;
    previous?.controller?.abort();
  }

  return { refresh, cancel };
}
