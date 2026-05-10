import { VisualizerSettings, VisualizerVariation } from '../types';
import { initParticles, initRainDrops, renderFrame } from './visualizer-logic';
import { FrameAudioData } from './audio-utils';
import { encodeVideo } from './FFmpegEncoder';

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
  fps: number;
  onProgress: (p: RenderProgress) => void;
  signal?: AbortSignal;
}

export const runOfflineRender = async (options: RenderOptions): Promise<{ blob: Blob, extension: string }> => {
  const { width, height, settings, variation, text, audioData, audioFile, fps, onProgress, signal } = options;
  const totalFrames = audioData.length;
  
  // Use HTMLCanvasElement (created off-DOM)
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error("Could not get context");

  const mid = width / 2;
  const scaleFactor = height / 1080;
  
  const pad = 100 * scaleFactor;
  const logoTop = 80 * scaleFactor;
  const textColor = getAutoColor(settings.rightBackgroundColor);

  // Initialize visualizer state
  const particleCount = Math.floor(2500 * settings.particleDensity);
  const particles = initParticles(particleCount, mid, height);
  const rainDrops = variation === VisualizerVariation.FLOW ? initRainDrops(Math.floor(200 * settings.particleDensity), mid, height) : [];

  const frames: Blob[] = [];

  const wrapText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
    const paragraphs = text.split('\n');
    let currentY = y;
    for (const para of paragraphs) {
      if (!para.trim() && paragraphs.length > 1) { currentY += lineHeight; continue; }
      const words = para.split(' ');
      let line = '';
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
          ctx.fillText(line, x, currentY);
          line = words[n] + ' ';
          currentY += lineHeight;
        } else { line = testLine; }
      }
      ctx.fillText(line, x, currentY);
      currentY += lineHeight;
    }
  };

  // STEP 2: Frame Rendering
  onProgress({ percent: 0, currentFrame: 0, totalFrames, status: "Starting Render Engine..." });
  
  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) throw new Error("Render aborted");

    const time = i / fps;
    const audio = audioData[i];

    // 1. Draw Visualizer (Left side)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, mid, height);
    ctx.clip();
    ctx.globalAlpha = 0.9; // Keep visualizer visible
    // Remove translation and scaling to prevent overflow
    renderFrame(ctx, variation, settings, audio, time, mid, height, particles, rainDrops, { x: mid/2, y: height/2 });
    ctx.globalAlpha = 1;
    ctx.restore();

    // 2. Draw Text Panel (Right side)
    ctx.fillStyle = settings.rightBackgroundColor;
    ctx.fillRect(mid, 0, mid, height);

    ctx.fillStyle = textColor;
    // --- Title ---
    // Large, bold, two lines, more top padding
    const topPad = 140 * scaleFactor; // Increased top padding
    const titleFontSize = 90 * scaleFactor;
    ctx.font = `bold ${titleFontSize}px 'Sorts Mill Goudy', serif`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const titleX = mid + pad;
    const titleY = topPad;
    ctx.globalAlpha = 1;
    ctx.fillText('THE WAY', titleX, titleY);
    ctx.fillText('OF SOUND', titleX, titleY + titleFontSize * 1.05);

    // --- Volume (top right, small italic) ---
    const volFontSize = 28 * scaleFactor;
    ctx.font = `italic ${volFontSize}px 'Sorts Mill Goudy', serif`;
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.7;
    const pageNum = Math.max(1, Math.ceil(text.length / 800));
    ctx.fillText(`VOLUME. ${pageNum < 10 ? '0' + pageNum : pageNum}`, width - pad, topPad);
    ctx.globalAlpha = 1;

    // --- Body text (more spaced out, larger line height, more gap from title) ---
    const bodyFontSize = 36 * scaleFactor;
    const lineHeight = bodyFontSize * 1.7; // More line spacing
    const bodyTop = titleY + titleFontSize * 2.5; // More space between title and writing pane
    ctx.font = `${bodyFontSize}px 'Sorts Mill Goudy', serif`;
    ctx.textAlign = 'left';
    const maxWidth = mid - (pad * 2);
    ctx.globalAlpha = 0.5;
    if (text.trim()) {
      wrapText(ctx, text, mid + pad, bodyTop, maxWidth, lineHeight);
    } else {
      wrapText(ctx, "Source is everywhere.\nWe are simply the vessel.\nWrite what comes to mind.", mid + pad, bodyTop, maxWidth, lineHeight);
    }
    ctx.globalAlpha = 1;

    // Capture Frame to Blob (JPEG for memory efficiency)
    // Increased quality to 0.95 to preserve particle definition
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob(b => resolve(b!), 'image/jpeg', 0.95));
    frames.push(blob);

    if (i % 20 === 0) {
      onProgress({
        percent: Math.round((i / totalFrames) * 100),
        currentFrame: i,
        totalFrames,
        status: `Rendering frame ${i} of ${totalFrames}`
      });
      // Yield to UI
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // STEP 3: Video Encoding
  onProgress({ percent: 0, currentFrame: totalFrames, totalFrames, status: "Initializing Encoder..." });
  
  const videoBlob = await encodeVideo({
    frames,
    audioFile,
    fps,
    width,
    height,
    onProgress: (p) => onProgress({
      percent: p,
      currentFrame: totalFrames,
      totalFrames,
      status: `Encoding Video... ${p}%`
    })
  });

  return { blob: videoBlob, extension: 'mp4' };
};

function getAutoColor(hexcolor: string) {
  if (!hexcolor) return '#ffffff';
  let r = parseInt(hexcolor.substring(1, 3), 16);
  let g = parseInt(hexcolor.substring(3, 5), 16);
  let b = parseInt(hexcolor.substring(5, 7), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return yiq >= 128 ? '#1A1512' : '#F9F9F9';
}
