/**
 * OfflineRenderer-optimized.ts – Desktop Native Streaming Engine
 *
 * v2 CHANGES:
 * ─────────────────────────────────────────────────────────────────
 * 1. FIXED progress percentage bug:
 *    e.data.current / e.data.total was multiplied by 10 instead of 100.
 *    Progress bar showed 0–10% for the entire render then jumped to 100%.
 *
 * 2. runPlaylistRender() – new public function for playlist export.
 *    Supports two modes:
 *      'single'   → all tracks in one video (audio concat via FFmpeg)
 *      'separate' → one video file per track (sequential batch render)
 *
 * 3. analyzeAudioBufferOptimized re-exported from audio-utils v2 which
 *    now uses chunked analysis for files > 10 minutes (prevents OOM crash).
 */

import { VisualizerSettings, VisualizerVariation } from '../types';
import { FrameAudioData } from './audio-utils-optimized';
import { encodeVideoStream } from './StreamingEncoder';

export { analyzeAudioBufferOptimized, analyzeMultipleFiles } from './audio-utils-optimized';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RenderProgress {
  percent: number;
  currentFrame: number;
  totalFrames: number;
  status: string;
}

export interface RenderOptions {
  width: number;
  height: number;
  settings: VisualizerSettings;
  variation: VisualizerVariation;
  text: string;
  audioData: FrameAudioData[];
  audioFile: File;
  outputPath: string;
  fps: number;
  onProgress: (p: RenderProgress) => void;
  signal?: AbortSignal;
}

export interface PlaylistRenderOptions {
  /** 'single'   = all tracks → one video with concatenated audio   */
  /** 'separate' = one video per track (sequential batch render)     */
  mode: 'single' | 'separate';
  files: File[];
  /** Pre-analyzed audio data – one FrameAudioData[] per file.       */
  audioDataPerFile: FrameAudioData[][];
  /** For 'separate' mode: array of output paths, one per file.      */
  outputPaths?: string[];
  /** For 'single' mode: one output path.                            */
  outputPath?: string;
  width: number;
  height: number;
  settings: VisualizerSettings;
  variation: VisualizerVariation;
  text: string;
  fps: number;
  onProgress: (p: RenderProgress) => void;
  signal?: AbortSignal;
}

// ─── Frame generator (unchanged architecture) ─────────────────────────────────

// CRITICAL: Render resolution is ALWAYS 1920×1080.
// Output resolution (e.g. 3840×2160 for 4K) is handled by FFmpeg's
// Lanczos upscale filter in main.js. Rendering at 4K directly causes
// 33 MB/frame getImageData calls that crash Electron's heap at 30fps.
const RENDER_W = 1920;
const RENDER_H = 1080;

async function* frameDataGenerator(options: RenderOptions): AsyncGenerator<Uint8Array> {
  const { signal, onProgress } = options;
  const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });

  const canvas = document.createElement('canvas');
  canvas.width  = RENDER_W;  // ALWAYS 1920 — NOT the 4K output size
  canvas.height = RENDER_H;  // ALWAYS 1080
  const offscreen = canvas.transferControlToOffscreen();

  const frameQueue: Uint8Array[] = [];
  let resolveNextFrame: ((value: { done: boolean; value?: Uint8Array }) => void) | null = null;
  let isDone = false;
  let error: Error | null = null;

  worker.onmessage = (e) => {
    if (e.data.type === 'frame') {
      if (resolveNextFrame) {
        resolveNextFrame({ done: false, value: e.data.buffer });
        resolveNextFrame = null;
      } else {
        frameQueue.push(e.data.buffer);
      }
    } else if (e.data.type === 'progress') {
      // ── FIX: was `* 10` (bug), now `* 100` ──────────────────────────────
      onProgress({
        percent: Math.round((e.data.current / e.data.total) * 100),
        currentFrame: e.data.current,
        totalFrames: e.data.total,
        status: 'Rendering Frames…',
      });
    } else if (e.data.type === 'done') {
      isDone = true;
      if (resolveNextFrame) {
        resolveNextFrame({ done: true });
        resolveNextFrame = null;
      }
    } else if (e.data.type === 'error') {
      error = new Error(e.data.message);
      if (resolveNextFrame) resolveNextFrame({ done: true });
    }
  };

  if (signal) {
    signal.addEventListener('abort', () => worker.terminate());
  }

  worker.postMessage(
    {
      width:     RENDER_W,    // always 1920 — worker renders at this size
      height:    RENDER_H,    // always 1080
      settings:  options.settings,
      variation: options.variation,
      text:      options.text,
      audioData: options.audioData,
      fps:       options.fps,
      canvas:    offscreen,
    },
    [offscreen],
  );

  try {
    while (true) {
      if (error) throw error;

      if (frameQueue.length > 0) {
        const frame = frameQueue.shift()!;
        yield frame;
        worker.postMessage({ type: 'next' });
      } else if (isDone) {
        break;
      } else {
        const res = await new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
          resolveNextFrame = resolve;
        });
        if (res.done) break;
        yield res.value!;
        worker.postMessage({ type: 'next' });
      }
    }
  } finally {
    worker.terminate();
  }
}

// ─── Single-file render (unchanged public API) ────────────────────────────────

