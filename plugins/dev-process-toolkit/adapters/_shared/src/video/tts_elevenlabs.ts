// STE-664 — ElevenLabs TTS adapter (with-timestamps endpoint).

import {
  ELEVENLABS,
  persistSegment,
  postJson,
  type ProviderOpts,
  type SynthesisResult,
  type TtsProvider,
  type WordTiming,
} from "./tts";

interface CharAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Fold ElevenLabs' character alignment into a word list. */
function charsToWords(a: CharAlignment): WordTiming[] {
  const words: WordTiming[] = [];
  let current: WordTiming | null = null;
  a.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      current = null;
      return;
    }
    const start = a.character_start_times_seconds[i]!;
    const end = a.character_end_times_seconds[i]!;
    if (current === null) {
      current = { word: ch, start, end };
      words.push(current);
    } else {
      current.word += ch;
      current.end = end;
    }
  });
  return words;
}

/** ElevenLabs has no SSML break tag: a `<break .../>` becomes a spoken `[short pause]` cue. */
export function rewriteBreaksForElevenLabs(text: string): string {
  return text.replace(/\s*<break\b[^>]*\/>\s*/g, " [short pause] ").trim();
}

export function createElevenLabsTts(opts: ProviderOpts): TtsProvider {
  return {
    async synthesize(segment): Promise<SynthesisResult> {
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(opts.voice)}/with-timestamps`;
      const body: Record<string, unknown> = { text: rewriteBreaksForElevenLabs(segment.text) };
      if (opts.model !== undefined) body.model_id = opts.model;
      const res = await postJson(opts.fetch, opts.wait, url, { "xi-api-key": opts.apiKey }, body, ELEVENLABS);
      const data = (await res.json()) as { audio_base64: string; alignment: CharAlignment };
      return persistSegment(opts, segment.index, data.audio_base64, charsToWords(data.alignment));
    },
  };
}
