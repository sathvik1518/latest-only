/**
 * Result of a "latest only" call.
 * - ok:    this call was still the newest when it finished. Use `value`.
 * - stale: a newer call started (or this call was cancelled). Ignore it.
 */
export type Latest<T> = { status: "ok"; value: T } | { status: "stale" };

/**
 * Wraps any async function so that only the newest call counts.
 *
 * Every call:
 *   1. aborts the previous call's AbortController (cancels the old request),
 *   2. creates a new AbortController and passes its signal to `run`,
 *   3. when finished, checks whether its OWN controller was aborted.
 *      If yes -> returns { status: "stale" } (even if the old call later
 *      resolves with data, or throws an error: nobody is waiting for it).
 *      If no  -> returns { status: "ok", value }, or rethrows its error.
 *
 * `run` receives the AbortSignal first, then the caller's arguments.
 */
export function latestOnly<A extends unknown[], T>(
  run: (signal: AbortSignal, ...args: A) => Promise<T>,
): (...args: A) => Promise<Latest<T>> {
  let current: AbortController | null = null;

  return async (...args: A): Promise<Latest<T>> => {
    current?.abort();
    const controller = new AbortController();
    current = controller;

    try {
      const value = await run(controller.signal, ...args);
      // A late answer from an old call still arrives here: drop it.
      if (controller.signal.aborted) return { status: "stale" };
      return { status: "ok", value };
    } catch (error) {
      // An error from an old call (usually the AbortError) is swallowed.
      if (controller.signal.aborted) return { status: "stale" };
      // An error from the newest call is the caller's problem.
      throw error;
    } finally {
      if (current === controller) current = null;
    }
  };
}
