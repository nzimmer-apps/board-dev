// Non-image attachments (voice notes, PDFs): private "files" bucket, text pulled out on this device.
import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { readText } from './images';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function uploadFile(blob: Blob, ext: string, contentType: string): Promise<string> {
  if (blob.size > MAX_FILE_BYTES) throw new Error('File is over 25 MB');
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error('Not signed in');
  const path = `${data.user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('files').upload(path, blob, { contentType, cacheControl: '31536000' });
  if (error) throw error;
  return path;
}

export async function removeFile(path: string) {
  await supabase.storage.from('files').remove([path]);
}

const urlCache = new Map<string, { url: string; exp: number }>();
export async function fileUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from('files').createSignedUrl(path, 86400);
  if (error || !data) return null;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 23 * 3600e3 });
  return data.signedUrl;
}

export async function downloadFile(path: string): Promise<Blob | null> {
  const { data } = await supabase.storage.from('files').download(path);
  return data ?? null;
}

/** "audio/webm;codecs=opus" → { type: "audio/webm", ext: "webm" } (the bucket only lists plain types). */
export function audioKind(mime: string): { type: string; ext: string } {
  const type = (mime.split(';')[0] || 'audio/webm').trim().toLowerCase();
  const ext = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/opus': 'opus', 'audio/3gpp': '3gp', 'audio/amr': 'amr' }[type];
  return ext ? { type, ext } : { type: 'audio/webm', ext: 'webm' };
}

/**
 * Text of a PDF. Uses the PDF's own text when it has any; a scanned PDF (pictures of pages)
 * gets its first pages read with OCR instead.
 */
export async function pdfText(blob: Blob): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const doc = await pdfjs.getDocument({ data: await blob.arrayBuffer() }).promise;
  try {
    const parts: string[] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 30); n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      let line = '';
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        line += it.str;
        if (it.hasEOL) { parts.push(line); line = ''; } else if (it.str && !it.str.endsWith(' ')) line += ' ';
      }
      if (line.trim()) parts.push(line);
    }
    let text = parts.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    if (text.replace(/\s/g, '').length < 20) {
      const ocr: string[] = [];
      for (let n = 1; n <= Math.min(doc.numPages, 3); n++) {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        const img = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
        if (img) ocr.push(await readText(img));
      }
      text = ocr.filter(Boolean).join('\n');
    }
    return text.slice(0, 20000);
  } finally {
    doc.destroy();
  }
}

// ---------- Voice notes ----------

/* eslint-disable @typescript-eslint/no-explicit-any */
const SR: any = typeof window !== 'undefined' ? (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition : undefined;
export const canRecord = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

/**
 * Record from the microphone. Where the browser can also turn speech into text (Chrome, Edge),
 * the words come back as `transcript`; elsewhere it is '' and the note is audio only.
 */
export function useRecorder(onDone: (audio: Blob, transcript: string, seconds: number) => void, onError: (msg: string) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const live = useRef<{ mr: MediaRecorder; stream: MediaStream; sr: any; text: string; t0: number; keep: boolean } | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!recording) return;
    const t = window.setInterval(() => setSeconds(Math.floor((Date.now() - (live.current?.t0 ?? Date.now())) / 1000)), 500);
    return () => window.clearInterval(t);
  }, [recording]);

  // Leaving the screen mid-recording: let go of the microphone.
  useEffect(() => () => { live.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  async function start() {
    if (live.current) return;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError('Microphone not available. Allow microphone access for Board and try again.');
      return;
    }
    const mr = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const s = { mr, stream, sr: null as any, text: '', t0: Date.now(), keep: true };
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const secs = Math.round((Date.now() - s.t0) / 1000);
      live.current = null;
      setRecording(false);
      setSeconds(0);
      // Give speech recognition a moment to hand over its last words.
      if (s.keep && chunks.length) window.setTimeout(() => done.current(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }), s.text.trim(), secs), s.sr ? 400 : 0);
    };
    if (SR) {
      try {
        const sr = new SR();
        sr.continuous = true;
        sr.interimResults = false;
        sr.lang = navigator.language || 'en-US';
        sr.onresult = (e: any) => {
          for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) s.text += e.results[i][0].transcript + ' ';
        };
        sr.onerror = () => {};
        sr.start();
        s.sr = sr;
      } catch { /* speech-to-text is a bonus; the recording still works */ }
    }
    live.current = s;
    mr.start();
    setRecording(true);
  }

  function stop(keep = true) {
    const s = live.current;
    if (!s) return;
    s.keep = keep;
    try { s.sr?.stop(); } catch { /* already stopped */ }
    if (s.mr.state !== 'inactive') s.mr.stop();
  }

  return { recording, seconds, start, stop: () => stop(true), cancel: () => stop(false) };
}
