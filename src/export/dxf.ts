// The nail template as DXF (spec §7.2) for CNC or laser drilling: a small ASCII file in the R12 dialect,
// which every CAM program reads. Units are millimetres and y points UP, as DXF expects, with the origin at
// the board's bottom-left corner, so every coordinate is positive and the drawing is seen from the front:
// pin 1 at the top, numbers growing clockwise (drill from the front, or mirror it in the CAM program).
// Layers: PINS (one CIRCLE per pin, radius = pin diameter / 2), FRAME (the pin circle as a CIRCLE, or a
// rectangular frame's outline as one closed POLYLINE), MARKS (a centre cross of two LINEs) and BOARD (the
// board's outline as one closed POLYLINE).
import { frameSizeMm } from "../core/frame.ts";
import { BOARD_MARGIN_MM } from "../core/instructions.ts";
import type { Project } from "../core/project.ts";
import { boardSize, templatePins } from "../render/template.ts";

/** Layer names with their AutoCAD colour index, so a CAM program can tell them apart at a glance. */
export const DXF_LAYERS = { BOARD: 7, FRAME: 5, MARKS: 3, PINS: 1 } as const;
type Layer = keyof typeof DXF_LAYERS;

/** Half length of the centre cross (mm). */
const CENTRE_ARM = 6;
const f = (v: number): string => (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4);

export function templateDxf(frame: Project["frame"], inside?: ArrayLike<number>): string {
  const { width: W, height: H } = boardSize(frame), cx = W / 2, cy = H / 2;
  const out: (string | number)[] = [];
  const pair = (code: number, value: string | number) => out.push(code, value);

  // HEADER: the dialect, the units (4 = millimetres; R12 itself has no unit, newer readers use this) and the extents
  pair(0, "SECTION"); pair(2, "HEADER");
  pair(9, "$ACADVER"); pair(1, "AC1009");
  pair(9, "$INSUNITS"); pair(70, 4);
  pair(9, "$EXTMIN"); pair(10, f(0)); pair(20, f(0)); pair(30, f(0));
  pair(9, "$EXTMAX"); pair(10, f(W)); pair(20, f(H)); pair(30, f(0));
  pair(0, "ENDSEC");

  // TABLES: one line type and the layers (a layer must name a line type that exists)
  pair(0, "SECTION"); pair(2, "TABLES");
  pair(0, "TABLE"); pair(2, "LTYPE"); pair(70, 1);
  pair(0, "LTYPE"); pair(2, "CONTINUOUS"); pair(70, 0); pair(3, "Solid line"); pair(72, 65); pair(73, 0); pair(40, f(0));
  pair(0, "ENDTAB");
  const layers = Object.entries(DXF_LAYERS);
  pair(0, "TABLE"); pair(2, "LAYER"); pair(70, layers.length);
  for (const [name, colour] of layers) {
    pair(0, "LAYER"); pair(2, name); pair(70, 0); pair(62, colour); pair(6, "CONTINUOUS");
  }
  pair(0, "ENDTAB");
  pair(0, "ENDSEC");

  pair(0, "SECTION"); pair(2, "ENTITIES");
  const circle = (layer: Layer, x: number, y: number, r: number) => {
    pair(0, "CIRCLE"); pair(8, layer); pair(10, f(x)); pair(20, f(y)); pair(40, f(r));
  };
  const line = (layer: Layer, x0: number, y0: number, x1: number, y1: number) => {
    pair(0, "LINE"); pair(8, layer); pair(10, f(x0)); pair(20, f(y0)); pair(11, f(x1)); pair(21, f(y1));
  };
  const closed = (layer: Layer, corners: readonly (readonly [number, number])[]) => {
    pair(0, "POLYLINE"); pair(8, layer); pair(66, 1); pair(70, 1);
    for (const [x, y] of corners) {
      pair(0, "VERTEX"); pair(8, layer); pair(10, f(x)); pair(20, f(y));
    }
    pair(0, "SEQEND"); pair(8, layer);
  };
  // the board: one closed outline, so it can be cut out as it is
  closed("BOARD", [[0, 0], [W, 0], [W, H], [0, H]]);
  if (frame.shape === "rect") {
    const { width, height } = frameSizeMm(frame), M = BOARD_MARGIN_MM;
    closed("FRAME", [[M, M], [M + width, M], [M + width, M + height], [M, M + height]]);
  } else circle("FRAME", cx, cy, frame.diameterMm / 2);
  line("MARKS", cx - CENTRE_ARM, cy, cx + CENTRE_ARM, cy);
  line("MARKS", cx, cy - CENTRE_ARM, cx, cy + CENTRE_ARM);
  // the template's y points down: flipped about the board's height, pin 1 stays at the top. With `inside`, a
  // piece's pins inside the picture follow the frame's, in the order they are numbered.
  for (const [x, y] of templatePins(frame, inside)) circle("PINS", x, H - y, frame.pinDiameterMm / 2);
  pair(0, "ENDSEC");
  pair(0, "EOF");
  return out.join("\r\n") + "\r\n";
}
