# latestOnly: Only the Newest Call Counts

**Day 37 Mini Capstone, Advanced UX**
**Project folder:** `latest-only`

---

## 1. Goal

Three places in the app need the same behaviour: start a request, cancel the one before, and ignore an old answer that still arrives later. The task (Day 37 Deep Dive, Mini Capstone) was to write a small, typed function `latestOnly(run)` that does this for any async function, and prove it with tests.

This is the "race condition" problem: the user types "a", then "ab". If the answer for "a" arrives after the answer for "ab", the screen would show the wrong results.

---

## 2. Tools

| Tool | Role |
|---|---|
| TypeScript (strict mode) | The typed function and the compile-time checks |
| AbortController / AbortSignal | Built-in way to cancel a request |
| Vitest | Test runner |

---

## 3. Project structure

```
latest-only/
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
├── DOCUMENTATION.md
└── src/
    ├── latestOnly.ts          (the capstone function)
    └── latestOnly.test.ts     (11 tests)
```

---

## 4. Setup commands

```bash
mkdir latest-only
cd latest-only
npm init -y
npm install -D typescript vitest
```

**`package.json` scripts**

```json
"test": "vitest run",
"typecheck": "tsc --noEmit"
```

---

## 5. The function

**`src/latestOnly.ts`**

```ts
export type Latest<T> = { status: "ok"; value: T } | { status: "stale" };

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
      if (controller.signal.aborted) return { status: "stale" };
      return { status: "ok", value };
    } catch (error) {
      if (controller.signal.aborted) return { status: "stale" };
      throw error;
    } finally {
      if (current === controller) current = null;
    }
  };
}
```

### How it works

1. Each call aborts the previous call's `AbortController`.
2. It creates a new controller and passes its `signal` to `run`.
3. When the call ends, it checks whether **its own** controller was aborted.
4. If aborted, it returns `{ status: "stale" }`. This covers both a late answer and an error from the old call (usually the `AbortError`), because nobody is waiting for it.
5. An error from the newest call is passed on to the caller.

### Design decisions

| Decision | Reason |
|---|---|
| Result is a union `ok` / `stale` | The compiler forces the caller to handle the stale case. They cannot forget it. |
| Check `signal.aborted` after the await | Not every function listens to the signal. Even if an old request ignores the cancel and still returns data, the result is dropped. |
| Each call checks its own controller | A shared "latest id" variable can be overwritten. Each call keeping its own controller is safe. |
| Old errors are swallowed | An `AbortError` from a cancelled request is expected, not a real failure. |
| Newest errors are rethrown | A real failure must not be hidden. |
| Generics `<A extends unknown[], T>` | Works for any argument list and any return type, with full type checking. |
| `signal` is the first parameter of `run` | The caller's own arguments keep their normal order after it. |
| State lives in a closure | Each wrapped function has its own independent "current call". Two wrapped functions never cancel each other. |
| `finally` clears `current` only if it is still ours | A finished call must not clear a newer call's controller. |

---

## 6. Tests (11 tests)

**`src/latestOnly.test.ts`**

The tests use a hand-made "deferred" promise: the test decides exactly when each fake request finishes. There are no timers and no real network, so the results are the same on any computer.

| # | Test | What it proves |
|---|---|---|
| 1 | Single call returns ok with the value | Basic success path |
| 2 | Passes the caller's arguments through | Argument forwarding |
| 3 | Aborts the previous call when a new one starts | The old request is cancelled |
| 4 | Old call resolves late, marked stale | The classic race condition is fixed |
| 5 | Old call resolves first, still stale | Order of arrival does not matter |
| 6 | Error from an old call is swallowed | Cancelled requests do not crash the caller |
| 7 | Error from the newest call is passed on | Real failures are not hidden |
| 8 | Five rapid calls, scrambled finish order | Only the last one is `ok` |
| 9 | Works again after a call has finished | A finished call is not aborted by the next one |
| 10 | Two wrapped functions are independent | State is not shared |
| 11 | `@ts-expect-error` on `result.value` before narrowing | The compiler really forces the caller to check `status` |

---

## 7. Results

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | No errors |
| Tests | `npm test` | **11 passed** |
| Break-it check 1 | Removed the line that aborts the previous call | **5 tests failed** (tests catch it) |
| Break-it check 2 | Removed the "was I aborted?" checks | **4 tests failed** (tests catch it) |
| Restored original | `npm test` | 11 passed again |

---

## 8. Using it in the app

```ts
const searchLatest = latestOnly((signal, query: string) =>
  fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal }).then((r) => r.json()),
);

const result = await searchLatest("ab");
if (result.status === "ok") {
  showResults(result.value);
}
// stale: do nothing, a newer search is already running
```

The same function can be used for search boxes, tab loading and form validation without rewriting the cancel logic each time.

---

## 9. What was practiced

- Handling race conditions: cancel the old request and ignore the old answer.
- Using `AbortController` and `AbortSignal`.
- Designing a result type (discriminated union) so the compiler forces the caller to handle every case.
- Writing generics that keep full type safety for any async function.
- Testing async code deterministically with deferred promises instead of timers.
- Proving a type rule with `@ts-expect-error`.
- Checking that tests are real by breaking the code on purpose and watching them fail.

---

## 10. Known limit

`latestOnly` can only cancel a request if `run` passes the `signal` on (for example to `fetch`). If it does not, the request still finishes in the background, but its result is correctly dropped as `stale`.

---

## 11. How to run it

```bash
cd latest-only
npm install
npm test            # 11 tests
npm run typecheck   # type check
```
