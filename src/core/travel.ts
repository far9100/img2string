// How a thread goes on when no line from its pin helps (DECISIONS D-60). On a frame alone that is where a
// thread ends (D-13: letting it jump gained 0.05 points). With pins inside the picture a thread can stand in
// the middle of the picture, and when it has drawn what helps from there much is left elsewhere: without a way
// to the next place eight line drawings come to 66.0 % like their pictures, with one to 73.3 %.
//
// So the thread makes a trip: to a pair of pins anywhere, by a way that costs less than the pair gains. A way
// is made of
//  - walks: from a pin of the frame round the outside of the frame to any other of its pins, across no part
//    of the picture; nothing is drawn and nothing is cut;
//  - retraces: along a line this thread has drawn already, thread on thread, which shows nothing new;
//  - new lines, drawn like any other and paid for by the harm they do.
// Of all pairs it takes the one whose gain exceeds the harm of the way to it by most, and when no pair is worth
// its way the thread has ended.
//
// Finding that pair exactly would mean scoring every pair at every trip, which costs more than the run itself.
// Instead every pair keeps what it was worth when it was last scored (lines mostly lower the gains of others, so
// that is nearly always an upper bound): the ways are found with those, the pairs are looked at in the order
// of what they promise, and only those looked at are scored as things are now. The choice is therefore a
// good one, not provably the best, and it depends on what was scored before: the same run always makes the
// same trips, but a run that was stopped and continued may make others (greedy.ts).

export interface Graph {
  /** Pins in all; the first `frame` of them stand on the frame. */
  pins: number;
  frame: number;
  /** For every pin the pins a thread may run to from it, ascending, and for each of those the number of the pair. */
  adj: Int32Array[];
  pairOf: Int32Array[];
  /** The two pins of every pair, the lower one in `pu`; pairs are numbered by their lower pin, then the higher. */
  pu: Int32Array;
  pv: Int32Array;
}

/** The pairs of a table of allowed pairs (1 at [u * pins + v]) as lists. */
export function buildGraph(ok: Uint8Array, pins: number, frame: number): Graph {
  const to: number[][] = Array.from({ length: pins }, () => []), pair: number[][] = Array.from({ length: pins }, () => []);
  const pu: number[] = [], pv: number[] = [];
  // a pin's lower partners arrive while the outer loop is below it and its higher ones when the loop is at it,
  // each batch ascending: so every list is ascending
  for (let u = 0; u < pins; u++) for (let v = u + 1; v < pins; v++) {
    if (!ok[u * pins + v]) continue;
    const e = pu.length;
    pu.push(u);
    pv.push(v);
    to[u]!.push(v);
    pair[u]!.push(e);
    to[v]!.push(u);
    pair[v]!.push(e);
  }
  return { pins, frame, adj: to.map((l) => Int32Array.from(l)), pairOf: pair.map((l) => Int32Array.from(l)), pu: Int32Array.from(pu), pv: Int32Array.from(pv) };
}

/** The number of the pair of pins u and v, or -1 when a thread may not join them. */
export function pairIndex(g: Graph, u: number, v: number): number {
  const list = g.adj[u]!;
  let lo = 0, hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, w = list[mid]!;
    if (w === v) return g.pairOf[u]![mid]!;
    if (w < v) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

export interface Trip {
  /** The pair drawn at the end of the trip. */
  pair: number;
  /** The pins on the way to the nearer end of that pair, in order, that end last; empty when the thread is on it. */
  way: number[];
  /** For every pin of the way: whether the thread gets to it round the frame. */
  round: boolean[];
  /** What the trip is worth: the pair's gain less the harm and the length of the way. */
  net: number;
}

/** How many pairs a trip scores afresh at most, the most promising first. */
const LOOKS = 12800;

/** Hands out numbers from the one with the highest key down; among equal keys the lower number first. The keys
 * must stay as they are while it is in use. */
export class Ranking {
  private readonly heap: Int32Array;
  private readonly key: Float64Array;
  private size: number;

  /** The first `count` entries of `items` (which is kept and reordered), ranked by `key[item]`. */
  constructor(items: Int32Array, count: number, key: Float64Array) {
    this.heap = items;
    this.key = key;
    this.size = count;
    for (let i = (count >> 1) - 1; i >= 0; i--) this.sink(i);
  }

  private before(a: number, b: number): boolean {
    const ka = this.key[a]!, kb = this.key[b]!;
    return ka > kb || (ka === kb && a < b);
  }

  private sink(i: number): void {
    const { heap, size } = this, item = heap[i]!;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= size) break;
      if (child + 1 < size && this.before(heap[child + 1]!, heap[child]!)) child++;
      if (!this.before(heap[child]!, item)) break;
      heap[i] = heap[child]!;
      i = child;
    }
    heap[i] = item;
  }

  /** The next number, or -1 when all have been handed out. */
  next(): number {
    if (!this.size) return -1;
    const top = this.heap[0]!;
    this.size--;
    if (this.size) {
      this.heap[0] = this.heap[this.size]!;
      this.sink(0);
    }
    return top;
  }
}

export class Planner {
  /** After plan(): a trip worth more than the one returned (or than none) needed more steps than there was room for. */
  cramped = false;
  /** After plan(): every pair that could have made a better trip was looked at (false: only the first LOOKS of them). */
  thorough = true;

  private readonly g: Graph;
  private readonly around: (a: number, b: number) => number;
  private readonly dist: Float64Array;
  private readonly from: Int32Array;
  private readonly walked: Uint8Array;
  private readonly done: Uint8Array;
  private readonly hope: Float64Array;
  private readonly cand: Int32Array;

