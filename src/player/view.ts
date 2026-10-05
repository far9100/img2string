// The winding player (spec §7.4): a full-window dialog with the next pin in large numerals in the colour of the
// thread being wound, previous and next, the keyboard (Space, Enter or right arrow to advance; left arrow or
// Backspace to go back), progress and the time left, and optionally the pin read aloud by a voice of the
// device. The position is kept by the controller (localStorage and the project file).
import type { Controller } from "../app/controller.ts";
import type { AppState } from "../app/state.ts";
import { accentFor, textOn } from "../core/palette.ts";
import { pinPositions } from "../core/stringart.ts";
import { getLang, t } from "../i18n/i18n.ts";
import { fitCanvas, themeColour, themeHex } from "../ui/canvasUtil.ts";
import { button, checkField, h, tx } from "../ui/dom.ts";
import { buildPlan, hoursMinutes, neighbourThread, positionOfStep, remainingSeconds, viewAt, type Plan, type View } from "./player.ts";
import { createSpeaker } from "./voice.ts";

/** Whether to read the pins aloud is remembered on this device (a device has voices or it has not). */
const VOICE_KEY = "img2string.voice";

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
      : String(v.nextPin);
  const dialog = h("dialog", { class: "player", "data-i18n-aria-label": "player.title" },
    h("header", { class: "player-head" }, h("div", { class: "player-colour" }, swatch, threadName, threadCount), close),
    h("div", { class: "player-body" },
      h("div", { class: "player-main" }, note, label, pin, clock, then),
      map,
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
    const css = 280, dpr = fitCanvas(map, css), ctx = map.getContext("2d")!, res = 1000, P = pinPositions(made.frame.pins, res), k = (css * dpr) / res * 0.94, off = css * dpr * 0.03;
    const at = (pinIndex: number): [number, number] => [off + P[2 * pinIndex]! * k, off + P[2 * pinIndex + 1]! * k];
    ctx.clearRect(0, 0, map.width, map.height);
    ctx.strokeStyle = themeColour("--line-strong");
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.arc(off + (res - 1) / 2 * k, off + (res - 1) / 2 * k, (res - 1) / 2 * k, 0, 2 * Math.PI);
    ctx.stroke();
    // the last lines wound of the thread in hand, fading, then the line to wind now
    const current = plan.steps[Math.min(position, plan.steps.length - 1)];
    const from = Math.max(current ? plan.threads[current.thread]!.start : 0, position - 12);
    for (let i = from; i < position; i++) {
      const st = plan.steps[i]!;
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
    ctx.moveTo(...at(now.from));
    ctx.lineTo(...at(now.to));
    ctx.stroke();
    const [x, y] = at(now.to);
    ctx.fillStyle = themeColour("--text");
    ctx.beginPath();
    ctx.arc(x, y, 5 * dpr, 0, 2 * Math.PI);
    ctx.fill();
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
    clock.textContent = v.done ? "" : t("player.clock", { clock: v.nextClock });
    note.textContent = v.done ? t("player.tieOff") : v.tieOn ? (v.thread > 0 ? t("player.changeThread", { pin: v.fromPin, name: thread?.name ?? "" }) : t("player.tieOn", { pin: v.fromPin })) : t("player.from", { pin: v.fromPin });
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
