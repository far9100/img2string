import { describe, expect, it } from "vitest";
import { createStore, getIn, setIn, shallowEqual } from "../../src/app/store.ts";

describe("store", () => {
  it("setIn copies only along the path", () => {
    const a = { x: { y: 1, z: [1, 2] }, w: { v: 3 } };
    const b = setIn(a, ["x", "z", 1], 5);
    expect(b.x.z).toEqual([1, 5]);
    expect(a.x.z).toEqual([1, 2]);
    expect(b.w).toBe(a.w);
    expect(setIn(a, ["x", "y"], 1)).toBe(a);
    expect(getIn(b, ["x", "z", 1])).toBe(5);
  });

  it("batches notifications and only fires when the selection changes", async () => {
    const store = createStore({ a: 1, b: { c: 2 } });
    const seen: number[] = [];
    store.watch((s) => s.a, (v) => seen.push(v));
    let bCalls = 0;
    store.watch((s) => s.b, () => bCalls++);
    store.setIn(["a"], 2);
    store.setIn(["a"], 3);
    await Promise.resolve();
    expect(seen).toEqual([3]);
    expect(bCalls).toBe(0);
    store.setIn(["b", "c"], 4);
    store.flush();
    expect(bCalls).toBe(1);
  });

  it("stops watching", () => {
    const store = createStore({ a: 1 });
    let n = 0;
    const stop = store.watch((s) => s.a, () => n++);
    stop();
    store.setIn(["a"], 2);
    store.flush();
    expect(n).toBe(0);
  });

  it("shallowEqual", () => {
    const o = {};
    expect(shallowEqual({ a: 1, b: o }, { a: 1, b: o })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
  });
});
