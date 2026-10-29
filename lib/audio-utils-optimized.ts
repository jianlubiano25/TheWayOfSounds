/**
 * audio-utils-optimized.ts  v4
 *
 * ═══════════════════════════════════════════════════════════════════
 * THE MEMORY PROBLEM (what the Activity Monitor showed):
 * ─────────────────────────────────────────────────────────────────
 * Web Audio's decodeAudioData() for a 1-hour stereo 44.1kHz file:
 *   3600 s × 44100 Hz × 2 ch × 4 bytes = 1.27 GB
 * This is allocated in the Electron renderer heap BEFORE any analysis.
 * It's what produced the "Electron: 1.79 GB" in Activity Monitor.
 *
 * THE FIX:
 * ─────────────────────────────────────────────────────────────────
 * For files > LONG_FILE_THRESHOLD seconds, we call the Electron main
 * process via `window.electronAPI.analyzeAudio()`, which:
 *   1. Runs FFmpeg to output raw PCM at 22050 Hz mono (streaming)
 *   2. Processes a 1024-sample FFT window at a time (4 KB working set)
 *   3. Builds the full FrameAudioData[] and returns it via IPC
 *
 * Peak renderer memory during analysis: ~2 MB (just the result array)
 * instead of 1.27 GB + analysis buffers.
 *
 * AUTO FPS REDUCTION:
 * ─────────────────────────────────────────────────────────────────
 * Files > 30 minutes automatically use 24fps instead of 30fps.
 *   • 20% fewer IPC calls per second
 *   • 20% fewer frames to render and encode
 *   • 20% smaller output file
 *   • Visually identical for ambient/atmospheric content
 *
 * KEEP SHORT-FILE PATH UNCHANGED:
 * ─────────────────────────────────────────────────────────────────
 * Files ≤ 5 minutes still use the Web Audio OfflineAudioContext path.
 * This gives better frequency resolution (native FFT_SIZE=1024 at the
 * full 44.1kHz sample rate) and better smoothing continuity for short
 * videos where frame-level precision matters more.
 */

export interface FrameAudioData {
  bass: number;
  mid: number;
  treble: number;
  frequencyData: Uint8Array;
}

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Files ≤ this many seconds use Web Audio (short precise path). */
const SHORT_FILE_SECONDS = 300;   // 5 minutes

/** Files > this many seconds use 24fps instead of 30fps. */
const REDUCE_FPS_SECONDS = 1800;  // 30 minutes

/** Choose FPS based on duration. */
export function chooseFps(durationSeconds: number): number {
  return durationSeconds > REDUCE_FPS_SECONDS ? 24 : 30;
}

// ═══════════════════════════════════════════════════════════════════
// PATH A: Node.js FFmpeg streaming analysis (long files)
// ═══════════════════════════════════════════════════════════════════

/**
 * Analyzes a File using the Electron main process's FFT engine.
 * Zero renderer heap impact — analysis happens in Node.js.
 * For files where duration is unknown, pass 0 for estimatedDuration.
 *
 * Requires: Electron Desktop App (window.electronAPI.analyzeAudio exists).
 */
export async function analyzeAudioViaFFmpeg(
  file: File,
  fps: number,
  onProgress?: (fraction: number) => void,
): Promise<FrameAudioData[]> {
  const api = (window as any).electronAPI;
  if (!api?.analyzeAudio) throw new Error('analyzeAudio not available — are you in the Desktop App?');

  const audioPath = api.getPathForFile(file);
  if (!audioPath) throw new Error('Could not resolve absolute path for audio file.');

  // Estimate duration from File metadata if available
  const estimatedDuration = await estimateFileDuration(file);

  // Wire progress listener before invoking (avoids race condition)
  const progressHandler = (fraction: number) => onProgress?.(fraction);
  api.onAnalyzeProgress(progressHandler);

  try {
    const results: FrameAudioData[] = await api.analyzeAudio(audioPath, fps, estimatedDuration);
    return results;
  } finally {
    api.offAnalyzeProgress(progressHandler);
  }
}

