// Reading the next pin aloud (spec §7.4, M2), with voices that run on the device only, so that nothing is sent
// over the network (§16.4). Choosing a voice is a pure function; speaking goes through speechSynthesis.
//
// What `localService` is worth (DECISIONS D-46): on desktop browsers it separates the system's voices from the
// browser's network voices (Chrome's "Google" voices and Edge's "Online (Natural)" voices report false). On
// Android every voice reports true, whatever the engine does, so there the promise cannot be checked; the
// feature is off by default everywhere.
import type { Lang } from "../i18n/translate.ts";

export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

const tag = (lang: string) => lang.replace(/_/g, "-").toLowerCase();

/** How well a voice's language suits the page language: 3 exact region, 2 same script or language, 0 no. */
function suits(voiceLang: string, lang: Lang): number {
  const v = tag(voiceLang);
  if (lang === "en") return v === "en-us" || v === "en-gb" ? 3 : v === "en" || v.startsWith("en-") ? 2 : 0;
  // Traditional Chinese as spoken in Taiwan; "cmn-hant-tw" is how some engines spell it. Mandarin of another
  // region reads numbers the same way, so it is second choice; Cantonese (zh-HK, yue) is not offered.
  if (v === "zh-tw" || v === "cmn-hant-tw" || v === "zh-hant-tw") return 3;
  return v === "zh" || v === "zh-cn" || v === "cmn-hans-cn" || v === "zh-hans-cn" || v === "cmn-tw" ? 2 : 0;
}

/** The best on-device voice for the language, or null: only voices with localService === true are considered. */
export function chooseVoice<V extends VoiceLike>(voices: readonly V[], lang: Lang): V | null {
  let best: V | null = null, bestScore = 0;
  for (const v of voices) {
    if (v.localService !== true) continue;
    const score = 10 * suits(v.lang, lang) + (v.default ? 1 : 0);
    if (score >= 10 && score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}

export interface Speaker {
  /** True when an on-device voice for the language exists right now. */
  available(lang: Lang): boolean;
  /** Says the text, replacing anything still being said. */
  say(text: string, lang: Lang): void;
  stop(): void;
  /** Calls back when the browser's list of voices arrives or changes (it loads asynchronously). */
  onChange(cb: () => void): void;
}

/** The browser's speech synthesis, limited to on-device voices. */
export function createSpeaker(): Speaker {
  const synth: SpeechSynthesis | undefined = typeof speechSynthesis === "undefined" ? undefined : speechSynthesis;
  const voices = () => (synth ? synth.getVoices() : []);
  return {
    available: (lang) => chooseVoice(voices(), lang) !== null,
    say(text, lang) {
      const voice = chooseVoice(voices(), lang);
      if (!synth || !voice) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 1;
      synth.speak(u);
    },
    stop: () => synth?.cancel(),
    onChange(cb) {
      synth?.addEventListener?.("voiceschanged", cb);
    },
  };
}
