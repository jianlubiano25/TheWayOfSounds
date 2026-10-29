import { VisualizerVariation, VisualizerSettings } from '../types';
import { initParticles, initRainDrops, renderFrame } from './visualizer-logic-optimized';
import { FrameAudioData } from './audio-utils-optimized';

// --- Helper functions (copied from App.tsx and OfflineRenderer-optimized.ts) ---
const getAutoColor = (hexcolor: string) => {
  if (!hexcolor) return '#ffffff';
  const r = parseInt(hexcolor.substring(1, 3), 16);
  const g = parseInt(hexcolor.substring(3, 5), 16);
  const b = parseInt(hexcolor.substring(5, 7), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return yiq >= 128 ? '#1A1512' : '#F9F9F9';
};

const PLACEHOLDER = 'Source is everywhere.\nWe are simply the vessel.\nWrite what comes to mind.';

// --- TextLayerCache (copied from OfflineRenderer-optimized.ts) ---
class TextLayerCache {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;

  constructor(private width: number, private height: number, private settings: VisualizerSettings) {
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
  }

  private wrapText(ctx: OffscreenCanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
    for (const para of text.split('\n')) {
      if (!para.trim()) { y += lineHeight; continue; }
      let line = '';
      for (const word of para.split(' ')) {
        const test = line + word + ' ';
        const metrics = ctx.measureText(test);
        if (metrics.width > maxWidth && line) {
          ctx.fillText(line, x, y);
          line = word + ' ';
          y += lineHeight;
        } else {
          line = test;
        }
      }
      ctx.fillText(line, x, y);
      y += lineHeight;
    }
  }

  renderTextPanel(text: string, pageNum: number): OffscreenCanvas {
    const { ctx, width, height, settings } = this;
    const mid = width / 2;
    const scale = height / 1080;
    const pad = 100 * scale;
    const topPad = 140 * scale;
    const color = getAutoColor(settings.rightBackgroundColor);

    ctx.fillStyle = settings.rightBackgroundColor;
    ctx.fillRect(mid, 0, mid, height);
    ctx.fillStyle = color;

    const titleSize = 90 * scale;
    ctx.font = `bold ${titleSize}px 'Sorts Mill Goudy', serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('THE WAY', mid + pad, topPad);
    ctx.fillText('OF SOUNDS', mid + pad, topPad + titleSize * 1.05);

    const volSize = 28 * scale;
    ctx.font = `italic ${volSize}px 'Sorts Mill Goudy', serif`;
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.7;
    ctx.fillText(`VOLUME. ${pageNum < 10 ? '0' + pageNum : pageNum}`, width - pad, topPad);
    ctx.globalAlpha = 1;

    const bodySize = 36 * scale;
    const lineHeight = bodySize * 1.7;
    const bodyTop = topPad + titleSize * 2.5;
    ctx.font = `${bodySize}px 'Sorts Mill Goudy', serif`;
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.5;
    this.wrapText(ctx, text.trim() ? text : PLACEHOLDER, mid + pad, bodyTop, mid - pad * 2, lineHeight);
    ctx.globalAlpha = 1;

    return this.canvas;
  }
}

// --- canvasToRgbaBuffer (copied from StreamingEncoder.ts) ---
export function canvasToRgbaBuffer(
  ctx: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
): Uint8Array {
  const imageData = ctx.getImageData(0, 0, width, height);
  return new Uint8Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.byteLength);
}

// --- Worker State ---
let vizCtx: OffscreenCanvasRenderingContext2D | null = null;
let compositeCtx: OffscreenCanvasRenderingContext2D | null = null;
let particles: any[] = [];
let rainDrops: any[] = [];
let buckets = new Map();
let isAborted = false; // Flag to signal abort

// Define canonical visualizer rendering dimensions
const CANONICAL_VIZ_WIDTH = 960; // Half of 1920
const CANONICAL_VIZ_HEIGHT = 1080;

// --- Message Handler ---
self.onmessage = async (event) => {
  const { type, payload } = event.data;

  if (type === 'init') {
    // Ensure fonts are ready in the worker scope before rendering
    await (self as any).fonts?.ready;

    const { vizCanvas, compositeCanvas, options } = payload;
    vizCtx = vizCanvas.getContext('2d', { alpha: false });
    // Ensure vizCanvas is resized to canonical dimensions if it's not already
    vizCanvas.width = CANONICAL_VIZ_WIDTH;
    vizCanvas.height = CANONICAL_VIZ_HEIGHT;
    compositeCtx = compositeCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    
    // Re-initialize particles and raindrops based on options
    const particleCount = Math.floor(3200 * options.settings.particleDensity * (CANONICAL_VIZ_HEIGHT / 1080)); // viewScale will be 1.0
    particles = initParticles(particleCount, CANONICAL_VIZ_WIDTH, CANONICAL_VIZ_HEIGHT);
    rainDrops = options.variation === VisualizerVariation.FLOW ? initRainDrops(Math.floor(200 * options.settings.particleDensity * (CANONICAL_VIZ_HEIGHT / 1080)), CANONICAL_VIZ_WIDTH, CANONICAL_VIZ_HEIGHT) : [];

    isAborted = false; // Reset abort flag for new render
    await renderLoop(options);
    self.postMessage({ type: 'complete' });

  } else if (type === 'abort') {
    isAborted = true; // Set abort flag
    console.log('Worker received abort signal.');
  }
};

// --- Render Loop Function ---
async function renderLoop(options: {
  width: number;
  height: number;
  settings: VisualizerSettings;
  variation: VisualizerVariation;
  text: string;
  audioData: FrameAudioData[];
  fps: number;
}) {
  const { width, height, settings, variation, text, audioData, fps } = options;

  const mid = width / 2;
  const totalFrames = audioData.length;
  const pageNum = Math.max(1, Math.ceil(text.length / 800));

  const textCache = new TextLayerCache(width, height, settings);
  const textPanel = textCache.renderTextPanel(text, pageNum);

  const BASE_SMOOTH = 0.2; // Match Web Audio hardware smoothing
  const SMOOTH = 1 - Math.pow(1 - BASE_SMOOTH, 60 / fps); // Normalize smoothing for current FPS
  let sBass = 0, sMid = 0, sTreble = 0;
  let sFreq: Float32Array | null = null;
  let freqOut: Uint8Array | null = null;

  for (let i = 0; i < totalFrames; i++) {
    if (isAborted) {
      self.postMessage({ type: 'aborted' });
      return;
    }
    
    const raw = audioData[i];

    if (i === 0) {
      sBass = raw.bass; sMid = raw.mid; sTreble = raw.treble;
      sFreq = new Float32Array(raw.frequencyData);
      freqOut = new Uint8Array(raw.frequencyData.length);
      for (let j = 0; j < sFreq.length; j++) freqOut[j] = Math.round(sFreq[j]);
    } else {
      sBass += (raw.bass - sBass) * SMOOTH;
      sMid += (raw.mid - sMid) * SMOOTH;
      sTreble += (raw.treble - sTreble) * SMOOTH;
      if (sFreq && freqOut) {
        for (let j = 0; j < sFreq.length; j++) {
          sFreq[j] += (raw.frequencyData[j] - sFreq[j]) * SMOOTH;
          freqOut[j] = Math.round(sFreq[j]);
        }
      }
    }

    const audio = {
      frequencyData: freqOut ?? raw.frequencyData,
      bass: sBass, mid: sMid, treble: sTreble,
      amplitude: (sBass + sMid + sTreble) / 3,
      energy: ((sBass + sMid + sTreble) / 3) ** 2,
    };

    if (vizCtx && compositeCtx) {
      // Call renderFrame with canonical dimensions for the visualizer
      renderFrame(vizCtx, variation, settings, audio, i / fps, CANONICAL_VIZ_WIDTH, CANONICAL_VIZ_HEIGHT, particles, rainDrops, { x: CANONICAL_VIZ_WIDTH / 2, y: CANONICAL_VIZ_HEIGHT / 2, scale: 1.8, audioBoost: 1.0, bassBoost: 1.0, trebleBoost: 1.0 }, buckets);

      // Draw the canonical visualizer output onto the composite canvas, scaling it to fit the actual UI panel
      compositeCtx.drawImage(vizCtx.canvas, 0, 0, CANONICAL_VIZ_WIDTH, CANONICAL_VIZ_HEIGHT, 0, 0, mid, height);
      compositeCtx.drawImage(textPanel, mid, 0, mid, height, mid, 0, mid, height);

      const rgbaBuffer = canvasToRgbaBuffer(compositeCtx, width, height);
      (self as any).postMessage({ type: 'frame', payload: rgbaBuffer }, [rgbaBuffer.buffer]); // Transferable
    }

    self.postMessage({ type: 'progress', payload: { currentFrame: i + 1, totalFrames } });
  }
}