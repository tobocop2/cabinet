/**
 * Per-key serial task chains. `run` enqueues an async task behind the key's
 * previous tasks; tasks for one key never overlap or reorder, keys don't block
 * each other. Used to serialize per-session transcript appends: each append
 * awaits a meta read first, so unchained concurrent appends land out of order
 * whenever chunks arrive faster than one read+append round-trip.
 */
export class SerialChains {
  private tails = new Map<string, Promise<void>>();

  /** Run `task` after every previously enqueued task for `key`. Errors are
   * reported to `onError` and never break the chain. */
  run(key: string, task: () => Promise<void>, onError?: (err: unknown) => void): Promise<void> {
    const tail = this.tails.get(key) ?? Promise.resolve();
    const next = tail.then(task).catch((err) => {
      onError?.(err);
    });
    this.tails.set(key, next);
    void next.finally(() => {
      if (this.tails.get(key) === next) {
        this.tails.delete(key);
      }
    });
    return next;
  }

  /** Resolve once every task enqueued for `key` so far has settled. */
  async drain(key: string): Promise<void> {
    await (this.tails.get(key) ?? Promise.resolve()).catch(() => {});
  }
}
