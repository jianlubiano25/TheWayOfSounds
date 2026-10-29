/**
 * render.worker.ts  v4
 *
 * ═══════════════════════════════════════════════════════════════════
 * REMOVED: intermediate vizCanvas
 * ─────────────────────────────────────────────────────────────────
 * Previous version created a half-width OffscreenCanvas (vizCanvas)
 * for the particle system, then drawImage'd it onto the composite.
 *
 * The problem: when compositeCtx has  willReadFrequently:true  (CPU
 * backing store) but vizCanvas does NOT, the drawImage forces a GPU
 * texture download on every single frame.  At 30fps this is a
 * continuous GPU→CPU transfer of (960×1080×4) = 4.1 MB/frame.
 *
 * FIX: render particles DIRECTLY onto compositeCtx (clipped to the
 * left half with save()/clip()/restore()).  No intermediate canvas,
 * no GPU readback.  The getImageData at the end is the ONLY
 * CPU←GPU transfer per frame, and willReadFrequently:true ensures
 * the backing store stays in CPU-accessible memory.
 *
 * ADDED: 24-fps support
 * ─────────────────────────────────────────────────────────────────
 * The caller passes fps (24 or 30) determined by audio-utils based on
 * file duration.  No changes needed here — fps is already a parameter.
 */

import { initParticles, initRainDrops, renderFrame } from './visualizer-logic-optimized';
import { VisualizerVariation, VisualizerSettings } from '../types';

// ── Text helpers ──────────────────────────────────────────────────────────────

function getAutoColor(hex: string): string {
  if (!hex) return '#ffffff';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 128 ? '#1A1512' : '#F9F9F9';
}

const PLACEHOLDER = 'Source is everywhere.\nWe are simply the vessel.\nWrite what comes to mind.';

