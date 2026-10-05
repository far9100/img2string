// Winding instructions and materials (spec §7.3, §7.5): clock hints, rows of ten, thread lengths, the CSV and
// the plain-text sheet, and what a project without a result gives.
import { describe, expect, it } from "vitest";
import {
  breakLines, clockHint, displayWidth, instructionsCsv, instructionsTxt, materials, metres, sequenceRows, sheetTexts, threadLabel, threadPlans,
} from "../../src/core/instructions.ts";
import { defaultProject, normalizeProject, serializeProject } from "../../src/core/project.ts";
import { colourProject, madeUpProject } from "../helpers/pdf.ts";

/** Minutes past 12:00 of a hint. */
const minutes = (hint: string): number => {
  const [h, m] = hint.split(":").map(Number) as [number, number];
  return (h % 12) * 60 + m;
};

describe("clock hints (§7.3)", () => {
  it("puts pin 1 at 12:00 and reads the spec's example, pin 137 of 256, as 6:25", () => {
    expect(clockHint(0, 256)).toBe("12:00");
    expect(clockHint(136, 256)).toBe("6:25"); // 136 / 256 of 12 h = 6:22.5, a half that rounds up
  });

  it("goes clockwise: a quarter of the pins is 3:00, half is 6:00, three quarters 9:00", () => {
    for (const pins of [64, 200, 256, 512]) {
      expect(clockHint(pins / 4, pins)).toBe("3:00");
      expect(clockHint(pins / 2, pins)).toBe("6:00");
      expect(clockHint((3 * pins) / 4, pins)).toBe("9:00");
    }
  });

  it("rounds up into the next hour, and past the top to 12:00, never to x:60", () => {
    expect(clockHint(127, 512)).toBe("3:00"); // 2:58.6
    expect(clockHint(511, 512)).toBe("12:00"); // 11:59.3
    expect(clockHint(255, 256)).toBe("11:55"); // 11:57.2 rounds down
    for (const pins of [64, 97, 100, 200, 256, 360, 511, 512]) {
      for (let pin = 0; pin < pins; pin++) expect(clockHint(pin, pins), `${pin} of ${pins}`).toMatch(/^(?:[1-9]|1[0-2]):(?:[0-5][05])$/);
    }
  });

  it("is never more than two and a half minutes from where the pin is", () => {
    for (const pins of [64, 97, 200, 256, 512]) {
      for (let pin = 0; pin < pins; pin++) {
        const exact = (pin / pins) * 720, off = Math.abs(minutes(clockHint(pin, pins)) - exact);
        expect(Math.min(off, 720 - off), `${pin} of ${pins}`).toBeLessThanOrEqual(2.5 + 1e-9);
      }
    }
  });
});

describe("the sequence in rows (§7.3)", () => {
  const sequence = Array.from({ length: 25 }, (_, i) => (i * 37) % 256);

  it("makes rows of ten pins, numbered from 1, each with the number of its first step", () => {
    const rows = sequenceRows(sequence, 256);
    expect(rows.map((r) => r.index)).toEqual([1, 11, 21]);
    expect(rows.map((r) => r.pins.length)).toEqual([10, 10, 5]);
    expect(rows.flatMap((r) => r.pins)).toEqual(sequence.map((pin) => pin + 1));
  });

  it("gives every row the clock position of its first pin", () => {
    const rows = sequenceRows(sequence, 256);
    expect(rows.map((r) => r.clock)).toEqual([clockHint(sequence[0]!, 256), clockHint(sequence[10]!, 256), clockHint(sequence[20]!, 256)]);
    expect(rows[0]!.clock).toBe("12:00");
  });

  it("takes another row length, and an empty sequence has no rows", () => {
    expect(sequenceRows(sequence, 256, 4).map((r) => r.index)).toEqual([1, 5, 9, 13, 17, 21, 25]);
    expect(sequenceRows([], 256)).toEqual([]);
  });
});

