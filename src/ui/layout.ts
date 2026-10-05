// The page's three areas (spec §8): steps 1 and 2 on the left, the canvas in the centre, step 3 on the right;
// one column on a phone. Each panel registers a "sync" closure; sync() runs them all with the current state.
import type { Controller } from "../app/controller.ts";
import type { AppState } from "../app/state.ts";
import { h } from "./dom.ts";
import { mountGeneratePanel, mountPalettePanel, mountPicturePanel, mountSettingsPanel, type Sync } from "./inputPanels.ts";
import { mountOutputPanel } from "./outputPanel.ts";
import { mountStage } from "./stage.ts";

export interface Layout {
  sync(): void;
  picker: HTMLInputElement;
  projectPicker: HTMLInputElement;
  saveProject(): void;
}

export function mountLayout(root: HTMLElement, ctl: Controller, openPlayer: () => void, calibrate: () => void, extra: Sync[] = []): Layout {
  // the accept list makes iOS hand over a JPEG where the photo is stored as HEIC, which only Safari can decode
  const picker = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true, id: "file-input" });
  const projectPicker = h("input", { type: "file", accept: ".json,application/json", hidden: true, id: "project-input" });
  const params = h("div", { class: "col params" }), views = h("div", { class: "col views" }), out = h("div", { class: "col export" });
  const syncs: Sync[] = [...extra];
  mountPicturePanel(params, ctl, syncs, () => picker.click());
  mountPalettePanel(params, ctl, syncs);
  mountSettingsPanel(params, ctl, syncs, calibrate);
  // Generate sits above the canvas, where it is always in view however long the settings column is
  mountGeneratePanel(views, ctl, syncs);
  mountStage(views, ctl, syncs);
  const output = mountOutputPanel(out, ctl, syncs, () => projectPicker.click(), openPlayer);
  root.replaceChildren(params, views, out, picker, projectPicker);
  return {
    sync() {
      const s: AppState = ctl.state;
      for (const fn of syncs) fn(s);
    },
    picker,
    projectPicker,
    saveProject: output.saveProject,
  };
}
