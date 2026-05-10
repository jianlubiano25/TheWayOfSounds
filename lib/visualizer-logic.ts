import { VisualizerVariation, VisualizerSettings } from '../types';

export interface Particle {
  x: number;
  y: number;
  size: number;
  angle: number;
  dist: number;
  speed: number;
  seed: number;
  phi: number;
  theta: number;
  r: number;
  petalFactor: number;
}

export interface RainDrop {
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
}

export interface AudioData {
  bass: number;
  mid: number;
  treble: number;
  frequencyData: Uint8Array;
}

export const initParticles = (count: number, width: number, height: number): Particle[] => {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const phi = i * 137.5 * (Math.PI / 180);
    const r = Math.sqrt(i) / Math.sqrt(count);
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 0.6 + Math.random() * 0.6,
      angle: Math.random() * Math.PI * 2,
      dist: Math.random() * Math.max(width, height) * 0.7,
      speed: (0.0001 + Math.random() * 0.0004) * (Math.random() > 0.5 ? 1 : -1),
      seed: Math.random() * Math.PI * 2,
      phi,
      theta: r * Math.PI * 0.5,
      r,
      petalFactor: Math.cos(phi * 7 + r * 15) * 0.2 + 0.8
    });
  }
  return particles;
};

export const initRainDrops = (count: number, width: number, height: number): RainDrop[] => {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    length: 4 + Math.random() * 12,
    speed: 3 + Math.random() * 6,
    opacity: 0.1 + Math.random() * 0.4
  }));
};

