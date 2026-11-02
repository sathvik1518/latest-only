import { describe, it, expect } from "vitest";
import { latestOnly, type Latest } from "./latestOnly";

// A promise we resolve/reject by hand. No timers, so tests are deterministic.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Fake "request": records each call and lets the test finish it later.
function makeFake() {
  const calls: {
    arg: string;
    signal: AbortSignal;
    d: ReturnType<typeof deferred<string>>;
  }[] = [];
  const run = (signal: AbortSignal, arg: string) => {
    const d = deferred<string>();
    calls.push({ arg, signal, d });
    return d.promise;
  };
  return { calls, run };
}

describe("latestOnly", () => {
  it("returns ok with the value for a single call", async () => {
    const fake = makeFake();
    const search = latestOnly(fake.run);

    const p = search("a");
    fake.calls[0]!.d.resolve("result-a");

    expect(await p).toEqual({ status: "ok", value: "result-a" });
  });

  it("passes the caller's arguments through", async () => {
    const fake = makeFake();
    const search = latestOnly(fake.run);

    const p = search("hello");
    expect(fake.calls[0]!.arg).toBe("hello");
    fake.calls[0]!.d.resolve("x");
    await p;
  });

  it("aborts the previous call when a new one starts", () => {
    const fake = makeFake();
    const search = latestOnly(fake.run);

    void search("a");
    expect(fake.calls[0]!.signal.aborted).toBe(false);

    void search("b");
    expect(fake.calls[0]!.signal.aborted).toBe(true);
    expect(fake.calls[1]!.signal.aborted).toBe(false);
  });

  it("marks the old call stale when it resolves late", async () => {
    const fake = makeFake();
    const search = latestOnly(fake.run);

    const first = search("a");
    const second = search("b");

    fake.calls[1]!.d.resolve("result-b");
    fake.calls[0]!.d.resolve("result-a"); // old answer arrives AFTER

    expect(await first).toEqual({ status: "stale" });
    expect(await second).toEqual({ status: "ok", value: "result-b" });
  });

  it("marks the old call stale even when it resolves first", async () => {
    const fake = makeFake();
    const search = latestOnly(fake.run);

    const first = search("a");
    const second = search("b");

    fake.calls[0]!.d.resolve("result-a"); // old answer arrives BEFORE
    fake.calls[1]!.d.resolve("result-b");

    expect(await first).toEqual({ status: "stale" });
    expect(await second).toEqual({ status: "ok", value: "result-b" });
  });

  it("swallows an error from an old call", async () => {
    const fake = makeFake();
    const search = latestOnly(fake.run);

    const first = search("a");
    const second = search("b");

    fake.calls[0]!.d.reject(new DOMException("aborted", "AbortError"));
    fake.calls[1]!.d.resolve("result-b");

    expect(await first).toEqual({ status: "stale" });
    expect(await second).toEqual({ status: "ok", value: "result-b" });
  });

  it("passes on an error from the newest call", async () => {
    const fake = makeFake();
    const search = latestOnly(fake.run);

    const p = search("a");
    fake.calls[0]!.d.reject(new Error("server down"));

    await expect(p).rejects.toThrow("server down");
  });

  it("keeps only the last of many rapid calls", async () => {
    const fake = makeFake();
    const search = latestOnly(fake.run);

    const results = ["a", "b", "c", "d", "e"].map((q) => search(q));
    // Finish them in a scrambled order.
    for (const i of [2, 4, 0, 3, 1]) fake.calls[i]!.d.resolve(`r-${i}`);

    const settled = await Promise.all(results);
    expect(settled.map((r) => r.status)).toEqual([
      "stale",
      "stale",
      "stale",
      "stale",
      "ok",
    ]);
    expect(settled[4]).toEqual({ status: "ok", value: "r-4" });
  });

  it("works again after the previous call has finished", async () => {
    const fake = makeFake();
    const search = latestOnly(fake.run);

    const first = search("a");
    fake.calls[0]!.d.resolve("one");
    expect(await first).toEqual({ status: "ok", value: "one" });

    const second = search("b");
    // The finished first call must not be aborted by the second one.
    expect(fake.calls[0]!.signal.aborted).toBe(false);
    fake.calls[1]!.d.resolve("two");
    expect(await second).toEqual({ status: "ok", value: "two" });
  });

  it("each wrapped function has its own independent state", async () => {
    const f1 = makeFake();
    const f2 = makeFake();
    const a = latestOnly(f1.run);
    const b = latestOnly(f2.run);

    const pa = a("x");
    const pb = b("y"); // must NOT cancel a's call

    expect(f1.calls[0]!.signal.aborted).toBe(false);
    f1.calls[0]!.d.resolve("A");
    f2.calls[0]!.d.resolve("B");

    expect(await pa).toEqual({ status: "ok", value: "A" });
    expect(await pb).toEqual({ status: "ok", value: "B" });
  });

  it("forces the caller to handle stale (compile-time proof)", async () => {
    const search = latestOnly(async (_signal: AbortSignal, n: number) => n * 2);
    const result: Latest<number> = await search(21);

    // @ts-expect-error: `value` does not exist until status is narrowed to "ok"
    void result.value;

    if (result.status === "ok") {
      const doubled: number = result.value; // narrowed: allowed
      expect(doubled).toBe(42);
    } else {
      expect(result.status).toBe("stale");
    }
  });
});
