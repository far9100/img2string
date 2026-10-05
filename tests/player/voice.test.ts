// Voice readout (§7.4): only voices that run on the device are ever chosen.
import { describe, expect, it } from "vitest";
import { chooseVoice, type VoiceLike } from "../../src/player/voice.ts";

const v = (name: string, lang: string, localService: boolean, isDefault = false): VoiceLike => ({ name, lang, localService, default: isDefault });

describe("chooseVoice", () => {
  // what Chrome on Windows 11 lists with the Taiwanese language pack installed
  const windows = [
    v("Microsoft David - English (United States)", "en-US", true, true),
    v("Microsoft Zira - English (United States)", "en-US", true),
    v("Microsoft Hanhan - Chinese (Traditional, Taiwan)", "zh-TW", true),
    v("Microsoft Tracy - Chinese (Traditional, Hong Kong SAR)", "zh-HK", true),
    v("Google US English", "en-US", false),
    v("Google 國語（臺灣）", "zh-TW", false),
  ];

  it("takes the on-device voice of the page's language", () => {
    expect(chooseVoice(windows, "zh-TW")?.name).toContain("Hanhan");
    expect(chooseVoice(windows, "en")?.name).toContain("David"); // the system default among equals
  });

  it("never takes a network voice, even when it is the only one for the language", () => {
    const onlyRemote = windows.filter((x) => !x.name.includes("Hanhan"));
    expect(chooseVoice(onlyRemote, "zh-TW")).toBeNull(); // Cantonese is not a substitute; the Google voice is remote
    expect(chooseVoice([v("Google US English", "en-US", false)], "en")).toBeNull();
    expect(chooseVoice([], "en")).toBeNull();
  });

  it("understands the other spellings of the language tags", () => {
    expect(chooseVoice([v("Mei-Jia", "zh_TW", true)], "zh-TW")?.name).toBe("Mei-Jia");
    expect(chooseVoice([v("x", "cmn-Hant-TW", true)], "zh-TW")?.name).toBe("x");
    expect(chooseVoice([v("Tingting", "zh-CN", true), v("Mei-Jia", "zh-TW", true)], "zh-TW")?.name).toBe("Mei-Jia");
    expect(chooseVoice([v("Tingting", "zh-CN", true)], "zh-TW")?.name).toBe("Tingting"); // Mandarin reads numbers alike
    expect(chooseVoice([v("Daniel", "en-GB", true), v("Karen", "en-AU", true)], "en")?.name).toBe("Daniel");
    expect(chooseVoice([v("Amélie", "fr-FR", true)], "en")).toBeNull();
  });
});