export const renderFrame = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  variation: VisualizerVariation,
  settings: VisualizerSettings,
  audio: AudioData,
  time: number,
  width: number,
  height: number,
  particles: Particle[],
  rainDrops: RainDrop[],
  mouse: { x: number, y: number }
) => {
  const centerX = width / 2;
  const centerY = height / 2;
  const { bass, mid, treble, frequencyData: dataArray } = audio;
  const bufferLength = dataArray.length;
  const accent = settings.accentColor;
  const viewScale = height / 1080; // Scale relative to 1080p
  const minDotSize = Math.max(1.2, viewScale * 1.2); // Increase minimum dot size for high-res

  ctx.fillStyle = settings.leftBackgroundColor;
  ctx.fillRect(0, 0, width, height);

  let alphaBuckets: Record<string, {x: number, y: number, r: number}[]> = {};

  const pushToBucket = (alpha: number, colorType: string, x: number, y: number, r: number) => {
    const key = `${alpha.toFixed(2)}_${colorType}`; // Use fixed precision for better batching
    if (!alphaBuckets[key]) alphaBuckets[key] = [];
    alphaBuckets[key].push({ x, y, r });
  };

  const drawBatched = () => {
    Object.entries(alphaBuckets).forEach(([key, bucket]) => {
      const [alphaStr, colorType] = key.split('_');
      ctx.globalAlpha = Math.min(1, parseFloat(alphaStr));
      ctx.fillStyle = colorType === 'white' ? '#FFFFFF' : accent;
      ctx.beginPath();
      bucket.forEach(p => {
        if (p.r < 1.1) {
          ctx.rect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
        } else {
          ctx.moveTo(p.x + p.r, p.y);
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        }
      });
      ctx.fill();
    });
  };

  if (variation === VisualizerVariation.GALAXY) {
    const count = Math.floor(particles.length * 0.7);
    const spinEnergy = 0.1;
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const f = dataArray[i % bufferLength] / 255;
      const angle = p.angle + (time * 0.5) * (p.speed + (bass * 0.004)) * settings.blobSpeed * spinEnergy * 100; 
      const jit = (Math.sin(time * 0.7 + p.seed) * 3) * settings.blobSpeed * (1 + bass);
      const d = p.dist * (1 + bass * 0.2 * settings.dispersal) * (1 + f * 0.1) * viewScale;
      const x = mouse.x + Math.cos(angle) * d + jit * viewScale;
      const y = mouse.y + Math.sin(angle) * d + jit * viewScale;
      const alpha = 0.18 + f * 0.82; // Higher base alpha for more visible dots
      pushToBucket(alpha, f > 0.9 ? 'white' : 'accent', x, y, Math.max(minDotSize, p.size * settings.blobSize * (1 + f) * viewScale));
    }
    drawBatched();
  } else if (variation === VisualizerVariation.STARS) {
    const count = Math.min(particles.length, 1200);
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const f = dataArray[i % bufferLength] / 255;
      const x = p.x + Math.sin(time * 0.4 + p.seed) * 2 * settings.blobSpeed;
      const y = p.y + Math.cos(time * 0.4 + p.seed) * 2 * settings.blobSpeed;
      const alpha = 0.22 + f * 0.78;
      pushToBucket(alpha, f > 0.9 ? 'white' : 'accent', x, y, Math.max(minDotSize, p.size * settings.blobSize * (1 + (treble + mid) * 2.2) * viewScale));
    }
    drawBatched();
  } else if (variation === VisualizerVariation.FLOW) {
    ctx.strokeStyle = accent;
    const rainPower = (bass * 0.6 + mid * 0.4);
    rainDrops.forEach((drop, i) => {
      const f = dataArray[i % bufferLength] / 255;
      // Note: We need a way to increment drop.y in a stateless way for offline render or keep state
      // For now, calculating based on time
      const totalY = drop.y + (time * 60) * (drop.speed + (bass * 18)) * settings.blobSpeed;
      const currentY = totalY % (height + 100);
      const len = drop.length * (1 + f * 4) * settings.blobSize;
      ctx.globalAlpha = (0.05 + drop.opacity + (f * 0.6)) * Math.min(1, rainPower * 4 + 0.1);
      ctx.lineWidth = 1 + f * 2;
      ctx.beginPath(); ctx.moveTo(drop.x, currentY); ctx.lineTo(drop.x, currentY + len); ctx.stroke();
    });
  } else if (variation === VisualizerVariation.LINES) {
    const num = Math.floor(120 * (particles.length / 2500));
    const barSpacing = (width * 0.42) / num;
    ctx.fillStyle = accent;
    for (let i = 0; i < num; i++) {
      const idx = Math.floor(i * (bufferLength / num) * 0.8);
      const f = dataArray[idx] / 255;
      const h = Math.max(1, Math.pow(f, 1.15) * height * 0.8 * settings.blobSize);
      ctx.globalAlpha = 0.15 + f * 0.85;
      const bw = Math.max(1, barSpacing * 0.75);
      ctx.fillRect(centerX + (i * barSpacing), centerY - h / 2, bw, h);
      ctx.fillRect(centerX - (i * barSpacing) - bw, centerY - h / 2, bw, h);
    }
  } else if (variation === VisualizerVariation.CIRCLES) {
    const count = Math.floor(30 + settings.blobQuantity / 2);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(i * (bufferLength / count) * 0.5);
      const f = dataArray[idx] / 255;
      ctx.lineWidth = 0.5 + f * 10;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.04 + f * 0.6;
      const r = (30 + i * 22 * settings.dispersal) * (1 + f * 0.25);
      ctx.beginPath(); ctx.arc(mouse.x, mouse.y, r, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (variation === VisualizerVariation.ROSE) {
    const tX = (mouse.y - centerY) / height * 1.5;
    const tY = (mouse.x - centerX) / width * 1.5;
    const bloom = 1 + bass * 0.8 * settings.blobSize;
    const count = Math.floor(particles.length * 0.5);

    ctx.save();
    ctx.translate(centerX, centerY);
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const theta = p.theta * (1 + mid * 0.5 * settings.dispersal);
      const phi = p.phi + time * 0.04 * 60 * 0.016 * settings.blobSpeed;
      const f = dataArray[i % bufferLength] / 255;
      const radius = p.r * 300 * bloom * p.petalFactor * (1 + f * 0.2);
      
      const x3 = Math.cos(phi) * Math.sin(theta) * radius;
      const y3 = Math.sin(phi) * Math.sin(theta) * radius;
      const z3 = Math.cos(theta) * radius;
      
      const y1 = y3 * Math.cos(tX) - z3 * Math.sin(tX);
      const z1 = y3 * Math.sin(tX) + z3 * Math.cos(tX);
      const x2 = x3 * Math.cos(tY) + z1 * Math.sin(tY);
      const z2 = -x3 * Math.sin(tY) + z1 * Math.cos(tY);
      
      const scale = 800 / (800 + z2);
      const alpha = (0.22 + f * 0.78) * Math.max(0.2, scale);
      pushToBucket(alpha, f > 0.9 ? 'white' : 'accent', x2 * scale, y1 * scale, Math.max(minDotSize, p.size * scale * settings.blobSize * viewScale));
    }
    drawBatched();
    ctx.restore();
  }
};
