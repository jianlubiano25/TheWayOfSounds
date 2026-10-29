
import React, { useRef, useEffect } from 'react';
import { VisualizerVariation, VisualizerSettings } from '../types';
import { initParticles, initRainDrops, renderFrame, Particle, RainDrop } from '../lib/visualizer-logic-optimized';

interface VisualizerProps {
  analyzer: AnalyserNode | null;
  variation: VisualizerVariation;
  settings: VisualizerSettings;
  isStudioRendering?: boolean;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}

export const Visualizer: React.FC<VisualizerProps> = ({ analyzer, variation, settings, isStudioRendering, onCanvasReady }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const particlesRef = useRef<Particle[]>([]);
  const rainDropsRef = useRef<RainDrop[]>([]);
  const bucketsRef = useRef<Map<string, any>>(new Map()); // Reusable bucket cache for particle batching
  
  const mouseRef = useRef({ x: 0, y: 0, active: false });
  const easedMouseRef = useRef({ x: 0, y: 0 });
  const audioSmoothingRef = useRef({ bass: 0, mid: 0, treble: 0 });

  useEffect(() => {
    if (canvasRef.current && onCanvasReady) {
      onCanvasReady(canvasRef.current);
    }
  }, [onCanvasReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.parentElement?.clientWidth || window.innerWidth;
    const height = canvas.parentElement?.clientHeight || window.innerHeight;

    const count = Math.floor(2500 * settings.particleDensity);
    particlesRef.current = initParticles(count, width, height);

    if (variation === VisualizerVariation.FLOW) {
      rainDropsRef.current = initRainDrops(Math.floor(200 * settings.particleDensity), width, height);
    }
  }, [variation, settings.particleDensity]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const inX = e.clientX - rect.left;
      const inY = e.clientY - rect.top;
      mouseRef.current = { x: inX, y: inY, active: (inX >= 0 && inX <= rect.width && inY >= 0 && inY <= rect.height) };
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const displayWidth = canvas.parentElement?.clientWidth || window.innerWidth;
      const displayHeight = canvas.parentElement?.clientHeight || window.innerHeight;
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    window.addEventListener('resize', resize);
    resize();

    const render = (timestamp: number) => {
      if (isStudioRendering) {
        return;
      }
      const time = analyzer ? analyzer.context.currentTime : timestamp * 0.001;
      
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      const centerX = width / 2;
      const centerY = height / 2;
      
      const { active, x: mx, y: my } = mouseRef.current;
      const useMouse = active && settings.enableMouseInteraction;
      const targetX = useMouse ? mx : centerX;
      const targetY = useMouse ? my : centerY;
      easedMouseRef.current.x += (targetX - easedMouseRef.current.x) * 0.1;
      easedMouseRef.current.y += (targetY - easedMouseRef.current.y) * 0.1;

      const bufferLength = analyzer ? analyzer.frequencyBinCount : 0;
      const dataArray = analyzer ? new Uint8Array(bufferLength) : new Uint8Array(512);
      if (analyzer && dataArray) {
        analyzer.getByteFrequencyData(dataArray);
        const bLimit = Math.floor(bufferLength * 0.05);
        const mLimit = Math.floor(bufferLength * 0.25);
        let b = 0, m = 0, t = 0;
        for (let i = 0; i < bLimit; i++) b += dataArray[i];
        for (let i = bLimit; i < mLimit; i++) m += dataArray[i];
        for (let i = mLimit; i < bufferLength; i++) t += dataArray[i];
        const smooth = 0.15;
        audioSmoothingRef.current.bass += ((b / Math.max(1, bLimit)) / 255 - audioSmoothingRef.current.bass) * smooth;
        audioSmoothingRef.current.mid += ((m / Math.max(1, mLimit - bLimit)) / 255 - audioSmoothingRef.current.mid) * smooth;
        audioSmoothingRef.current.treble += ((t / Math.max(1, bufferLength - mLimit)) / 255 - audioSmoothingRef.current.treble) * smooth;
      }

      renderFrame(
        ctx,
        variation,
        settings,
        {
          bass: audioSmoothingRef.current.bass,
          mid: audioSmoothingRef.current.mid,
          treble: audioSmoothingRef.current.treble,
          frequencyData: dataArray
        },
        time,
        width,
        height,
        particlesRef.current,
        rainDropsRef.current,
        easedMouseRef.current,
        bucketsRef.current // Pass reusable buckets
      );

      animationRef.current = requestAnimationFrame(render);
    };
    
    animationRef.current = requestAnimationFrame(render);
    return () => {
      window.removeEventListener('resize', resize);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current as any);
      }
    };
  }, [analyzer, variation, settings]);

  return (
    <div className="w-full h-full bg-black touch-none overflow-hidden">
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
};
