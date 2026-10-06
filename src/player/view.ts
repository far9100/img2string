// The winding player (spec §7.4): a full-window dialog with the next pin in large numerals in the colour of the
// thread being wound, previous and next, the keyboard (Space, Enter or right arrow to advance; left arrow or
// Backspace to go back), progress and the time left, and optionally the pin read aloud by a voice of the
// device. The position is kept by the controller (localStorage and the project file).
import type { Controller } from "../app/controller.ts";
import type { AppState } from "../app/state.ts";
import { accentFor, textOn } from "../core/palette.ts";
import { aroundFrame, frameBounds, framePins, insideCount, unitAll, type Side } from "../core/frame.ts";
import { whereIs } from "../core/instructions.ts";
import { frameSpec } from "../core/project.ts";
import { getLang, t } from "../i18n/i18n.ts";
import { fitCanvas, themeColour, themeHex } from "../ui/canvasUtil.ts";
import { button, checkField, h, tx } from "../ui/dom.ts";
import { buildPlan, hoursMinutes, neighbourThread, positionOfStep, remainingSeconds, viewAt, type Plan, type View } from "./player.ts";
import { createSpeaker } from "./voice.ts";

/** Whether to read the pins aloud is remembered on this device (a device has voices or it has not). */
const VOICE_KEY = "img2string.voice";

/** Where the next pin is on a rectangular frame: its side, and its number along it counted the way the pins
 * are numbered (DECISIONS D-58). A round frame says it by the clock, and a pin inside the picture by its
 * distance from the frame's left and top (D-60): instructions.ts's whereIs decides which. */
const SIDE_TEXT: Record<Side, string> = { top: "player.sideTop", right: "player.sideRight", bottom: "player.sideBottom", left: "player.sideLeft" };

/** The close-up beside the map, for a piece with pins inside the picture: its side in CSS pixels, and how
 * many millimetres of the piece it shows across. A pin inside cannot be found by counting along the frame, so
 * the close-up shows the next pin among its neighbours, each with its number. */
const NEAR_PX = 220, NEAR_MM = 70;

export interface PlayerView {
  open(): void;
  sync(s: AppState): void;
}

