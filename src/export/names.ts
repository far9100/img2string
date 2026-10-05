// File names of the downloads (spec §7.6).

/** Names Windows keeps for devices: "con.img2string.json" could not be saved there. */
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A safe file-name stem from the picture's name: its extension dropped, accents removed, and only ASCII
 * letters, digits, - and _ kept (at most 40). Falls back to "img2string". Ported from img2fold. */
export function stemOf(name: string | null | undefined): string {
  const base = (name ?? "").replace(/\.[^./\\]+$/, "");
  const clean = base
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "") // the accents NFKD split off: an accented "cafe" stays "cafe", not "cafe-"
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return clean && !RESERVED.test(clean) ? clean : "img2string";
}

export const FILE = {
  template: (stem: string, ext: "pdf" | "svg" | "dxf") => `${stem}-template.${ext}`,
  instructions: (stem: string, ext: "pdf" | "csv" | "txt") => `${stem}-instructions.${ext}`,
  lines: (stem: string) => `${stem}-lines.svg`,
  preview: (stem: string) => `${stem}-preview.png`,
  project: (stem: string) => `${stem}.img2string.json`,
};