describe("thread plans and materials (§7.5)", () => {
  // two lines on the default frame (500 mm, 256 pins, 1.5 mm pins): top to bottom, then to the right
  const twoLines = () => {
    const p = defaultProject();
    p.result = { key: "", sequences: [[0, 128, 64]], lines: [2], errorReduction: 0, meanDeltaEOk: 0, reason: "stopped" };
    return p;
  };
  // by hand: a diameter (500), a quarter-circle chord (500 sin 45 deg = 353.553), half a pin's
  // circumference at each of the two pins reached (2 x pi x 1.5 / 2 = 4.712), plus 5 %
  const BY_HAND = (500 + 353.5533905932738 + 4.71238898038469) * 1.05;

  it("measures a thread as its chords, half a pin circumference per visit, and 5 % more", () => {
    const [plan] = threadPlans(twoLines());
    expect(BY_HAND).toBeCloseTo(901.179, 3);
    expect(plan!.lengthMm).toBeCloseTo(BY_HAND, 9);
    expect(plan).toMatchObject({ index: 0, name: "black", hex: "#111111", lines: 2, startPin: 0, endPin: 64 });
    expect(plan!.sequence).toEqual([0, 128, 64]);
  });

  it("lists the materials: thread per colour, nails, board and winding time", () => {
    const m = materials(twoLines());
    expect(m.threads).toHaveLength(1);
    expect(m.threads[0]).toMatchObject({ name: "black", hex: "#111111", lines: 2 });
    expect(m.threads[0]!.lengthM).toBeCloseTo(BY_HAND / 1000, 12);
    expect(m.totalLines).toBe(2);
    expect(m.totalLengthM).toBeCloseTo(BY_HAND / 1000, 12);
    expect(m.nails).toBe(256);
    expect(m.boardMm).toBe(540); // D + 40
    expect(m.windingSeconds).toBe(16); // 2 lines at the default 8 s
  });

  it("adds the threads up and follows the seconds per line", () => {
    const p = colourProject([1500, 1379, 536, 606]);
    p.player.secondsPerLine = 5;
    const m = materials(p), plans = threadPlans(p);
    expect(m.threads.map((t) => t.lines)).toEqual([1500, 1379, 536, 606]);
    expect(m.totalLines).toBe(4021);
    expect(m.totalLengthM).toBeCloseTo(plans.reduce((sum, plan) => sum + plan.lengthMm, 0) / 1000, 9);
    expect(m.windingSeconds).toBe(4021 * 5);
    expect(m.nails).toBe(200);
    expect(plans.map((plan) => plan.index)).toEqual([0, 1, 2, 3]);
    for (const plan of plans) expect(plan.lengthMm / plan.lines).toBeGreaterThan(100); // chords average well over 100 mm
  });

  it("suggests 25 mm nails for pins up to 2 mm and 30 mm for thicker ones", () => {
    const p = defaultProject();
    expect(materials(p).nailLengthMm).toBe(25);
    p.frame.pinDiameterMm = 2;
    expect(materials(p).nailLengthMm).toBe(25);
    p.frame.pinDiameterMm = 2.5;
    expect(materials(p).nailLengthMm).toBe(30);
  });

  it("gives a thread without lines no start or end pin", () => {
    const [first, second] = threadPlans(colourProject([0, 40, 0, 12]));
    expect(first).toMatchObject({ lines: 0, startPin: -1, endPin: -1, lengthMm: 0 });
    expect(second!.lines).toBe(40);
    expect(second!.startPin).toBe(second!.sequence[0]);
    expect(second!.endPin).toBe(second!.sequence[40]);
  });

  it("rounds thread to buy up to whole metres", () => {
    expect([0, 1, 999, 1000, 1001, 614_600].map(metres)).toEqual([0, 1, 1, 1, 2, 615]);
  });
});