export function mountPlayer(ctl: Controller): PlayerView {
  const swatch = h("span", { class: "player-swatch" });
  const threadName = h("span", { class: "player-thread" });
  const threadCount = h("span", { class: "player-count" });
  const note = h("p", { class: "player-note" });
  const label = tx("player.next", "player-label");
  const pin = h("output", { class: "player-pin", "aria-live": "polite" });
  const clock = h("p", { class: "player-clock" });
  const then = h("p", { class: "player-then" });
  const map = h("canvas", { class: "player-map", width: 280, height: 280, "aria-hidden": "true" });
  const near = h("canvas", { class: "player-near", width: NEAR_PX, height: NEAR_PX, "aria-hidden": "true" });
  const nearLabel = tx("player.near", "hint player-near-label");
  const bar = h("progress", { max: 1, value: 0 });
  const status = h("p", { class: "player-status" });
  const back = button("player.back", () => move(-1), "big");
  const forward = button("player.forward", () => move(1), "primary big");
  // steps are counted as on the printed instructions: step 1 is the pin a thread is tied to (DECISIONS D-35)
  const jump = h("input", { type: "number", class: "num", min: 1, step: 1, "data-i18n-aria-label": "player.jump" });
  const goTo = () => {
    const made = ctl.state.made;
    if (!plan || !made || !Number.isFinite(jump.valueAsNumber)) return;
    ctl.setPlayerStep(positionOfStep(plan, viewAt(plan, made.player.step).thread, jump.valueAsNumber));
  };
  const go = button("player.go", goTo);
  const otherThread = (by: -1 | 1) => () => {
    const made = ctl.state.made;
    if (!plan || !made) return;
    const k = neighbourThread(plan, viewAt(plan, made.player.step).thread, by);
    if (k >= 0) ctl.setPlayerStep(plan.threads[k]!.start);
  };
  const prevThread = button("player.prevThread", otherThread(-1)), nextThread = button("player.nextThread", otherThread(1));
  const close = button("player.close", () => dialog.close());
  // §7.4: read the next pin aloud, with a voice that runs on this device only
  const speaker = createSpeaker();
  let voiceOn = false, spokenAt = -1;
  try { voiceOn = localStorage.getItem(VOICE_KEY) === "1"; } catch { /* storage may be blocked */ }
  const voice = checkField({
    label: "player.voice",
    onChange: (on) => {
      voiceOn = on;
      try { localStorage.setItem(VOICE_KEY, on ? "1" : "0"); } catch { /* storage may be blocked */ }
      spokenAt = -1;
      if (!on) speaker.stop();
      sync(ctl.state);
    },
  });
  const voiceNote = tx("player.voiceNone", "hint");
  speaker.onChange(() => sync(ctl.state));
  /** What is said at a position. */
  const phrase = (v: View, name: string): string =>
    v.done ? t("voice.done")
      : v.tieOn ? (v.thread > 0 ? t("voice.change", { name, from: v.fromPin, pin: v.nextPin }) : t("voice.tie", { from: v.fromPin, pin: v.nextPin }))
      : v.round ? t("voice.round", { pin: v.nextPin }) // heard as a bare number, the thread would go across the picture
      : String(v.nextPin);
  const dialog = h("dialog", { class: "player", "data-i18n-aria-label": "player.title" },
    h("header", { class: "player-head" }, h("div", { class: "player-colour" }, swatch, threadName, threadCount), close),
    h("div", { class: "player-body" },
      h("div", { class: "player-main" }, note, label, pin, clock, then),
      h("div", { class: "player-maps" }, map, near, nearLabel),
    ),
    bar, status,
    h("div", { class: "player-buttons" }, back, forward),
    h("div", { class: "row player-jump" }, tx("player.jumpLabel"), jump, go, prevThread, nextThread),
    h("div", { class: "row wrap player-voice" }, voice.el, voiceNote),
    tx("player.keys", "hint"),
  );
  document.body.append(dialog);

  let plan: Plan | null = null, planOf: unknown = null;
  const move = (by: number) => {
    const made = ctl.state.made;
    if (made) ctl.setPlayerStep(made.player.step + by);
  };
  dialog.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (target === jump) { if (e.key === "Enter") { e.preventDefault(); goTo(); } return; }
    // Space and Enter on a button press that button (Next has the focus when the player opens); anywhere else
    // in the player they advance, like the right arrow
    const onButton = target.tagName === "BUTTON";
    if (e.key === "ArrowRight" || ((e.key === " " || e.key === "Enter") && !onButton)) { e.preventDefault(); move(1); }
    else if (e.key === "ArrowLeft" || e.key === "Backspace") { e.preventDefault(); move(-1); }
  });
  dialog.addEventListener("close", () => { speaker.stop(); spokenAt = -1; ctl.setView({ player: false }); });

  function drawMap(s: AppState, position: number): void {
    const made = s.made;
    if (!made?.result || !plan) return;
    // every pin of the piece: the frame's and, when it has them, those inside the picture (its result's own)
    const css = 280, dpr = fitCanvas(map, css), ctx = map.getContext("2d")!, res = 1000, layout = { pins: made.frame.pins, res, ...frameSpec(made.frame), inside: made.result.inside };
    const P = framePins(layout), k = (css * dpr) / res * 0.94, off = css * dpr * 0.03, F = made.frame.pins, M = insideCount(layout);
    const at = (pinIndex: number): [number, number] => [off + P[2 * pinIndex]! * k, off + P[2 * pinIndex + 1]! * k];
    ctx.clearRect(0, 0, map.width, map.height);
    ctx.strokeStyle = themeColour("--line-strong");
    ctx.lineWidth = dpr;
    ctx.beginPath();
    if (made.frame.shape === "rect") {
      const b = frameBounds(layout);
      ctx.rect(off + b.x0 * k, off + b.y0 * k, (b.x1 - b.x0) * k, (b.y1 - b.y0) * k);
    } else ctx.arc(off + (res - 1) / 2 * k, off + (res - 1) / 2 * k, (res - 1) / 2 * k, 0, 2 * Math.PI);
    ctx.stroke();
    // the pins inside the picture, small: where the next one is among them is what the map is for
    ctx.fillStyle = themeColour("--muted");
    for (let j = 0; j < M; j++) {
      const [x, y] = at(F + j);
      ctx.beginPath();
      ctx.arc(x, y, 1.1 * dpr, 0, 2 * Math.PI);
      ctx.fill();
    }
    // the last lines wound of the thread in hand, fading, then the line to wind now
    const current = plan.steps[Math.min(position, plan.steps.length - 1)];
    const from = Math.max(current ? plan.threads[current.thread]!.start : 0, position - 12);
    for (let i = from; i < position; i++) {
      const st = plan.steps[i]!;
      if (st.round) continue; // round the frame: no line across the picture
      ctx.globalAlpha = 0.12 + 0.5 * ((i - from + 1) / (position - from + 1));
      ctx.strokeStyle = themeColour("--muted");
      ctx.beginPath();
      ctx.moveTo(...at(st.from));
      ctx.lineTo(...at(st.to));
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    const now = plan.steps[position];
    if (!now) return;
    ctx.strokeStyle = themeColour("--text");
    ctx.lineWidth = 2.5 * dpr;
    ctx.beginPath();
    if (now.round) {
      // the thread leaves the picture here and comes back at the dot: a ring on the pin it leaves from
      const [fx, fy] = at(now.from);
      ctx.arc(fx, fy, 5 * dpr, 0, 2 * Math.PI);
    } else {
      ctx.moveTo(...at(now.from));
      ctx.lineTo(...at(now.to));
    }
    ctx.stroke();
    const [x, y] = at(now.to);
    ctx.fillStyle = themeColour("--text");
    ctx.beginPath();
    ctx.arc(x, y, 5 * dpr, 0, 2 * Math.PI);
    ctx.fill();
  }

  /** The close-up: NEAR_MM of the piece around the next pin, every pin in it with its number. Only a piece
   * with pins inside the picture has it. */
  function drawNear(s: AppState, position: number): void {
    const made = s.made, pinned = !!made?.result?.inside?.length;
    near.hidden = nearLabel.hidden = !pinned;
    if (!made?.result || !plan || !pinned) return;
    const now = plan.steps[Math.min(position, plan.steps.length - 1)];
    if (!now) return;
    const dpr = fitCanvas(near, NEAR_PX), ctx = near.getContext("2d")!, mm = made.frame.diameterMm, F = made.frame.pins;
    const P = unitAll({ pins: F, ...frameSpec(made.frame), inside: made.result.inside });
    const k = (NEAR_PX * dpr) / NEAR_MM, cx = P[2 * now.to]! * mm, cy = P[2 * now.to + 1]! * mm, half = NEAR_MM / 2;
    const at = (pinIndex: number): [number, number] => [(P[2 * pinIndex]! * mm - cx + half) * k, (P[2 * pinIndex + 1]! * mm - cy + half) * k];
    ctx.clearRect(0, 0, near.width, near.height);
    if (!now.round && position < plan.steps.length) {
      ctx.strokeStyle = themeColour("--text");
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(...at(now.from));
      ctx.lineTo(...at(now.to));
      ctx.stroke();
    }
    ctx.font = `${10 * dpr}px system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    for (let i = 0; i < P.length / 2; i++) {
      const [x, y] = at(i);
      if (x < -20 * dpr || y < -20 * dpr || x > near.width + 20 * dpr || y > near.height + 20 * dpr) continue;
      const next = i === now.to;
      ctx.fillStyle = themeColour(next ? "--text" : "--muted");
      ctx.beginPath();
      ctx.arc(x, y, (next ? 5 : 2) * dpr, 0, 2 * Math.PI);
      ctx.fill();
      if (!next) ctx.fillText(String(i + 1), x + 4 * dpr, y);
    }
  }

  function sync(s: AppState): void {
    const made = s.made;
    if (!made?.result) { if (dialog.open) dialog.close(); return; }
    if (planOf !== made.result) { plan = buildPlan(made.result.sequences, made.frame.pins); planOf = made.result; }
    if (!dialog.open || !plan) return;
    const v = viewAt(plan, made.player.step), thread = made.threads[v.thread];
    const hex = thread?.hex ?? "#111111";
    swatch.style.setProperty("background", hex);
    threadName.textContent = thread?.name ?? "";
    threadCount.textContent = made.threads.length > 1
      ? t("player.threadOf", { k: v.thread + 1, K: made.threads.length, step: v.step, steps: v.steps })
      : t("player.stepOf", { step: v.step, steps: v.steps });
    // §9: the thread's colour is the accent, unless it would not show against the page
    const accent = accentFor(hex, themeHex("--panel"));
    if (accent) { dialog.style.setProperty("--accent", accent); dialog.style.setProperty("--accent-text", textOn(accent)); }
    else { dialog.style.removeProperty("--accent"); dialog.style.removeProperty("--accent-text"); }
    label.hidden = v.done;
    pin.textContent = v.done ? t("player.done") : String(v.nextPin);
    pin.classList.toggle("done", v.done);
    const where = v.done ? null : whereIs(made.frame, v.nextPin - 1, made.result.inside);
    clock.textContent = !where ? ""
      : where.at === "inside" ? t("player.insideAt", { x: where.left, y: where.top })
      : where.at === "side" ? t(SIDE_TEXT[where.side], { n: where.n, of: where.of })
      : t("player.clock", { clock: where.clock });
    // a step round the frame says which way round is the shorter
    const clockwise = v.round && aroundFrame({ pins: made.frame.pins, ...frameSpec(made.frame) }, v.fromPin - 1, v.nextPin - 1).clockwise;
    note.textContent = v.done ? t("player.tieOff")
      : v.tieOn ? (v.thread > 0 ? t("player.changeThread", { pin: v.fromPin, name: thread?.name ?? "" }) : t("player.tieOn", { pin: v.fromPin }))
      : v.round ? (clockwise ? t("player.roundCw", { pin: v.fromPin }) : t("player.roundCcw", { pin: v.fromPin }))
      : t("player.from", { pin: v.fromPin });
    then.textContent = v.thenPin ? t("player.then", { pin: v.thenPin }) : "";
    bar.value = v.total ? v.position / v.total : 0;
    const left = hoursMinutes(remainingSeconds(plan, v.position, made.player.secondsPerLine));
    status.textContent = t("player.status", { n: v.position, total: v.total, h: left.h, min: left.min });
    back.disabled = v.position === 0;
    forward.disabled = v.done;
    jump.max = String(v.steps);
    if (document.activeElement !== jump) jump.value = String(v.step);
    prevThread.hidden = nextThread.hidden = made.threads.length < 2;
    prevThread.disabled = neighbourThread(plan, v.thread, -1) < 0;
    nextThread.disabled = neighbourThread(plan, v.thread, 1) < 0;
    // the voice: offered only when the device has one of its own for the page's language
    const lang = getLang(), canSpeak = speaker.available(lang);
    voice.input.disabled = !canSpeak;
    voice.set(voiceOn && canSpeak);
    voiceNote.hidden = canSpeak;
    if (voiceOn && canSpeak && spokenAt !== v.position) speaker.say(phrase(v, thread?.name ?? ""), lang);
    spokenAt = v.position;
    drawMap(s, v.position);
    drawNear(s, v.position);
  }

  return {
    open() {
      if (!ctl.state.made?.result) return;
      if (!dialog.open) dialog.showModal();
      ctl.setView({ player: true });
      forward.focus();
      sync(ctl.state);
    },
    sync,
  };
}
