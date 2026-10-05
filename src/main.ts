// img2string: the page. Everything runs in this browser; the only files it loads are its own (spec §8).
import "./ui/styles.css";
import { Controller } from "./app/controller.ts";
import { accentFor, textOn } from "./core/palette.ts";
import { applyI18n, getLang, initialLang, onLangChange, setLang, t, type Lang } from "./i18n/i18n.ts";
import { mountPlayer } from "./player/view.ts";
import { mountCalibWizard } from "./ui/calibWizard.ts";
import { themeHex } from "./ui/canvasUtil.ts";
import { installInput, isFormField } from "./ui/input.ts";
import type { Sync } from "./ui/inputPanels.ts";
import { mountLayout } from "./ui/layout.ts";
import { toast } from "./ui/toast.ts";

function boot(): void {
  const langButtons = document.querySelectorAll<HTMLButtonElement>("[data-lang]");
  for (const button of langButtons) button.addEventListener("click", () => setLang(button.dataset.lang as Lang, true));

  const ctl = new Controller();
  ctl.notify = (key, vars, kind) => toast(key, vars ?? {}, kind ?? "");
  const app = document.getElementById("app")!;
  const player = mountPlayer(ctl), calib = mountCalibWizard(ctl);
  // §9: the interface takes on the colour of the thread, here the one wound last (it lies on top); when that
  // colour would not show against the page, the theme's own accent stays
  const accent: Sync = (s) => {
    const hex = s.project.threads[s.project.threads.length - 1]!.hex, colour = accentFor(hex, themeHex("--panel"));
    const root = document.documentElement.style;
    if (colour) { root.setProperty("--accent", colour); root.setProperty("--accent-text", textOn(colour)); }
    else { root.removeProperty("--accent"); root.removeProperty("--accent-text"); }
  };
  const layout = mountLayout(app, ctl, () => player.open(), () => calib.open(), [accent, (s) => player.sync(s)]);

  onLangChange(() => {
    for (const button of langButtons) button.setAttribute("aria-pressed", String(button.dataset.lang === getLang()));
    document.title = t("app.title");
    layout.sync();
  });
  setLang(initialLang());

  const overlay = document.getElementById("drop-overlay")!;
  overlay.dataset.i18n = "drop.hint";
  installInput(overlay, layout.picker, {
    image: (file) => void ctl.openFile(file),
    project: (file) => void file.text().then((text) => ctl.loadProject(text)),
  });
  layout.projectPicker.addEventListener("change", () => {
    const file = layout.projectPicker.files?.[0];
    layout.projectPicker.value = "";
    if (file) void file.text().then((text) => ctl.loadProject(text));
  });
  addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.isComposing || isFormField(e.target)) return;
    if (e.key.toLowerCase() === "o") {
      e.preventDefault();
      layout.picker.click();
    } else if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      layout.saveProject();
    }
  });

  ctl.store.watch((s) => s, () => layout.sync());
  ctl.applyPreset("mono-black"); // the default palette, with its thread named in the page's language
  ctl.loadShelf();
  void ctl.openSample("face");
  layout.sync();
  applyI18n(document);
  app.removeAttribute("aria-busy");
  // the end-to-end tests drive the page through its controller (never present without ?test)
  if (new URLSearchParams(location.search).has("test")) void import("./app/testHooks.ts").then((m) => m.installTestHooks(ctl));
}

boot();