function wrapText(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const paras = text.split('\n');
  for (const para of paras) {
    if (!para.trim()) {
      y += lineHeight;
      continue;
    }
    const words = para.split(' ');
    let line = '';
    for (let n = 0; n < words.length; n++) {
      const testLine = line + (line ? ' ' : '') + words[n];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, x, y);
        line = words[n];
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
}

// ── Text panel (pre-rendered once, static throughout the render) ──────────────

function buildTextPanel(
  width: number,
  height: number,
  settings: VisualizerSettings,
  text: string,
  vizWeight: number,
): OffscreenCanvas {
  // Dedicated canvas for the right (text) half only.
  // Does NOT need willReadFrequently — we only ever drawImage from it.
  const panelWidth = width * (1 - vizWeight);
  const isNarrow    = vizWeight > 0.5;
  const layoutScale = isNarrow ? 0.85 : (1 - vizWeight) / 0.5;
  const canvas = new OffscreenCanvas(panelWidth, height);
  const ctx    = canvas.getContext('2d', { alpha: false })!;
  const scale  = height / 1080;
  const pad    = 100 * scale * layoutScale;
  const topPad = 140 * scale;
  const color  = getAutoColor(settings.rightBackgroundColor);
  const pageNum = Math.max(1, Math.ceil(text.length / 800));

  ctx.fillStyle = settings.rightBackgroundColor;
  ctx.fillRect(0, 0, panelWidth, height);

  const titleSize = 90 * scale * layoutScale;
  const metaSize  = 28 * scale * layoutScale;
  const bodySize  = 44 * scale * Math.max(0.7, layoutScale);
  let bodyTop     = topPad;

  if (settings.showTextHeader) {
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    // Volume first
    ctx.font = `italic ${metaSize}px 'Sorts Mill Goudy', serif`;
    ctx.globalAlpha = 0.5;
    ctx.fillText(`VOLUME. ${pageNum < 10 ? '0' + pageNum : pageNum}`, pad, topPad);
    ctx.globalAlpha = 1.0;

    // Title second
    const titleTop = topPad + metaSize * 1.8;
    ctx.font = `bold ${titleSize}px 'Sorts Mill Goudy', serif`;
    ctx.fillText('THE WAY', pad, titleTop);
    ctx.fillText('OF SOUNDS', pad, titleTop + titleSize * 1.05);

    bodyTop = titleTop + titleSize * 2.2;
  }

  const lineHeight = bodySize * 2.0;
  ctx.font         = `${bodySize}px 'Sorts Mill Goudy', serif`;
  ctx.textAlign    = 'left';
  ctx.globalAlpha  = 1.0; // Ensure full opacity for body text in export
  wrapText(ctx, text.trim() ? text : PLACEHOLDER, pad, bodyTop, panelWidth - pad * 2, lineHeight);
  ctx.globalAlpha  = 1;

  return canvas;
}

// ── Back-pressure token ───────────────────────────────────────────────────────

let nextFrameResolver: (() => void) | null = null;

// ── Main message handler ──────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  if (e.data.type === 'next') {
    nextFrameResolver?.();
    return;
  }

  try {
    const { settings, variation, text, audioData, fps, canvas } = e.data as {
      settings:  VisualizerSettings;
      variation: VisualizerVariation;
      text:      string;
      audioData: { bass: number; mid: number; treble: number; frequencyData: Uint8Array }[];
      fps:       number;
      canvas:    OffscreenCanvas;  // transferred — always 1920×1080
    };

    const width  = canvas.width;   // 1920
    const height = canvas.height;  // 1080

    const isVizOnly = settings.exportContent === 'visualizer-only';
    let vizWeight = isVizOnly ? 1.0 : 0.5;
    if (!isVizOnly && settings.layoutRatio === '66-33') vizWeight = 0.666;
    else if (!isVizOnly && settings.layoutRatio === '70-30') vizWeight = 0.7;

    const mid = width * vizWeight;
    const totalFrames = audioData.length;

    // ── Composite context: willReadFrequently = CPU-backed (fast getImageData) ──
    const compositeCtx = canvas.getContext('2d', {
      alpha: false,
      willReadFrequently: true,  // keeps backing store in CPU memory
    })!;

    // ── Pre-render text panel (static for entire render) ───────────────────
    const textPanel = !isVizOnly ? buildTextPanel(width, height, settings, text, vizWeight) : null;

    // ── Particles ─────────────────────────────────────────────────────────
    const resMult = Math.min(1, 1440 / height);
    const particles = initParticles(
      Math.floor(3200 * settings.particleDensity * resMult),
      isVizOnly ? width : mid, height,
    );
    const rainDrops = variation === VisualizerVariation.FLOW
      ? initRainDrops(Math.floor(200 * settings.particleDensity), isVizOnly ? width : mid, height)
      : [];
    const buckets = new Map();

    // ── Pre-compute left-half clip path (reused every frame) ──────────────
    // We can't cache a Path2D across save/restore calls but we CAN
    // use beginPath + rect each frame cheaply.
    const BASE_SMOOTH = 0.2; // Match Web Audio hardware smoothing (0.8 time constant)
    const SMOOTH = 1 - Math.pow(1 - BASE_SMOOTH, 60 / fps); // Normalize smoothing for export FPS
    let sBass = 0, sMid = 0, sTreble = 0;
    let sFreq: Float32Array | null = null;
    let freqOut: Uint8Array | null = null;

    // ── Render loop ────────────────────────────────────────────────────────
    for (let i = 0; i < totalFrames; i++) {
      const raw = audioData[i];

      // Temporal smoothing (lerp toward raw values each frame)
      if (i === 0) {
        sBass = raw.bass; sMid = raw.mid; sTreble = raw.treble;
        sFreq   = new Float32Array(raw.frequencyData);
        freqOut = new Uint8Array(raw.frequencyData.length);
        for (let j = 0; j < sFreq.length; j++) freqOut[j] = Math.round(sFreq[j]);
      } else {
        sBass   += (raw.bass   - sBass)   * SMOOTH;
        sMid    += (raw.mid    - sMid)    * SMOOTH;
        sTreble += (raw.treble - sTreble) * SMOOTH;
        if (sFreq && freqOut) {
          for (let j = 0; j < sFreq.length; j++) {
            sFreq[j]   += (raw.frequencyData[j] - sFreq[j]) * SMOOTH;
            freqOut[j]  = Math.round(sFreq[j]);
          }
        }
      }

      const audio = {
        frequencyData: freqOut ?? raw.frequencyData,
        bass:      sBass,
        mid:       sMid,
        treble:    sTreble,
        amplitude: (sBass + sMid + sTreble) / 3,
        energy:    ((sBass + sMid + sTreble) / 3) ** 2,
      };

      // ── DIRECT LEFT-HALF RENDER (no intermediate vizCanvas) ────────────
      //
      // BEFORE (v3 and earlier):
      //   renderFrame(vizCtx, ...)       // vizCanvas (half-width, GPU-backed)
      //   compositeCtx.drawImage(vizCanvas, ...)  ← GPU texture download here!
      //
      // AFTER (v4):
      //   compositeCtx.save()
      //   compositeCtx.clip(leftHalfRect)
      //   renderFrame(compositeCtx, ...) // directly into CPU-backed canvas
      //   compositeCtx.restore()
      //
      // One less canvas, one less drawImage, zero GPU readbacks mid-frame.

      if (isVizOnly) {
        renderFrame(
          compositeCtx,
          variation,
          settings,
          audio,
          i / fps,
          width,
          height,
          particles,
          rainDrops,
          { x: width / 2, y: height / 2, scale: 1.8, audioBoost: 1.0, bassBoost: 1.0, trebleBoost: 1.0 },
          buckets,
        );
      } else {
        compositeCtx.save();
        compositeCtx.beginPath();
        compositeCtx.rect(0, 0, mid, height);
        compositeCtx.clip();

        renderFrame(
          compositeCtx,
          variation,
          settings,
          audio,
          i / fps,
          mid,
          height,
          particles,
          rainDrops,
          { x: mid / 2, y: height / 2, scale: 1.8, audioBoost: 1.0, bassBoost: 1.0, trebleBoost: 1.0 },
          buckets,
        );

        compositeCtx.restore();

        // ── Right half: blit text panel ────────────────────────────────────
        if (textPanel) {
          compositeCtx.drawImage(textPanel, mid, 0);
        }
      }

      // ── Pixel readback ─────────────────────────────────────────────────
      // willReadFrequently:true means this is a CPU-to-CPU copy (no GPU stall)
      const imageData  = compositeCtx.getImageData(0, 0, width, height);
      const rgbaBuffer = new Uint8Array(
        imageData.data.buffer,
        imageData.data.byteOffset,
        imageData.data.byteLength,
      );

      // Transfer ownership to IPC layer (zero-copy postMessage)
      (self as any).postMessage({ type: 'frame', buffer: rgbaBuffer, index: i }, [rgbaBuffer.buffer]);

      // Progress report (once per second at nominal fps)
      if (i % Math.max(1, fps) === 0) {
        self.postMessage({ type: 'progress', current: i, total: totalFrames });
      }

      // Back-pressure: wait until IPC layer has consumed this frame
      if (i < totalFrames - 1) {
        await new Promise<void>((resolve) => { nextFrameResolver = resolve; });
      }
    }

    self.postMessage({ type: 'done' });

  } catch (err: any) {
    self.postMessage({ type: 'error', message: err?.message ?? String(err) });
  }
};
