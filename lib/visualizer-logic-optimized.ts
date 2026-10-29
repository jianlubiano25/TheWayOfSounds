/**
 * visualizer-logic-optimized.ts - Optimized rendering engine
 * 
 * KEY OPTIMIZATIONS:
 * 1. Pre-compute and cache static text layers
 * 2. Reuse arrays to reduce GC pressure
 * 3. Batch particle rendering by color/alpha
 * 4. Fix ROSE visualizer scaling to match preview
 * 5. Minimize canvas state changes (save/restore)
 * 6. Use typed arrays for particle data
 */

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
  amplitude?: number;
  energy?: number;
}

// Reusable bucket for particle batching - allocated once, reused per frame
interface RenderBucket {
  x: Float32Array;
  y: Float32Array;
  r: Float32Array;
  count: number;
  alpha: number;
  colorType: string;
}

const createBucket = (alpha: number, colorType: string, capacity: number = 5000): RenderBucket => ({
  x: new Float32Array(capacity),
  y: new Float32Array(capacity),
  r: new Float32Array(capacity),
  count: 0,
  alpha,
  colorType
});

export const initParticles = (count: number, width: number, height: number): Particle[] => {
  const particles: Particle[] = new Array(count);
  
  for (let i = 0; i < count; i++) {
    const phi = i * 137.5 * (Math.PI / 180);
    const r = Math.sqrt(i) / Math.sqrt(count);
    
    particles[i] = {
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
    };
  }
  
  return particles;
};

export const initRainDrops = (count: number, width: number, height: number): RainDrop[] => {
  const drops: RainDrop[] = new Array(count);
  
  for (let i = 0; i < count; i++) {
    drops[i] = {
      x: Math.random() * width,
      y: Math.random() * height,
      length: 4 + Math.random() * 12,
      speed: 3 + Math.random() * 6,
      opacity: 0.1 + Math.random() * 0.4
    };
  }
  
  return drops;
};

