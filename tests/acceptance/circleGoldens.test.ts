// What the round frame produced before any other frame existed, pinned by hash: a saved project's text and
// keys (a stored result is recognised by its key), the winding instructions, the nail template and the lines,
// for three made-up pieces. Adding a frame shape must not move any of them (DECISIONS D-58).
import { describe, expect, it } from "vitest";
import { instructionsCsv, instructionsTxt, materials, threadPlans } from "../../src/core/instructions.ts";
import { defaultProject, generationKey, serializeProject, targetKey, toOptions } from "../../src/core/project.ts";
import { templateDxf } from "../../src/export/dxf.ts";
import { linesSvg, templateSvg } from "../../src/export/svg.ts";
import { templateDrawing } from "../../src/render/template.ts";
import { sha256 } from "../helpers/hash.ts";
import { colourProject, madeUpProject } from "../helpers/pdf.ts";

describe("the round frame's outputs are what they were", () => {
  const d = defaultProject(), mono = madeUpProject([300], undefined, 7), colour = colourProject([120, 80, 0, 60], 5);
  const small = madeUpProject([40], (p) => { p.frame.diameterMm = 240; p.frame.pins = 127; p.frame.pinDiameterMm = 2.5; p.generator.minSkip = 9; }, 3);

  it("the default project: its text, its two keys and its options", () => {
    expect({ text: sha256(serializeProject(d)), target: sha256(targetKey(d)), generation: sha256(generationKey(d)), options: sha256(toOptions(d)) }).toEqual({
      text: "5bcd7b21eb198c603250cd2c1c50f105fcfa6cad48f9de15617c1a563b522e6d",
      target: "8291e1514716ba2e46219ec3ec27bb99d88500f1b112d555e57dd02ffa890b86",
      generation: "ea44d2963923c40bdd470580463d4b1ed325ebc56f2840b9675aef675f91d4af",
      options: "65af70c215920891265dc805682b9bdec840449922b70cf6dd2e5fae636c8883",
    });
  });

  it("256 pins, one thread: project text, instructions, materials, template and lines", () => {
    expect({
      text: sha256(serializeProject(mono)), csv: sha256(instructionsCsv(mono)), txtEn: sha256(instructionsTxt(mono, "en")), txtZh: sha256(instructionsTxt(mono, "zh-TW")),
      materials: sha256(materials(mono)), lengths: sha256(threadPlans(mono).map((t) => t.lengthMm)),
      drawing: sha256(templateDrawing(mono.frame)), svg: sha256(templateSvg(mono.frame)), dxf: sha256(templateDxf(mono.frame)), lines: sha256(linesSvg(mono)),
    }).toEqual({
      text: "78aad8a0cbe08836b622e86bef651cf2ab758811519c195c7044223638ea9922",
      csv: "3f48067774ef11c61c9d0f2d2fac2500c76d6c88f72862f5f7188453e78a63b9",
      txtEn: "aba8a45b8d70ebf47bef16fc343f4985e3fa60d137e1d86b840a261fd5540286",
      txtZh: "919970ed30356145f4a0d9fb89027faa42f81a0a76662e2287144e7fd158446e",
      materials: "75b55c73a820073bf7cf6db4a5fc5a1a451bb3d9207d24261d32426029270b72",
      lengths: "709c5d1a56d1546b32002c0488c488b559de48309c1c4947e2f2c97bb8726e26",
      drawing: "0108dd241a35ef83e33a0ad3a5b3e6f955d353b0b8131a95eea5beb4af3b1274",
      svg: "b63c2619f4fa64ef50dd87d8a3121333bf0b2b2764a347794104a8fb1800c47d",
      dxf: "0b51a800bc590a6c4d67d7bfaf4cbfaf63de23cacc83ed3d835950db534c642c",
      lines: "ff85efe1bacbee56e89188da71a8b8d5f7e4c3b1153502e05704d3b886a12137",
    });
  });

  it("200 pins, four threads of which one is empty", () => {
    expect({
      text: sha256(serializeProject(colour)), csv: sha256(instructionsCsv(colour)), txtEn: sha256(instructionsTxt(colour, "en")),
      materials: sha256(materials(colour)), lines: sha256(linesSvg(colour)),
    }).toEqual({
      text: "7b0a983b8cd6f148ac5eb9a9e4edaaf6815546b8fcff5debccde14397c8b90ba",
      csv: "f8b1579cc50a7f8e6e89e1611f46a979a067aa54539c61f528932f70d753a9ea",
      txtEn: "e9adf827e5265180265b0d32ec4c98e3c886419158d53e5a76612ecc3e698e94",
      materials: "6987c59fbaeef2edb1911f3561007a24a8d77d1b7d9ae03be9822d6a0897936f",
      lines: "7161907e45781339b82e606970c5d905b7e3478d5c02a54298e6d8b78d679711",
    });
  });

  it("127 thick pins on a 240 mm frame", () => {
    expect({
      txtZh: sha256(instructionsTxt(small, "zh-TW")), drawing: sha256(templateDrawing(small.frame)), svg: sha256(templateSvg(small.frame)),
      dxf: sha256(templateDxf(small.frame)), lines: sha256(linesSvg(small)),
    }).toEqual({
      txtZh: "8959362787ed25184c0643b2ba13ed2358726499ac5238adea90a0f4f30e9339",
      drawing: "73a5c236dbb220b64b44c1edb098b92e6779c8106f30eaaaad0403b84528b68b",
      svg: "0e41718947a579eba2feaacae9fed62dc74316c0eeda751b0b6c43bc5e7599dd",
      dxf: "8a9bd2e776c8557eaad7464126700c9ba62137c79c2eb2fb4a409234fa30c571",
      lines: "611593439cafb1b7505fe63018e7ba90a219cf88d9751a24429b5ee72af472c4",
    });
  });
});
