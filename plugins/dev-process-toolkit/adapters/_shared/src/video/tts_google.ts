// STE-664 — Google Cloud TTS adapter (SSML marks + time-pointing).

import {
  GOOGLE_TTS,
  persistSegment,
  postJson,
  type ProviderOpts,
  type SynthesisResult,
  type TtsProvider,
  type WordTiming,
} from "./tts";

const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const PAUSE_BREAK = '<break time="400ms"/>';

export function createGoogleTts(opts: ProviderOpts): TtsProvider {
  return {
    async synthesize(segment): Promise<SynthesisResult> {
      // `[short pause]` is a pause cue, not a word: it becomes an SSML break.
      // Any other square-bracket audio tag (`[laughs]`) is ElevenLabs-only: drop it.
      const tokens = segment.text
        .replace(/\[(?!short pause\])[^\]]*\]/g, " ")
        .split(/\s+/)
        .filter((w) => w !== "");
      const words: string[] = [];
      const parts: string[] = [];
      for (let t = 0; t < tokens.length; t++) {
        if (tokens[t] === "[short" && tokens[t + 1] === "pause]") {
          parts.push(PAUSE_BREAK);
          t++;
          continue;
        }
        parts.push(`<mark name="w${words.length}"/>${escapeXml(tokens[t]!)}`);
        words.push(tokens[t]!);
      }
      const ssml = `<speak>${parts.join(" ")} <mark name="end"/></speak>`;
      // The key rides the `x-goog-api-key` header, never the URL (AC-STE-663.8).
      const url = "https://texttospeech.googleapis.com/v1beta1/text:synthesize";
      const res = await postJson(opts.fetch, opts.wait, url, { "x-goog-api-key": opts.apiKey }, {
        input: { ssml },
        voice: { name: opts.voice, languageCode: opts.voice.split("-").slice(0, 2).join("-") },
        audioConfig: { audioEncoding: "MP3" },
        enableTimePointing: ["SSML_MARK"],
      }, GOOGLE_TTS);
      const data = (await res.json()) as {
        audioContent: string;
        timepoints?: { markName: string; timeSeconds: number }[];
      };
      const marks = new Map((data.timepoints ?? []).map((t) => [t.markName, t.timeSeconds]));
      const alignment: WordTiming[] = words.map((word, i) => {
        const start = marks.get(`w${i}`) ?? 0;
        const end = marks.get(i + 1 < words.length ? `w${i + 1}` : "end") ?? start;
        return { word, start, end };
      });
      return persistSegment(opts, segment.index, data.audioContent, alignment);
    },
  };
}
