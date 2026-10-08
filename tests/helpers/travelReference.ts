// One thread over pins inside the picture, written straight down (DECISIONS D-60): every candidate from the
// thread's pin scored afresh at every step (lineGain.ts: Model.gain() in the generator's arithmetic), and a trip when none helps. It shares nothing
// with greedy.ts and travel.ts but frame.ts's pins and pairs, so the tests can hold the generator to it line
// for line, the way they hold it to stringart.ts's generate() on a frame alone. After the experiment's run2()
// ("travel"), with the app's rules where they differ: a step round the frame counts against the budget, a
// trip that does not fit the budget is passed over, and the cost of a step goes with the thread's contrast.
import { allowedPairs, aroundFrame, framePins, pinCount, roundTo, type FrameOptions } from "../../src/core/frame.ts";
import { coverageAlpha, Model, rasterLine } from "../../src/core/stringart.ts";
import { lineGain } from "./lineGain.ts";

const LOOKS = 12800;

export function travelReference(o: FrameOptions, target: Float64Array, weight: Float64Array): { sequence: number[]; error: number } {
  const P = framePins(o), N = pinCount(o), F = o.pins, ok = allowedPairs(o), alpha = coverageAlpha(o), model = new Model(o, target, weight), budget = o.maxLines[0]!;
  const score = (u: number, v: number): number => lineGain(model, 0, rasterLine(o.res, alpha, P[2 * u]!, P[2 * u + 1]!, P[2 * v]!, P[2 * v + 1]!));
  const c = o.threads[0]!, contrast = ((c[0] - o.board[0]) ** 2 + (c[1] - o.board[1]) ** 2 + (c[2] - o.board[2]) ** 2) / 3, step = 0.25 * alpha * alpha * Math.max(0.05, contrast);

  // every allowed pair once (u ascending, then v), and for every pin its partners with the pair's number
  const pu: number[] = [], pv: number[] = [], partners: { pin: number; pair: number }[][] = Array.from({ length: N }, () => []);
  for (let u = 0; u < N; u++) for (let v = u + 1; v < N; v++) {
    if (!ok[u * N + v]) continue;
    partners[u]!.push({ pin: v, pair: pu.length });
    partners[v]!.push({ pin: u, pair: pu.length });
    pu.push(u);
    pv.push(v);
  }
  for (const list of partners) list.sort((a, b) => a.pin - b.pin);
  const pairOf = (u: number, v: number): number => partners[u]!.find((p) => p.pin === v)!.pair;
  const pairs = pu.length, used = new Array<boolean>(pairs).fill(false), bound = new Array<number>(pairs).fill(0);

  const sequence: number[] = [];
  let cur = -1;
  const draw = (u: number, v: number) => {
    model.apply(0, rasterLine(o.res, alpha, P[2 * u]!, P[2 * u + 1]!, P[2 * v]!, P[2 * v + 1]!));
    sequence.push(v);
    used[pairOf(u, v)] = true;
    cur = v;
  };
  {
    let best = 0, at = -1;
    for (let t = 0; t < pairs; t++) { bound[t] = score(pu[t]!, pv[t]!); if (bound[t]! > best) { best = bound[t]!; at = t; } }
    if (at < 0) return { sequence, error: model.error() };
    sequence.push(pu[at]!);
    draw(pu[at]!, pv[at]!);
  }

  for (;;) {
    const room = budget - (sequence.length - 1);
    if (room < 1) break;
    let best = 0, to = -1;
    for (const { pin, pair } of partners[cur]!) {
      if (used[pair]) continue;
      bound[pair] = score(cur, pin);
      if (bound[pair]! > best) { best = bound[pair]!; to = pin; }
    }
    if (to >= 0) { draw(cur, to); continue; }

    // The least harmful way from here to every pin (Dijkstra). The generator keeps its open pins in a binary
    // heap, and which of two equally near pins comes out first depends on the heap's shape; so that ties are
    // settled the same way here, the open pins are kept in the same kind of heap.
    const dist = new Array<number>(N).fill(Infinity), from = new Array<number>(N).fill(-1), walked = new Array<boolean>(N).fill(false), done = new Array<boolean>(N).fill(false);
    let flooded = false;
    dist[cur] = 0;
    const heapPin: number[] = [], heapKey: number[] = [];
    const heapPush = (pin: number, d: number) => {
      let i = heapPin.length;
      heapPin.push(pin);
      heapKey.push(d);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heapKey[parent]! <= d) break;
        heapPin[i] = heapPin[parent]!;
        heapKey[i] = heapKey[parent]!;
        i = parent;
      }
      heapPin[i] = pin;
      heapKey[i] = d;
    };
    const heapPop = (): number => {
      const pin = heapPin[0]!, lastPin = heapPin.pop()!, lastKey = heapKey.pop()!;
      if (heapPin.length) {
        let i = 0;
        for (;;) {
          let child = 2 * i + 1;
          if (child >= heapPin.length) break;
          if (child + 1 < heapPin.length && heapKey[child + 1]! < heapKey[child]!) child++;
          if (heapKey[child]! >= lastKey) break;
          heapPin[i] = heapPin[child]!;
          heapKey[i] = heapKey[child]!;
          i = child;
        }
        heapPin[i] = lastPin;
        heapKey[i] = lastKey;
      }
      return pin;
    };
    heapPush(cur, 0);
    while (heapPin.length) {
      const u = heapPop();
      if (done[u]) continue;
      done[u] = true;
      const d = dist[u]!;
      if (u < F && !flooded) {
        flooded = true;
        for (let w = 0; w < F; w++) if (!done[w] && d < dist[w]!) { dist[w] = d; from[w] = u; walked[w] = true; heapPush(w, d); }
      }
      for (const { pin: v, pair } of partners[u]!) {
        if (done[v]) continue;
        const nd = d + (used[pair] ? 0 : Math.max(0, -bound[pair]!)) + step;
        if (nd < dist[v]!) { dist[v] = nd; from[v] = u; walked[v] = false; heapPush(v, nd); }
      }
    }

    // Of all pairs, the one whose gain exceeds the harm of the way to it by most: those that promise something
    // by what they last scored, the most promising first, each scored as things are now, and so are the new
    // lines of its way.
    const cand: { t: number; hope: number }[] = [];
    for (let t = 0; t < pairs; t++) {
      if (used[t] || !(bound[t]! > 0)) continue;
      const hope = bound[t]! - Math.min(dist[pu[t]!]!, dist[pv[t]!]!);
      if (hope > 0) cand.push({ t, hope });
    }
    cand.sort((x, y) => y.hope - x.hope || x.t - y.t);
    let net = 0, pick = -1, pickWay: number[] = [];
    for (let looked = 0; looked < cand.length && looked < LOOKS; looked++) {
      const { t, hope } = cand[looked]!;
      if (hope <= net) break;
      const gain = score(pu[t]!, pv[t]!);
      bound[t] = gain;
      if (!(gain > net)) continue;
      const a = pu[t]!, b = pv[t]!;
      const both = dist[b] === dist[a] && walked[a]! && walked[b]! && from[a] === cur && from[b] === cur;
      const end = dist[b]! < dist[a]! || (both && aroundFrame(o, cur, b).length < aroundFrame(o, cur, a).length) ? b : a;
      const way: number[] = [];
      for (let x = end; x !== cur; x = from[x]!) way.push(x);
      way.reverse();
      let value = gain;
      for (let k = 0, at = cur; k < way.length; at = way[k++]!) {
        if (walked[way[k]!]) continue;
        const pair = pairOf(at, way[k]!);
        if (used[pair]) value -= step;
        else {
          bound[pair] = score(at, way[k]!);
          value += bound[pair]! - step;
        }
      }
      if (!(value > net) || way.length + 1 > room) continue;
      net = value;
      pick = t;
      pickWay = way;
    }
    if (pick < 0) break;
    const round = pickWay.map((pin) => walked[pin]!);
    pickWay.forEach((pin, i) => {
      if (round[i]) { sequence.push(roundTo(pin)); cur = pin; }
      else if (used[pairOf(cur, pin)]) { sequence.push(pin); cur = pin; }
      else draw(cur, pin);
    });
    draw(cur, cur === pu[pick]! ? pv[pick]! : pu[pick]!);
  }
  return { sequence, error: model.error() };
}
