// img2string: the page. Everything runs in this browser; the only files it loads are its own (spec §8).
import "./ui/styles.css";
import { applyI18n, getLang, initialLang, onLangChange, setLang, t, type Lang } from "./i18n/i18n.ts";

function boot(): void {
  const langButtons = document.querySelectorAll<HTMLButtonElement>("[data-lang]");
  for (const button of langButtons) button.addEventListener("click", () => setLang(button.dataset.lang as Lang, true));
  onLangChange(() => {
    for (const button of langButtons) button.setAttribute("aria-pressed", String(button.dataset.lang === getLang()));
    document.title = t("app.title");
  });
  setLang(initialLang());

  const app = document.getElementById("app")!;
  const note = app.querySelector<HTMLElement>(".loading");
  if (note) note.dataset.i18n = "shell.core";
  applyI18n(document);
  app.removeAttribute("aria-busy");
}

boot();