describe("the test project", () => {
  it("is one the project model accepts: every step respects the minimum skip", () => {
    for (const p of [madeUpProject([4000]), colourProject()]) {
      const back = normalizeProject(JSON.parse(serializeProject(p)));
      expect(back.issues).toEqual([]);
      expect(back.project.result?.sequences).toEqual(p.result!.sequences);
    }
  });
});

describe("CSV (§7.3)", () => {
  it("has a header and one line per step: thread, name, colour, step, pin from 1, clock", () => {
    const p = colourProject([3, 0, 2, 1]);
    const csv = instructionsCsv(p);
    expect(csv.endsWith("\r\n")).toBe(true);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("thread,name,hex,step,pin,clock");
    const rows = lines.slice(1).map((line) => line.split(","));
    expect(rows).toHaveLength(4 + 0 + 3 + 2); // a thread of n lines visits n + 1 pins
    for (const row of rows) expect(row).toHaveLength(6);
    const s = p.result!.sequences;
    expect(rows[0]).toEqual(["1", "yellow", "#FFE000", "1", String(s[0]![0]! + 1), clockHint(s[0]![0]!, 200)]);
    expect(rows[3]).toEqual(["1", "yellow", "#FFE000", "4", String(s[0]![3]! + 1), clockHint(s[0]![3]!, 200)]);
    expect(rows[4]!.slice(0, 4)).toEqual(["3", "magenta", "#E0007A", "1"]); // the unwound thread 2 has no lines
    expect(rows.map((r) => Number(r[4]))).toEqual([...s[0]!, ...s[2]!, ...s[3]!].map((pin) => pin + 1));
    for (const row of rows) expect(Number(row[4])).toBeGreaterThanOrEqual(1);
  });

  it("quotes names that need it and keeps a name from running as a formula", () => {
    const p = madeUpProject([1]);
    p.threads[0]!.name = 'deep "navy", wool';
    expect(instructionsCsv(p).split("\r\n")[1]).toMatch(/^1,"deep ""navy"", wool",#111111,1,\d+,\d+:\d\d$/);
    p.threads[0]!.name = "=HYPERLINK(1)";
    expect(instructionsCsv(p).split("\r\n")[1]).toMatch(/^1,'=HYPERLINK\(1\),#111111,1,/);
  });
});

describe("the sheet's texts and the plain-text file (§7.3)", () => {
  it("say the same in both languages: title, materials, a section per thread, rows of ten", () => {
    const p = colourProject([25, 0, 12, 31]);
    for (const lang of ["en", "zh-TW"] as const) {
      const s = sheetTexts(p, lang), txt = instructionsTxt(p, lang);
      expect(txt.startsWith(`${s.title}\r\n`)).toBe(true);
      // long paragraphs are broken into lines: compared without the white space
      const dense = (text: string) => text.replace(/\s+/g, "");
      for (const text of [s.subtitle, s.howTitle, s.how, s.materialsTitle, ...s.notes, ...s.sections.flatMap((x) => [x.title, x.facts])]) expect(dense(txt), text).toContain(dense(text));
      expect(s.sections).toHaveLength(4);
      expect(s.rows.map((r) => r.lines)).toEqual(["25", "0", "12", "31"]);
      expect(s.total).toMatchObject({ lines: "68" });
      // 26 + 13 + 32 pins in rows of ten: 3 + 2 + 4 rows, each with a box to tick
      const rows = txt.split("\r\n").filter((line) => line.startsWith("[ ]"));
      expect(rows).toHaveLength(9);
      expect(rows[0]).toMatch(/^\[ \] +1 +(?: *\d+){10} +\d+:\d\d$/);
      expect(rows[1]).toMatch(/^\[ \] +11 /);
      const printed = rows.flatMap((line) => line.slice(3).trim().split(/\s+/).slice(1, -1).map(Number));
      expect(printed).toEqual([0, 2, 3].flatMap((k) => p.result!.sequences[k]!).map((pin) => pin + 1));
      for (const line of txt.split("\r\n")) expect(displayWidth(line), line).toBeLessThanOrEqual(78);
    }
  });

  it("give the start, the end and the length of each thread, and say so when a thread has no lines", () => {
    const p = colourProject([25, 0, 12, 31]);
    const s = sheetTexts(p, "en"), [first, empty] = s.sections;
    const seq = p.result!.sequences[0]!;
    expect(first!.title).toBe("Thread 1 of 4 · yellow (#FFE000)");
    expect(first!.facts).toContain(`Start: pin ${seq[0]! + 1} (${clockHint(seq[0]!, 200)})`);
    expect(first!.facts).toContain(`End: pin ${seq[25]! + 1} (${clockHint(seq[25]!, 200)})`);
    expect(first!.facts).toContain("Lines: 25");
    expect(first!.facts).toContain(`Thread: ${metres(threadPlans(p)[0]!.lengthMm)} m`);
    expect(first!.rows).toHaveLength(3);
    expect(empty!.rows).toEqual([]);
    expect(empty!.facts).toBe("This thread has no lines: skip it.");
    expect(s.notes[0]).toBe("Nails: 200, 1.5 mm thick and about 25 mm long.");
    expect(s.notes[1]).toContain("540 × 540 mm");
    expect(s.notes[3]).toBe("Thread lengths include a 5 % margin.");
  });

  it("show the winding time in hours and minutes, or minutes alone under an hour", () => {
    expect(sheetTexts(madeUpProject([4000]), "en").notes[2]).toBe("Winding time: about 8 h 53 min, at 8 s per line."); // 32,000 s
    expect(sheetTexts(madeUpProject([300]), "en").notes[2]).toBe("Winding time: about 40 min, at 8 s per line.");
  });

  it("name a thread by its colour code when the name is empty, the code itself, or cannot be printed", () => {
    expect(threadLabel("black", "#111111")).toBe("black (#111111)");
    expect(threadLabel("  ", "#111111")).toBe("#111111");
    expect(threadLabel("#111111", "#111111")).toBe("#111111");
    expect(threadLabel("black", "#111111", () => false)).toBe("#111111");
    const p = madeUpProject([5]);
    p.threads[0]!.name = "line\nbreak";
    expect(instructionsTxt(p, "en")).toContain("Thread 1 of 1 · #111111\r\n");
  });

  it("break paragraphs between words, and Chinese anywhere but before closing punctuation", () => {
    const narrow = (s: string) => displayWidth(s) <= 10;
    expect(breakLines("one two three four five", narrow)).toEqual(["one two", "three four", "five"]);
    // five ideographs, a full-width comma, five more: the comma stays with the line it closes
    const zh = "\u4e00\u4e8c\u4e09\u56db\u4e94\uff0c\u516d\u4e03\u516b\u4e5d\u5341";
    expect(breakLines(zh, narrow)).toEqual(["\u4e00\u4e8c\u4e09\u56db", "\u4e94\uff0c\u516d\u4e03\u516b", "\u4e5d\u5341"]);
    expect(displayWidth("ab\u4e00")).toBe(4);
  });
});

describe("a project without a result", () => {
  it("has no thread plans, but still knows its nails and board", () => {
    const p = defaultProject();
    expect(threadPlans(p)).toEqual([]);
    expect(materials(p)).toEqual({ threads: [], totalLines: 0, totalLengthM: 0, nails: 256, nailLengthMm: 25, boardMm: 540, windingSeconds: 0 });
  });

  it("has no instructions: they throw 'no-result'", () => {
    const p = defaultProject();
    expect(() => instructionsCsv(p)).toThrow(/^no-result$/);
    expect(() => instructionsTxt(p, "en")).toThrow(/^no-result$/);
    expect(() => sheetTexts(p, "zh-TW")).toThrow(/^no-result$/);
  });
});