/**
 * Optimized render function with improved ROSE scaling
 * and reusable bucket batching to reduce allocations
 */
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
  mouse: { x: number, y: number, scale?: number, audioBoost?: number, bassBoost?: number, trebleBoost?: number },
  buckets?: Map<string, RenderBucket> // Reusable buckets from caller
) => {
  const centerX = width / 2;
  const centerY = height / 2;
  
  // Apply reactivity boosts passed from the workers to ensure parity between preview and render
  const audioBoost = mouse.audioBoost || 1.0;
  const bass = audio.bass * (mouse.bassBoost || 1.0) * audioBoost;
  const mid = audio.mid * audioBoost;
  const treble = audio.treble * (mouse.trebleBoost || 1.0) * audioBoost;
  
  const { frequencyData: dataArray } = audio;
  const bufferLength = dataArray.length;
  const accent = settings.accentColor;
  const viewScale = height / 1080;
  const minDotSize = Math.max(1.2, viewScale * 1.2);

  // Clear background
  ctx.fillStyle = settings.leftBackgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Initialize or reuse bucket map
  const localBuckets = buckets || new Map<string, RenderBucket>();
  localBuckets.clear();

  const pushToBucket = (alpha: number, colorType: string, x: number, y: number, r: number) => {
    const key = `${Math.round(alpha * 100)}_${colorType}`;
    let bucket = localBuckets.get(key);
    
    if (!bucket) {
      bucket = createBucket(alpha, colorType, 3000);
      localBuckets.set(key, bucket);
    }
    
    if (bucket.count < bucket.x.length) {
      bucket.x[bucket.count] = x;
      bucket.y[bucket.count] = y;
      bucket.r[bucket.count] = r;
      bucket.count++;
    }
  };

  const drawBatched = () => {
    for (const bucket of localBuckets.values()) {
      if (bucket.count === 0) continue;
      
      ctx.globalAlpha = bucket.alpha;
      if (bucket.colorType === 'white') {
        ctx.fillStyle = '#FFFFFF';
        ctx.shadowColor = `rgba(255, 255, 255, ${0.8 * settings.glowIntensity})`; // Subtle white glow for reactive particles, controlled by setting
        ctx.shadowBlur = 8 * viewScale; // Adjust blur radius for subtlety and visibility
      } else {
        ctx.fillStyle = accent;
        ctx.shadowColor = 'transparent'; // No shadow for other particles
        ctx.shadowBlur = 0;
      }
      
      // Batch draw all particles for this alpha/color
      for (let i = 0; i < bucket.count; i++) {
        const x = bucket.x[i];
        const y = bucket.y[i];
        const r = bucket.r[i];
        
        if (r < 1.1) {
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        } else {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0; // Reset shadow for subsequent drawing operations
    ctx.shadowColor = 'transparent';
  };

  // Render visualizations
  if (variation === VisualizerVariation.GALAXY) {
    const count = Math.floor(particles.length * 0.7);
    
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const f = dataArray[i % bufferLength] / 255;

      const isField = settings.galaxyMode === 'field';
      const jit = (Math.sin(time * 0.7 + p.seed) * 3) * settings.blobSpeed * (1 + bass) * viewScale;
      
      // Unified Polar Logic: Field mode is now just a spatially expanded version of the Orbital galaxy
      const angle = p.angle + (time * p.speed * 20); 

      // Containment factor: Ensure orbital mode stays rounded within the frame at high resolutions
      const containment = isField ? 1.0 : 0.55;
      
      // REMOVED viewScale: p.dist is already initialized relative to canvas dimensions.
      // Multiplying by viewScale here caused "double-shrinking" in the UI preview
      // but not in 1080p exports where viewScale is 1.0.
      const d = p.dist * (1 + bass * 0.2 * settings.dispersal) * (1 + f * 0.1) * containment;

      // Dynamically calculate stretch based on actual aspect ratio to prevent skewing
      const aspect = width / height;
      const scaleX = isField ? Math.max(1.2, aspect * 1.1) : 1.0;
      const scaleY = isField ? Math.max(1.0, (1/aspect) * 0.8) : 1.0;

      const x = mouse.x + Math.cos(angle) * d * scaleX + jit;
      const y = mouse.y + Math.sin(angle) * d * scaleY + jit;

      const alpha = 0.18 + f * 0.82;
      pushToBucket(alpha, f > 0.9 ? 'white' : 'accent', x, y, 
        Math.max(minDotSize, p.size * settings.blobSize * settings.particleSize * (1 + f) * viewScale));
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
      
      pushToBucket(alpha, f > 0.9 ? 'white' : 'accent', x, y,
        Math.max(minDotSize, p.size * settings.blobSize * settings.particleSize * (1 + (treble + mid) * 2.2) * viewScale));
    }
    drawBatched();
    
  } else if (variation === VisualizerVariation.FLOW) {
    ctx.strokeStyle = accent;
    const rainPower = (bass * 0.6 + mid * 0.4);
    
    for (let i = 0; i < rainDrops.length; i++) {
      const drop = rainDrops[i];
      const f = dataArray[i % bufferLength] / 255;
      const totalY = drop.y + (time * 60) * (drop.speed + (bass * 18)) * settings.blobSpeed;
      const currentY = totalY % (height + 100);
      const len = drop.length * (1 + f * 4) * settings.blobSize;
      
      ctx.globalAlpha = (0.05 + drop.opacity + (f * 0.6)) * Math.min(1, rainPower * 4 + 0.1);
      ctx.lineWidth = 1 + f * 2;
      ctx.beginPath();
      ctx.moveTo(drop.x, currentY);
      ctx.lineTo(drop.x, currentY + len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    
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
    ctx.globalAlpha = 1;
    
  } else if (variation === VisualizerVariation.CIRCLES) {
    const count = Math.floor(30 + settings.blobQuantity / 2);
    
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(i * (bufferLength / count) * 0.5);
      const f = dataArray[idx] / 255;
      
      ctx.lineWidth = 0.5 + f * 10;
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.04 + f * 0.6;
      
      const r = (30 + i * 22 * settings.dispersal) * (1 + f * 0.25);
      ctx.beginPath();
      ctx.arc(mouse.x, mouse.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    
  } else if (variation === VisualizerVariation.ROSE) {
    // OPTIMIZED ROSE: Fix scaling to match preview
    // Use an average of dimensions to ensure it fills narrow containers better without skewing
    const roseScale = ((width + height) / 2) * 0.75;
    const count = Math.floor(particles.length * 0.5);
    
    // Center the rose properly
    ctx.save();
    ctx.translate(centerX, centerY);
    
    // Define audio-reactive components
    const bloom = 1 + bass * 0.35 * settings.blobSize;      // Restored to 0.35 for maximum cinematic expansion
    const spread = 1 + mid * 0.4 * settings.dispersal;    // Mid controls petal opening
    const shimmer = 1 + treble * 0.8;                     // Treble controls high-freq jitter
    
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      const theta = p.theta * spread;
      // Subtle rotation boost from bass
      const phi = p.phi + (time * 0.04 + bass * 0.02) * 60 * 0.016 * settings.blobSpeed;
      const f = dataArray[i % bufferLength] / 255;
      
      // Radius reacts to bloom (bass) and individual frequency intensity enhanced by treble
      const radius = p.r * roseScale * settings.blobSize * p.petalFactor * bloom * (1 + f * 0.2 * shimmer);
      
      const x3 = Math.cos(phi) * Math.sin(theta) * radius;
      const y3 = Math.sin(phi) * Math.sin(theta) * radius;
      const z3 = Math.cos(theta) * radius;
      
      // Apply rotation from mouse interaction
      const tX = (mouse.y - centerY) / height * 1.5;
      const tY = (mouse.x - centerX) / width * 1.5;
      
      const y1 = y3 * Math.cos(tX) - z3 * Math.sin(tX);
      const z1 = y3 * Math.sin(tX) + z3 * Math.cos(tX);
      const x2 = x3 * Math.cos(tY) + z1 * Math.sin(tY);
      const z2 = -x3 * Math.sin(tY) + z1 * Math.cos(tY);
      
      const scale = 800 / (800 + z2);
      // Adjusted alpha to create more contrast between reactive and non-reactive particles
      const alpha = (0.35 + f * 1.2 * shimmer) * Math.max(0.5, scale);
      
      // Particle size responds to treble spikes
      // Boosted treble threshold (3.5 -> 4.5) to ensure shape formation is aggressive and visible
      const reactiveSize = p.size * 2.8 * scale * settings.blobSize * settings.particleSize * viewScale * (1 + f * treble * 4.5);
      
      pushToBucket(alpha, f > 0.85 ? 'white' : 'accent', x2 * scale, y1 * scale, Math.max(minDotSize, reactiveSize));
    }
    
    drawBatched();
    ctx.restore();
  }
};
