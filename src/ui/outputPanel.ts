// The right column, step 3 "Result & Make" (spec §7): downloads, the materials list, the winding player's
// launcher, and the project file.
import type { Controller } from "../app/controller.ts";
import { boardSizeMm, materials } from "../core/instructions.ts";
import { PAPERS, type Frame } from "../core/project.ts";
import type { ExportKind } from "../export/build.ts";
import { t } from "../i18n/i18n.ts";
import { hoursMinutes, stepAt } from "../player/player.ts";
import { button, checkField, download, h, numberField, selectField, tx } from "./dom.ts";
import type { Sync } from "./inputPanels.ts";
import { toast } from "./toast.ts";

export interface OutputPanel {
  saveProject(): void;
}

export function mountOutputPanel(root: HTMLElement, ctl: Controller, syncs: Sync[], pickProject: () => void, openPlayer: () => void): OutputPanel {
  const get = (kind: ExportKind) => async () => {
    const file = await ctl.exportFile(kind);
    if (file) download(new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.mime }), file.name);
  };
  const preview = async () => {
    const file = await ctl.exportPreview();
    if (file) download(new Blob([file.bytes as Uint8Array<ArrayBuffer>], { type: file.mime }), file.name);
  };
  const saveProject = () => {
    const { text, name, stale } = ctl.projectText();
    download(new Blob([text], { type: "application/json" }), name);
    toast(stale ? "project.savedStale" : "project.saved", { name });
  };

  const paper = selectField({ label: "out.paper", options: PAPERS.map((p) => ({ value: p, label: `paper.${p}` })), onChange: (v) => ctl.set(["paper"], v) });
  const templateButtons = [button("out.templatePdf", get("template-pdf"), "primary"), button("out.templateSvg", get("template-svg")), button("out.templateDxf", get("template-dxf"))];
  const pieceButtons = [
    button("out.instructionsPdf", get("instructions-pdf"), "primary"), button("out.instructionsCsv", get("instructions-csv")), button("out.instructionsTxt", get("instructions-txt")),
    button("out.previewPng", preview), button("out.linesSvg", get("lines-svg")),
  ];
  const needResult = h("p", { class: "hint", "data-i18n": "out.needResult", text: t("out.needResult") });
  // D-60: with pins inside the picture the template is the made piece's, so there is none before there is a piece
  const needPiece = h("p", { class: "hint", "data-i18n": "out.templateNeedsPiece", text: t("out.templateNeedsPiece") });

  const list = h("table", { class: "materials" });
  const seconds = numberField({ label: "player.secondsPerLine", unit: "s", min: 1, max: 120, step: 1, onCommit: (v) => ctl.setSecondsPerLine(v) });
  const play = button("player.start", openPlayer, "primary big");
  const embed = checkField({ label: "project.embed", onChange: (v) => void ctl.embedPicture(v) });

  root.append(
    h("section", { class: "group" },
      h("h2", { class: "step" }, h("span", { class: "step-no", text: "3" }), tx("step.make")),
      h("h3", { "data-i18n": "group.template", text: t("group.template") }),
      paper.el,
      h("div", { class: "stack" }, ...templateButtons),
      needPiece,
      tx("out.printHint", "hint"),
    ),
    h("section", { class: "group" },
      h("h3", { "data-i18n": "group.winding", text: t("group.winding") }),
      needResult,
      h("div", { class: "stack" }, play),
      h("div", { class: "stack" }, ...pieceButtons),
    ),
    h("section", { class: "group" }, h("h3", { "data-i18n": "group.materials", text: t("group.materials") }), list, seconds.el),
    h("section", { class: "group" },
      h("h3", { "data-i18n": "group.project", text: t("group.project") }),
      h("div", { class: "row wrap" }, button("project.save", saveProject), button("project.open", pickProject)),
      embed.el,
      tx("project.hint", "hint"),
    ),
  );

  /** The board a frame needs: "540 mm square", or both sides of a rectangular frame's. */
  const boardText = (frame: Frame): string => {
    const board = boardSizeMm(frame);
    return frame.shape === "rect" ? t("out.boardRect", { w: Math.round(board.width), h: Math.round(board.height) }) : t("out.boardValue", { mm: board.width });
  };

  syncs.push((s) => {
    const made = s.made, has = !!made?.result && made.result.lines.some((n) => n > 0), busy = s.busyExport;
    paper.set(s.project.paper);
    const noTemplate = ctl.templateOfPiece() && !made?.result;
    for (const b of templateButtons) b.disabled = busy || noTemplate;
    needPiece.hidden = !noTemplate;
    for (const b of pieceButtons) b.disabled = busy || !has;
    needResult.hidden = has;
    play.disabled = !has;
    // where the player would open, in the words of the printed instructions: the thread and its step
    const position = made?.player.step ?? 0, at = stepAt(made?.result?.lines ?? [], position);
    play.dataset.i18n = !has || position <= 0 ? "player.start" : at.done ? "player.reopen" : made!.threads.length > 1 ? "player.resumeThread" : "player.resume";
    play.textContent = t(play.dataset.i18n, { n: at.step, k: at.thread + 1 });
    seconds.set(s.project.player.secondsPerLine);
    embed.set(!!s.project.image.embedded);
    embed.input.disabled = !s.source || !!s.source.sample;

    const rows: HTMLElement[] = [];
    if (has) {
      const m = materials(made!);
      for (const th of m.threads) {
        const dot = h("span", { class: "dot" });
        dot.style.setProperty("background", th.hex);
        rows.push(h("tr", null, h("th", { scope: "row" }, dot, th.name), h("td", { text: t("out.lineCount", { n: th.lines }) }), h("td", { text: `${Math.ceil(th.lengthM)} m` })));
      }
      const time = hoursMinutes(m.windingSeconds);
      rows.push(
        h("tr", { class: "total" }, h("th", { scope: "row", text: t("out.total") }), h("td", { text: t("out.lineCount", { n: m.totalLines }) }), h("td", { text: `${Math.ceil(m.totalLengthM)} m` })),
        h("tr", null, h("th", { scope: "row", text: t("out.nails") }), h("td", { colspan: 2, text: t("out.nailsValue", { n: m.nails, mm: m.nailLengthMm }) })),
        // of a piece with pins inside the picture: how many of them stand where (D-60)
        ...(m.nails > made!.frame.pins ? [h("tr", null, h("td", { colspan: 3, class: "detail", text: t("out.nailsWhere", { frame: made!.frame.pins, inside: m.nails - made!.frame.pins }) }))] : []),
        h("tr", null, h("th", { scope: "row", text: t("out.board") }), h("td", { colspan: 2, text: boardText(made!.frame) })),
        h("tr", null, h("th", { scope: "row", text: t("out.time") }), h("td", { colspan: 2, text: t("out.timeValue", { h: time.h, min: time.min }) })),
      );
    } else {
      // no piece yet: what the board would take, the pins the picture has been given inside it among them (D-60)
      const frame = s.project.frame, inside = ctl.pinsFor(s.project, true).length >> 1;
      rows.push(
        h("tr", null, h("th", { scope: "row", text: t("out.nails") }), h("td", { colspan: 2, text: t("out.nailsValue", { n: frame.pins + inside, mm: frame.pinDiameterMm <= 2 ? 25 : 30 }) })),
        ...(inside ? [h("tr", null, h("td", { colspan: 3, class: "detail", text: t("out.nailsWhere", { frame: frame.pins, inside }) }))] : []),
        h("tr", null, h("th", { scope: "row", text: t("out.board") }), h("td", { colspan: 2, text: boardText(frame) })),
      );
    }
    list.replaceChildren(h("tbody", null, ...rows));
  });

  return { saveProject };
}
