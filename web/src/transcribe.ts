// Turn a voice note or audio file into text on this device. Works in the Android app, Windows app and any
// browser (the live speech-to-text used while recording only exists in Chrome and Edge).

const RATE = 16000; // what Whisper expects

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { res: (t: string) => void; rej: (e: Error) => void }>();
let onProgress: ((pct: number) => void) | null = null;

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./transcribe.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ type: string; id?: number; text?: string; message?: string; pct?: number }>) => {
    const m = e.data;
    if (m.type === 'progress') { onProgress?.(m.pct ?? 0); return; }
    const w = waiting.get(m.id!);
    if (!w) return;
    waiting.delete(m.id!);
    if (m.type === 'done') w.res(m.text ?? '');
    else w.rej(new Error(/fetch|network|load/i.test(m.message ?? '')
      ? 'the speech model could not be downloaded (it needs internet the first time). Tap “Get the words” to try again'
      : m.message || 'could not read the audio'));
  };
  worker.onerror = (e) => {
    for (const w of waiting.values()) w.rej(new Error(e.message || 'Speech-to-text failed to start'));
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Decode any audio the browser can play into 16 kHz mono samples. */
async function samples(blob: Blob): Promise<Float32Array> {
  const Ctx = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const buf = await new Ctx(1, 1, RATE).decodeAudioData(await blob.arrayBuffer());
  if (buf.numberOfChannels === 1 && buf.sampleRate === RATE) return buf.getChannelData(0);
  // Mix down and resample by rendering through an offline context at 16 kHz.
  const ctx = new Ctx(1, Math.ceil(buf.duration * RATE), RATE);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** Whisper's markers for stretches with no words. */
const NOISE = /\[(?:BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE)\]|\((?:music|silence|inaudible|wind blowing|static)\)/gi;

/** What was said in the recording, tidied; '' when nothing was. */
export async function transcribe(audio: Blob, progress?: (pct: number) => void): Promise<string> {
  const pcm = (await samples(audio)).slice(); // own copy, so it can be handed to the worker
  if (pcm.length < RATE * 0.3) return '';
  onProgress = progress ?? null;
  const w = getWorker();
  const id = nextId++;
  const text = await new Promise<string>((res, rej) => {
    waiting.set(id, { res, rej });
    w.postMessage({ id, audio: pcm }, [pcm.buffer]);
  });
  return text.replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
}
