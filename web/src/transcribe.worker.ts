// Speech to text on this device (Whisper, via transformers.js). Runs in a worker so the app stays responsive.
// The model (~80 MB) downloads once on first use and is then kept in the browser's cache.
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

const MODEL = 'Xenova/whisper-base.en';
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load() {
  asr ??= pipeline('automatic-speech-recognition', MODEL, {
    dtype: 'q8',
    device: 'wasm',
    progress_callback: (p: { status: string; progress?: number }) => {
      if (p.status === 'progress_total') self.postMessage({ type: 'progress', pct: Math.round(p.progress ?? 0) });
    },
  }) as Promise<AutomaticSpeechRecognitionPipeline>;
  asr.catch(() => { asr = null; }); // let a later try download again
  return asr;
}

self.onmessage = async (e: MessageEvent<{ id: number; audio: Float32Array }>) => {
  const { id, audio } = e.data;
  try {
    const run = await load();
    const out = await run(audio, { chunk_length_s: 30, stride_length_s: 5 });
    const text = (Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text) ?? '';
    self.postMessage({ type: 'done', id, text });
  } catch (err) {
    self.postMessage({ type: 'error', id, message: (err as Error)?.message ?? String(err) });
  }
};
