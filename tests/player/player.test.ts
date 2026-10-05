// The winding player's logic (spec §7.4).
import { describe, expect, it } from "vitest";
import { buildPlan, clampPosition, hoursMinutes, neighbourThread, planKey, positionOfStep, progressStorageKey, remainingSeconds, stepAt, viewAt } from "../../src/player/player.ts";

// two threads on a 256-pin frame: three lines, then two lines; a third thread that never started
const sequences = [[0, 136, 7, 200], [10, 100, 250], []];
const plan = buildPlan(sequences, 256);

describe("the player's plan", () => {
  it("lays the threads out in winding order", () => {
    expect(plan.steps.map((s) => [s.thread, s.line, s.from, s.to])).toEqual([[0, 1, 0, 136], [0, 2, 136, 7], [0, 3, 7, 200], [1, 1, 10, 100], [1, 2, 100, 250]]);
    expect(plan.threads).toEqual([{ start: 0, lines: 3 }, { start: 3, lines: 2 }, { start: 5, lines: 0 }]);
  });

  it("shows pins as the user counts them (from 1) with the clock hint", () => {
    const first = viewAt(plan, 0);
    expect(first).toMatchObject({ position: 0, total: 5, done: false, thread: 0, threadLine: 1, threadLines: 3, tieOn: true, fromPin: 1, nextPin: 137, nextClock: "6:25", thenPin: 8, remainingLines: 5 });
    expect(viewAt(plan, 1)).toMatchObject({ tieOn: false, fromPin: 137, nextPin: 8, thenPin: 201 });
    // the last line of a thread has nothing after it in that thread; the next position ties the next thread on
    expect(viewAt(plan, 2)).toMatchObject({ thread: 0, threadLine: 3, nextPin: 201, thenPin: 0 });
    expect(viewAt(plan, 3)).toMatchObject({ thread: 1, threadLine: 1, tieOn: true, fromPin: 11, nextPin: 101, thenPin: 251 });
  });

  it("numbers steps as the printed instructions do: step 1 is the pin a thread is tied to", () => {
    // sequences [0, 136, 7, 200] print as steps 1..4; the player's big number is the pin of the step shown
    expect([0, 1, 2].map((p) => [viewAt(plan, p).step, viewAt(plan, p).steps, viewAt(plan, p).nextPin])).toEqual([[2, 4, 137], [3, 4, 8], [4, 4, 201]]);
    expect([3, 4].map((p) => [viewAt(plan, p).thread, viewAt(plan, p).step, viewAt(plan, p).steps])).toEqual([[1, 2, 3], [1, 3, 3]]);
    // going to a step shows the line that reaches its pin; steps 1 and 2 are both the first line
    expect([1, 2, 3, 4].map((s) => positionOfStep(plan, 0, s))).toEqual([0, 0, 1, 2]);
    expect([1, 2, 3].map((s) => positionOfStep(plan, 1, s))).toEqual([3, 3, 4]);
    for (const [thread, sequence] of sequences.entries()) {
      for (let s = 2; s <= sequence.length; s++) expect(viewAt(plan, positionOfStep(plan, thread, s))).toMatchObject({ thread, step: s, nextPin: sequence[s - 1]! + 1 });
    }
    // out of range: the first or the last line of that thread, never another thread's
    expect([positionOfStep(plan, 0, -5), positionOfStep(plan, 0, 99), positionOfStep(plan, 1, 99), positionOfStep(plan, 0, Number.NaN), positionOfStep(plan, 0, 2.6)]).toEqual([0, 2, 4, 0, 1]);
  });

  it("finds a position's thread and step from the line counts alone, as the full plan does", () => {
    const lines = sequences.map((s) => Math.max(0, s.length - 1));
    for (let p = -1; p <= 7; p++) {
      const v = viewAt(plan, p);
      expect(stepAt(lines, p)).toEqual({ thread: v.thread, step: v.step, steps: v.steps, done: v.done });
    }
    expect(stepAt([0, 2, 0, 1], 2)).toEqual({ thread: 3, step: 2, steps: 2, done: false }); // threads without lines are passed over
    expect(stepAt([], 0)).toEqual({ thread: 0, step: 0, steps: 0, done: true });
    expect(stepAt([0, 0], 3)).toEqual({ thread: 0, step: 0, steps: 0, done: true });
  });

  it("steps between threads, passing over those that never started", () => {
    const p = buildPlan([[1, 9], [], [3, 30, 60], []], 64);
    expect([neighbourThread(p, 0, 1), neighbourThread(p, 2, -1), neighbourThread(p, 0, -1), neighbourThread(p, 2, 1)]).toEqual([2, 0, -1, -1]);
    expect(p.threads[neighbourThread(p, 0, 1)]!.start).toBe(1);
  });

  it("ends after the last line", () => {
    expect(viewAt(plan, 5)).toMatchObject({ done: true, position: 5, remainingLines: 0, thread: 1, tieOn: false });
    expect(viewAt(plan, 99).position).toBe(5);
    expect(viewAt(plan, -3).position).toBe(0);
    expect(clampPosition(plan, Number.NaN)).toBe(0);
    expect(viewAt(buildPlan([[]], 64), 0)).toMatchObject({ done: true, total: 0 });
  });

  it("estimates the time left from the lines left", () => {
    expect(remainingSeconds(plan, 0, 8)).toBe(40);
    expect(remainingSeconds(plan, 4, 8)).toBe(8);
    expect(hoursMinutes(1410 * 8)).toEqual({ h: 3, min: 8 });
    expect(hoursMinutes(59)).toEqual({ h: 0, min: 1 });
  });

  it("keys a piece by its pins and sequences only", () => {
    const key = planKey(sequences, 256);
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    expect(planKey(sequences.map((s) => s.slice()), 256)).toBe(key);
    expect(planKey(sequences, 255)).not.toBe(key);
    expect(planKey([[0, 136, 7, 201], [10, 100, 250], []], 256)).not.toBe(key);
    expect(planKey([[0, 136, 7], [200, 10, 100, 250], []], 256)).not.toBe(key); // the same pins split differently
    expect(progressStorageKey(key)).toBe(`img2string.progress.${key}`);
  });
});
