/**
 * StreamingEncoder.ts – High-performance Desktop Native Bridge
 *
 * v2 CHANGES:
 * ─────────────────────────────────────────────────────────────────
 * 1. encodeVideoStream() now accepts audioPaths: string[] for playlist mode.
 *    A single path → existing behavior.
 *    Multiple paths → sent to main.js which builds an FFmpeg concat filter.
 *
 * 2. Reduced default 4K bitrate from 60 Mbps → 20 Mbps.
 *    At 60 Mbps a 1-hour 4K encode produces a ~27 GB file which causes
 *    filesystem failures on many drives and makes FFmpeg stall.
 *    20 Mbps still delivers visually lossless quality for ambient content.
 *
 * 3. canvasToRgbaBuffer() unchanged — kept here for backward compatibility.
 */

import { RenderFrequencyHz } from '../types';

export interface StreamEncodeOptions {
  /** File object for single-audio exports. */
  audioFile?: File;
  /** Pre-resolved absolute paths. Used by playlist mode (main.js handles concat). */
  audioPaths?: string[];
  outputPath: string;
  fps: number;
  /** Frame dimensions from render worker — always 1920×1080 */
  width: number;
  height: number;
  /** FFmpeg output dimensions — may be 3840×2160 for 4K. main.js Lanczos-upscales. */
  outputWidth?: number;
  outputHeight?: number;
  totalFrames: number;
  onProgress: (percent: number) => void;
  frameDataStream: AsyncIterable<Uint8Array>;
  renderFrequencyHz?: RenderFrequencyHz;
}

/**
 * Streams raw RGBA frames directly to the Electron Main process via IPC.
 * Main spawns FFmpeg, which receives frames on stdin and audio from disk.
 * This bypasses the browser memory limit entirely (no WebCodecs / ffmpeg.wasm).
 */
export async function encodeVideoStream(options: StreamEncodeOptions): Promise<string> {
  const {
    audioFile,
    audioPaths,
    outputPath,
    fps,
    width,
    height,
    totalFrames,
    frameDataStream,
    onProgress,
  } = options;

  const api = (window as any).electronAPI;
  if (!api) {
    throw new Error('Electron API not found. Run the Desktop App to export.');
  }

  // ── Resolve audio path(s) ─────────────────────────────────────────────────
  let resolvedPaths: string[];

  if (audioPaths && audioPaths.length > 0) {
    resolvedPaths = audioPaths;
  } else if (audioFile) {
    const p = api.getPathForFile?.(audioFile) || (audioFile as any).path || '';
    if (!p) throw new Error('Could not resolve audio file path from Electron.');
    resolvedPaths = [p];
  } else {
    throw new Error('No audio file or paths provided to StreamingEncoder.');
  }

  if (!outputPath) throw new Error('No output path selected.');

  // ── Register one-shot completion listener BEFORE starting export ──────────
  // Using onceExportComplete to avoid stale listeners from previous renders.
  let exportError: Error | null = null;
  const completion = new Promise<string>((resolve, reject) => {
    api.onceExportComplete(
      ({ success, outputPath: savedPath, errorMessage, logs }: {
        success: boolean;
        outputPath: string | null;
        errorMessage: string | null;
        logs: string[];
      }) => {
        if (success) {
          resolve(savedPath || outputPath);
        } else {
          const msg = errorMessage || 'FFmpeg process failed.';
          console.error('[FFmpeg Logs]\n', logs?.join('\n') ?? '');
          exportError = new Error(msg);
          reject(exportError);
        }
      },
    );
  });
  // Prevent unhandled rejection noise — the await below will catch it.
  completion.catch(() => undefined);

  // ── Start the native FFmpeg process ──────────────────────────────────────
  api.startExport({
    audioPaths: resolvedPaths,
    audioPath: resolvedPaths[0],
    outputPath,
    // Render dimensions (always 1080p from the worker canvas)
    width,
    height,
    // Output dimensions — main.js Lanczos-upscales if larger than render size
    outputWidth:  options.outputWidth  ?? width,
    outputHeight: options.outputHeight ?? height,
    fps,
    renderFrequencyHz: options.renderFrequencyHz,
  });

  // ── Stream frames frame-by-frame ─────────────────────────────────────────
  let frameCount = 0;
  for await (const rgbaBuffer of frameDataStream) {
    if (exportError) throw exportError;
    await api.sendFrame(rgbaBuffer);
    frameCount++;

    if (frameCount % 10 === 0 || frameCount === totalFrames) {
      onProgress(Math.min(99, Math.floor((frameCount / totalFrames) * 100)));
    }
  }

  // ── Signal EOF to FFmpeg ──────────────────────────────────────────────────
  await api.endStream();

  return completion;
}

/**
 * Helper to convert an OffscreenCanvas context to the RGBA pixel buffer
 * that FFmpeg expects on stdin.  Zero-copy: wraps the existing ImageData
 * buffer rather than allocating a new Uint8Array.
 */
export function canvasToRgbaBuffer(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): Uint8Array {
  const imageData = ctx.getImageData(0, 0, width, height);
  return new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
}