  /** `around(a, b)`: how far it is round the frame from frame pin a to frame pin b. */
  constructor(g: Graph, around: (a: number, b: number) => number) {
    const pairs = g.pu.length;
    this.g = g;
    this.around = around;
    this.dist = new Float64Array(g.pins);
    this.from = new Int32Array(g.pins);
    this.walked = new Uint8Array(g.pins);
    this.done = new Uint8Array(g.pins);
    this.hope = new Float64Array(pairs);
    this.cand = new Int32Array(pairs);
  }

  /** The least harmful way from `cur` to every other pin, by the pairs' last known gains: a pair the thread has
   * used costs nothing but the step, another the harm it was last known to do (none, if it gained), and from
   * the first pin of the frame that is reached every other pin of the frame is a walk away. */
  private reach(cur: number, used: Uint8Array, bound: Float64Array, step: number): void {
    const { g, dist, from, walked, done } = this, F = g.frame;
    dist.fill(Infinity);
    from.fill(-1);
    walked.fill(0);
    done.fill(0);
    const queue: number[] = [], key: number[] = [];
    const push = (pin: number, d: number) => {
      let i = queue.length;
      queue.push(pin);
      key.push(d);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (key[parent]! <= d) break;
        queue[i] = queue[parent]!;
        key[i] = key[parent]!;
        i = parent;
      }
      queue[i] = pin;
      key[i] = d;
    };
    const pop = (): number => {
      const pin = queue[0]!, lastPin = queue.pop()!, lastKey = key.pop()!;
      if (queue.length) {
        let i = 0;
        for (;;) {
          let child = 2 * i + 1;
          if (child >= queue.length) break;
          if (child + 1 < queue.length && key[child + 1]! < key[child]!) child++;
          if (key[child]! >= lastKey) break;
          queue[i] = queue[child]!;
          key[i] = key[child]!;
          i = child;
        }
        queue[i] = lastPin;
        key[i] = lastKey;
      }
      return pin;
    };
    let flooded = false;
    dist[cur] = 0;
    push(cur, 0);
    while (queue.length) {
      const u = pop();
      if (done[u]) continue;
      done[u] = 1;
      const d = dist[u]!;
      if (u < F && !flooded) {
        flooded = true;
        for (let w = 0; w < F; w++) if (!done[w] && d < dist[w]!) { dist[w] = d; from[w] = u; walked[w] = 1; push(w, d); }
      }
      const list = g.adj[u]!, idx = g.pairOf[u]!;
      for (let i = 0; i < list.length; i++) {
        const v = list[i]!;
        if (done[v]) continue;
        const e = idx[i]!, nd = d + (used[e] ? 0 : Math.max(0, -bound[e]!)) + step;
        if (nd < dist[v]!) { dist[v] = nd; from[v] = u; walked[v] = 0; push(v, nd); }
      }
    }
  }

  /**
   * The trip for a thread on pin `cur`, or null when no pair is worth its way.
   * `used` (1 per pair this thread has drawn) and `bound` (what every pair was worth when this thread last
   * scored it) are the thread's own, and `bound` is brought up to date for every pair scored here;
   * `score(pair, floor)` is what the line of a pair is worth to the thread as things are now, or, when that is
   * no more than `floor`, a number no smaller than it and no greater than `floor`; `step` is what a line of
   * the way costs besides its harm, so that the way is short where nothing else decides; `room` is how many
   * more steps the thread may take.
   */
  plan(cur: number, used: Uint8Array, bound: Float64Array, score: (pair: number, floor: number) => number, step: number, room: number): Trip | null {
    const { g, dist, from, walked, hope, cand } = this, { pu, pv } = g, pairs = pu.length;
    this.cramped = false;
    this.thorough = true;
    this.reach(cur, used, bound, step);
    // the pairs that promise something, the most promising first: what a pair was last worth, less the way to it
    let count = 0;
    for (let t = 0; t < pairs; t++) {
      if (used[t] || !(bound[t]! > 0)) continue;
      hope[t] = bound[t]! - Math.min(dist[pu[t]!]!, dist[pv[t]!]!);
      if (hope[t]! > 0) cand[count++] = t;
    }
    const ranking = new Ranking(cand, count, hope);
    let net = 0, pick = -1, pickWay: number[] = [];
    for (let looked = 0; ; looked++) {
      const t = ranking.next();
      if (t < 0 || hope[t]! <= net) break; // nothing after it can be better either
      if (looked >= LOOKS) { this.thorough = false; break; }
      const gain = score(t, net);
      bound[t] = gain;
      if (!(gain > net)) continue;
      const a = pu[t]!, b = pv[t]!;
      // to the nearer end; where both are a walk away, to the one nearer round the frame
      const both = dist[b] === dist[a] && walked[a] === 1 && walked[b] === 1 && from[a] === cur && from[b] === cur;
      const end = dist[b]! < dist[a]! || (both && this.around(cur, b) < this.around(cur, a)) ? b : a;
      const way: number[] = [];
      for (let x = end; x !== cur; x = from[x]!) way.push(x);
      way.reverse();
      let value = gain;
      for (let k = 0, at = cur; k < way.length; at = way[k++]!) {
        if (walked[way[k]!]) continue;
        const e = pairIndex(g, at, way[k]!);
        if (used[e]) value -= step;
        else {
          const worth = score(e, -Infinity);
          bound[e] = worth;
          value += worth - step;
        }
      }
      if (!(value > net)) continue;
      if (way.length + 1 > room) { this.cramped = true; continue; }
      net = value;
      pick = t;
      pickWay = way;
    }
    return pick < 0 ? null : { pair: pick, way: pickWay, round: pickWay.map((pin) => walked[pin] === 1), net };
  }
}
