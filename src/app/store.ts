// A small store (ported from img2shadow): the state is immutable (every change makes new objects along the
// changed path), so a watcher compares what it selects with === (or a shallow compare) to know whether
// anything changed.
// Notifications are batched: any number of updates in one task wake each watcher at most once.

export type Path = readonly (string | number)[];
type Equals<T> = (a: T, b: T) => boolean;

export interface Store<S> {
  get(): S;
  set(next: S): void;
  update(fn: (s: S) => S): void;
  /** Sets the value at `path`, copying the objects/arrays along it. */
  setIn(path: Path, value: unknown): void;
  /** Calls `cb` whenever the selected value changes; returns a function that stops watching. */
  watch<T>(select: (s: S) => T, cb: (value: T, prev: T) => void, equals?: Equals<T>): () => void;
  /** Runs pending notifications now (tests, and code that needs the DOM up to date immediately). */
  flush(): void;
}

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

export function setIn<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  const current = (obj as Record<string | number, unknown>)?.[head!];
  const next = setIn(current, rest, value);
  if (Object.is(current, next)) return obj;
  if (Array.isArray(obj)) {
    const copy = obj.slice();
    copy[head as number] = next;
    return copy as T;
  }
  return { ...(obj as object), [head!]: next } as T;
}

export function getIn(obj: unknown, path: Path): unknown {
  let o = obj;
  for (const k of path) o = (o as Record<string | number, unknown> | undefined)?.[k];
  return o;
}

interface Watcher<S> {
  select: (s: S) => unknown;
  cb: (v: unknown, prev: unknown) => void;
  equals: Equals<unknown>;
  last: unknown;
}

export function createStore<S>(initial: S): Store<S> {
  let state = initial;
  const watchers = new Set<Watcher<S>>();
  let scheduled = false;

  const notify = () => {
    scheduled = false;
    for (const w of [...watchers]) {
      if (!watchers.has(w)) continue;
      const value = w.select(state);
      if (!w.equals(value, w.last)) {
        const prev = w.last;
        w.last = value;
        w.cb(value, prev);
      }
    }
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      if (scheduled) notify();
    });
  };

  return {
    get: () => state,
    set(next) {
      if (next === state) return;
      state = next;
      schedule();
    },
    update(fn) {
      this.set(fn(state));
    },
    setIn(path, value) {
      this.set(setIn(state, path, value));
    },
    watch(select, cb, equals) {
      const w: Watcher<S> = {
        select: select as (s: S) => unknown,
        cb: cb as (v: unknown, prev: unknown) => void,
        equals: (equals ?? Object.is) as Equals<unknown>,
        last: select(state),
      };
      watchers.add(w);
      return () => watchers.delete(w);
    },
    flush() {
      if (scheduled) notify();
    },
  };
}
