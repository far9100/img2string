// Opening a picture (spec §6.1): drag and drop anywhere, the file picker (also Ctrl/Cmd+O) or pasting
// (Ctrl+V), ported from img2fold (originally line2func). PNG, JPG and WebP; a dropped .json file is read as a
// project.
import { toast } from "./toast.ts";

export const MAX_BYTES = 64 * 1024 * 1024;

export interface InputHandlers {
  image(file: File): void;
  project(file: File): void;
}

export function isFormField(el: EventTarget | null): boolean {
  return !!(el as Element | null)?.closest?.("input, select, textarea, [contenteditable='true'], [contenteditable='']");
}

const isProject = (f: File) => f.name.toLowerCase().endsWith(".json") || f.type === "application/json";
/** §6.1: PNG, JPG and WebP. */
export const isPicture = (f: File) => ["image/png", "image/jpeg", "image/webp"].includes(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name);

export function installInput(overlay: HTMLElement, picker: HTMLInputElement, handlers: InputHandlers): () => void {
  let dragTimer = 0;
  let internalDrag = false;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
  const hide = () => {
    clearTimeout(dragTimer);
    overlay.hidden = true;
  };
  const accept = (file: File) => {
    if (file.size > MAX_BYTES) {
      toast("error.tooLarge", { mb: MAX_BYTES / 1048576 }, "error");
      return;
    }
    if (isProject(file)) handlers.project(file);
    else if (isPicture(file)) handlers.image(file);
    else toast("error.notImage", { name: file.name }, "error");
  };
  const onDragStart = () => (internalDrag = true);
  const onDragEnd = () => (internalDrag = false);
  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (internalDrag || !hasFiles(e)) {
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
      return;
    }
    e.dataTransfer!.dropEffect = "copy";
    overlay.hidden = false;
    clearTimeout(dragTimer);
    dragTimer = window.setTimeout(hide, 150); // dragover repeats while the file is over the window
  };
  const onDragLeave = (e: DragEvent) => {
    if (e.relatedTarget === null) hide();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    hide();
    if (internalDrag || !e.dataTransfer) return;
    const dt = e.dataTransfer;
    const items = Array.from(dt.items || []).filter((item) => item.kind === "file");
    if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
      toast("error.folder", {}, "error");
      return;
    }
    const files = Array.from(dt.files || []);
    if (!files.length) {
      if (Array.from(dt.types || []).some((type) => type === "text/uri-list" || type === "text/html")) toast("error.noFile", {}, "error");
      return;
    }
    if (files.length > 1) toast("error.multiple", { n: files.length });
    accept(files[0]!);
  };
  const onPaste = (e: ClipboardEvent) => {
    if (isFormField(e.target)) return;
    const files = Array.from(e.clipboardData?.files || []).filter(isPicture);
    if (!files.length) return;
    e.preventDefault();
    accept(files[0]!);
  };
  const onPick = () => {
    const file = picker.files?.[0];
    picker.value = ""; // the same file can be chosen again
    if (file) accept(file);
  };
  addEventListener("dragstart", onDragStart);
  addEventListener("dragend", onDragEnd);
  addEventListener("dragover", onDragOver);
  addEventListener("dragleave", onDragLeave);
  addEventListener("drop", onDrop);
  addEventListener("paste", onPaste);
  picker.addEventListener("change", onPick);
  return () => {
    removeEventListener("dragstart", onDragStart);
    removeEventListener("dragend", onDragEnd);
    removeEventListener("dragover", onDragOver);
    removeEventListener("dragleave", onDragLeave);
    removeEventListener("drop", onDrop);
    removeEventListener("paste", onPaste);
    picker.removeEventListener("change", onPick);
  };
}