export const runOfflineRender = async (options: RenderOptions): Promise<string> => {
  const { audioFile, fps, onProgress } = options;

  try {
    onProgress({
      percent: 0,
      currentFrame: 0,
      totalFrames: options.audioData.length,
      status: 'Initializing Desktop Engine…',
    });

    const frameStream = frameDataGenerator(options);

    const savedPath = await encodeVideoStream({
      audioFile,
      outputPath: options.outputPath,
      fps,
      // Render resolution (always 1080p from the worker)
      width:  RENDER_W,
      height: RENDER_H,
      // Output resolution (user's choice — main.js Lanczos-upscales if 4K)
      outputWidth:  options.width,
      outputHeight: options.height,
      totalFrames: options.audioData.length,
      frameDataStream: frameStream,
      renderFrequencyHz: options.settings.renderFrequencyHz,
      onProgress: (p) =>
        onProgress({
          // Frames = 0–90%, FFmpeg finalization = 90–100%
          percent: Math.round(p * 0.9),
          currentFrame: Math.round((p / 100) * options.audioData.length),
          totalFrames: options.audioData.length,
          status: `Encoding to Hardware… ${p}%`,
        }),
    });

    return savedPath;
  } catch (err: any) {
    if (err?.message !== 'Render aborted') console.error('Render error:', err);
    throw err;
  }
};

// ─── Playlist render (NEW) ────────────────────────────────────────────────────

/**
 * runPlaylistRender() – handles multi-file playlist exports.
 *
 * mode = 'single':
 *   Concatenates all FrameAudioData arrays into one big sequence, renders
 *   a single continuous video, and passes all audio paths to main.js so
 *   FFmpeg can concat the audio tracks server-side without re-encoding.
 *
 * mode = 'separate':
 *   Renders each file independently in sequence. Reports overall progress
 *   as (filesDone / totalFiles) + (currentFileProgress / totalFiles).
 *   Returns an array of saved file paths.
 */
export const runPlaylistRender = async (
  options: PlaylistRenderOptions,
): Promise<string[]> => {
  const {
    mode,
    files,
    audioDataPerFile,
    outputPaths,
    outputPath,
    width,
    height,
    settings,
    variation,
    text,
    fps,
    onProgress,
    signal,
  } = options;

  const api = (window as any).electronAPI;

  if (mode === 'single') {
    // ── Concatenate all audio frames into one sequence ──────────────────────
    const concatenated: FrameAudioData[] = ([] as FrameAudioData[]).concat(...audioDataPerFile);
    const totalFrames = concatenated.length;

    if (!outputPath) throw new Error('outputPath is required for single-video playlist render.');

    // Resolve all audio paths so FFmpeg can concat them
    const audioPaths: string[] = files.map(
      (f) => api?.getPathForFile?.(f) || (f as any).path || '',
    );

    onProgress({ percent: 0, currentFrame: 0, totalFrames, status: 'Starting Playlist Render…' });

    const frameStream = frameDataGenerator({
      width, height, settings, variation, text,
      audioData: concatenated,
      audioFile: files[0],  // placeholder — audioPaths below is what matters
      outputPath,
      fps,
      onProgress: (p) =>
        onProgress({
          percent: Math.round(p.percent * 0.9),
          currentFrame: p.currentFrame,
          totalFrames: p.totalFrames,
          status: `Rendering Playlist… ${p.percent}%`,
        }),
      signal,
    });

    const savedPath = await encodeVideoStream({
      audioPaths,
      outputPath,
      fps,
      width,
      height,
      totalFrames,
      frameDataStream: frameStream,
      renderFrequencyHz: settings.renderFrequencyHz,
      onProgress: (p) =>
        onProgress({
          percent: Math.round(p * 0.9),
          currentFrame: Math.round((p / 100) * totalFrames),
          totalFrames,
          status: `Encoding Playlist… ${p}%`,
        }),
    });

    return [savedPath];
  }

  // ── mode === 'separate': render each file in sequence ────────────────────
  if (!outputPaths || outputPaths.length !== files.length) {
    throw new Error('outputPaths array must match files array length for separate mode.');
  }

  const savedPaths: string[] = [];

  for (let i = 0; i < files.length; i++) {
    if (signal?.aborted) throw new Error('Render aborted');

    const file       = files[i];
    const audioData  = audioDataPerFile[i];
    const outPath    = outputPaths[i];
    const fileOffset = i / files.length;
    const fileShare  = 1 / files.length;

    onProgress({
      percent: Math.round(fileOffset * 100),
      currentFrame: 0,
      totalFrames: audioData.length,
      status: `Rendering track ${i + 1} of ${files.length}: ${file.name}`,
    });

    const savedPath = await runOfflineRender({
      width, height, settings, variation, text,
      audioData,
      audioFile: file,
      outputPath: outPath,
      fps,
      signal,
      onProgress: (p) =>
        onProgress({
          percent: Math.round((fileOffset + (p.percent / 100) * fileShare) * 100),
          currentFrame: p.currentFrame,
          totalFrames: p.totalFrames,
          status: `Track ${i + 1}/${files.length} — ${p.status}`,
        }),
    });

    savedPaths.push(savedPath);
  }

  return savedPaths;
};