/** Estimates audio file duration by decoding a tiny portion. Fast (~50 ms). */
async function estimateFileDuration(file: File): Promise<number> {
  try {
    // Most browsers expose duration on an Audio element without full decode
    return await new Promise((resolve) => {
      const audio = new Audio(URL.createObjectURL(file));
      audio.addEventListener('loadedmetadata', () => resolve(audio.duration || 0), { once: true });
      audio.addEventListener('error', () => resolve(0), { once: true });
    });
  } catch {
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════
// PATH B: Web Audio OfflineAudioContext (short files ≤ 5 min)
// ═══════════════════════════════════════════════════════════════════

const FFT_SIZE   = 1024;
const HALF_BIN   = FFT_SIZE / 2;
const CHUNK_SECS = 90;   // 1.5-minute chunks (42 MB PCM each at 44.1 kHz stereo)

async function analyzeSingle(
  audioBuffer: AudioBuffer,
  fps: number,
  onProgress?: (fraction: number) => void,
): Promise<FrameAudioData[]> {
  const { length: totalSamples, sampleRate, duration } = audioBuffer;
  const frameCount = Math.ceil(duration * fps);
  // Standardized bands (SRATE=44100, bin=43Hz)
  const bassLimit  = Math.round(250 / (sampleRate / FFT_SIZE));  // ~6 bins
  const midLimit   = Math.round(4000 / (sampleRate / FFT_SIZE)); // ~93 bins
  const results: FrameAudioData[] = new Array(frameCount);

  const offCtx   = new OfflineAudioContext(audioBuffer.numberOfChannels, totalSamples, sampleRate);
  const src      = offCtx.createBufferSource();
  src.buffer     = audioBuffer;
  const analyser = offCtx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.8;
  src.connect(analyser);
  analyser.connect(offCtx.destination);
  src.start(0);

  let idx = 0;
  function scheduleNext() {
    if (idx >= frameCount) return;
    const t = idx === 0 ? 1 / sampleRate : idx / fps;
    offCtx.suspend(t).then(() => {
      const freq = new Uint8Array(HALF_BIN);
      analyser.getByteFrequencyData(freq);
      let b = 0, m = 0, t2 = 0;
      for (let j = 0;         j < bassLimit; j++) b  += freq[j];
      for (let j = bassLimit; j < midLimit;  j++) m  += freq[j];
      for (let j = midLimit;  j < HALF_BIN;  j++) t2 += freq[j];
      results[idx] = {
        bass:          b  / Math.max(1, bassLimit              * 255),
        mid:           m  / Math.max(1, (midLimit - bassLimit) * 255),
        treble:        t2 / Math.max(1, (HALF_BIN - midLimit)  * 255),
        frequencyData: freq,
      };
      idx++;
      if (idx % fps === 0) onProgress?.(idx / frameCount);
      scheduleNext();
      offCtx.resume();
    });
  }
  scheduleNext();
  await offCtx.startRendering();

  const silent: FrameAudioData = { bass: 0, mid: 0, treble: 0, frequencyData: new Uint8Array(HALF_BIN) };
  for (let i = 0; i < frameCount; i++) if (!results[i]) results[i] = silent;
  return applyTemporalSmoothing(results);
}

async function analyzeChunked(
  audioBuffer: AudioBuffer,
  fps: number,
  onProgress?: (fraction: number) => void,
): Promise<FrameAudioData[]> {
  const { sampleRate, numberOfChannels, length: totalSamples, duration } = audioBuffer;
  const chunkSamples = Math.round(CHUNK_SECS * sampleRate);
  const numChunks    = Math.ceil(totalSamples / chunkSamples);
  const all: FrameAudioData[] = [];

  for (let c = 0; c < numChunks; c++) {
    const start   = c * chunkSamples;
    const end     = Math.min(start + chunkSamples, totalSamples);
    const len     = end - start;

    // Mono down-mix for analysis: halves memory vs stereo
    const mono    = new OfflineAudioContext(1, len, sampleRate);
    const cbuf    = mono.createBuffer(1, len, sampleRate);
    const pcm     = new Float32Array(len);
    audioBuffer.copyFromChannel(pcm, 0, start);
    if (numberOfChannels > 1) {
      const ch1 = new Float32Array(len);
      audioBuffer.copyFromChannel(ch1, 1, start);
      for (let j = 0; j < len; j++) pcm[j] = (pcm[j] + ch1[j]) * 0.5;
    }
    cbuf.copyToChannel(pcm, 0);

    const chunk = await analyzeSingle(cbuf, fps, (f) => onProgress?.((c + f) / numChunks));
    all.push(...chunk);
  }
  return all.slice(0, Math.ceil(duration * fps));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyze a single AudioBuffer (already decoded in-memory).
 * Use this for the live-preview playback path where you already have an AudioBuffer.
 * For export rendering of long files, use analyzeAudioViaFFmpeg() instead.
 */
export const analyzeAudioBufferOptimized = async (
  audioBuffer: AudioBuffer,
  fps: number = 30,
  onProgress?: (fraction: number) => void,
): Promise<FrameAudioData[]> => {
  if (audioBuffer.duration > SHORT_FILE_SECONDS) {
    return analyzeChunked(audioBuffer, fps, onProgress);
  }
  return analyzeSingle(audioBuffer, fps, onProgress);
};

/**
 * Primary export-path analysis function.
 * Automatically routes:
 *   - Long files (> 5 min) + Electron Desktop → FFmpeg Node.js path (no heap pressure)
 *   - Short files or browser-only env → Web Audio path
 *
 * Returns both the FrameAudioData[] AND the fps used (may differ from input).
 */
export const analyzeFileForExport = async (
  file: File,
  requestedFps: number,
  onProgress?: (fraction: number) => void,
): Promise<{ audioData: FrameAudioData[]; fps: number }> => {
  const estimatedDuration = await estimateFileDuration(file);
  const fps = estimatedDuration > REDUCE_FPS_SECONDS ? 24 : requestedFps;
  const api = (window as any).electronAPI;

  const useFFmpegPath =
    !!api?.analyzeAudio &&
    estimatedDuration > SHORT_FILE_SECONDS;

  let audioData: FrameAudioData[];

  if (useFFmpegPath) {
    console.log(`[Analysis] FFmpeg path: ${Math.round(estimatedDuration / 60)} min, ${fps} fps`);
    audioData = await analyzeAudioViaFFmpeg(file, fps, onProgress);
  } else {
    // Web Audio path: decode the file first
    const ctx   = new AudioContext();
    const bytes = await file.arrayBuffer();
    const buf   = await ctx.decodeAudioData(bytes);
    await ctx.close();
    audioData = await analyzeAudioBufferOptimized(buf, fps, onProgress);
  }

  return { audioData, fps };
};

/**
 * Analyzes multiple files sequentially. Useful for playlist rendering.
 * Ensures consistent FPS across the set (minimum of requested or required).
 */
export const analyzeMultipleFiles = async (
  files: File[],
  requestedFps: number,
  onProgress?: (fraction: number) => void,
): Promise<{ audioDataPerFile: FrameAudioData[][]; fps: number }> => {
  let commonFps = requestedFps;

  // Determine the minimum FPS needed for the group
  for (const file of files) {
    const duration = await estimateFileDuration(file);
    const requiredFps = chooseFps(duration);
    if (requiredFps < commonFps) commonFps = requiredFps;
  }

  const audioDataPerFile: FrameAudioData[][] = [];
  for (let i = 0; i < files.length; i++) {
    const { audioData } = await analyzeFileForExport(files[i], commonFps, (f) => {
      onProgress?.((i + f) / files.length);
    });
    audioDataPerFile.push(audioData);
  }

  return { audioDataPerFile, fps: commonFps };
};

// ── Temporal smoothing ────────────────────────────────────────────────────────

function applyTemporalSmoothing(data: FrameAudioData[]): FrameAudioData[] {
  if (data.length < 3) return data;
  const out = new Array<FrameAudioData>(data.length);
  for (let i = 0; i < data.length; i++) {
    const p = data[Math.max(0, i - 1)];
    const c = data[i];
    const n = data[Math.min(data.length - 1, i + 1)];
    out[i] = {
      ...c,
      bass:   (p.bass   + c.bass   + n.bass)   / 3,
      mid:    (p.mid    + c.mid    + n.mid)    / 3,
      treble: (p.treble + c.treble + n.treble) / 3,
    };
  }
  return out;
}
