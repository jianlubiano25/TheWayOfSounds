
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Visualizer } from './components/Visualizer';
import { WritingPane } from './components/WritingPane';
import { CustomCursor } from './components/CustomCursor';
import { AudioSourceType, VisualizerVariation, VisualizerSettings, ExportResolution } from './types';
import { GoogleGenAI } from "@google/genai";

import { runOfflineRender, RenderProgress } from './lib/OfflineRenderer';
import { analyzeAudioBuffer } from './lib/audio-utils';

const getAutoColor = (hexcolor: string) => {
  if (!hexcolor) return '#ffffff';
  let r = parseInt(hexcolor.substring(1, 3), 16);
  let g = parseInt(hexcolor.substring(3, 5), 16);
  let b = parseInt(hexcolor.substring(5, 7), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return yiq >= 128 ? '#1A1512' : '#F9F9F9';
};

const DEFAULT_SETTINGS: VisualizerSettings = {
  leftBackgroundColor: '#000000',
  rightBackgroundColor: '#000000',
  accentColor: '#ffffff',
  blobSize: 1,
  blobSpeed: 1,
  blobQuantity: 40,
  particleDensity: 1.5,
  dispersal: 1.0,
  exportResolution: '1080p',
  enableMouseInteraction: true
};

export const VISUAL_PRESETS: Record<string, Partial<VisualizerSettings>> = {
  'Void': { leftBackgroundColor: '#000000', rightBackgroundColor: '#000000', accentColor: '#ffffff', blobSize: 1.2, blobSpeed: 1.5, dispersal: 1.2 },
  'Zen': { leftBackgroundColor: '#FDFBF7', rightBackgroundColor: '#FDFBF7', accentColor: '#2A2A2A', blobSize: 2.0, blobSpeed: 0.4, dispersal: 0.8 },
  'Midnight': { leftBackgroundColor: '#00050A', rightBackgroundColor: '#00050A', accentColor: '#00A3FF', blobSize: 0.8, blobSpeed: 1.2, dispersal: 1.5 },
  'Desert': { leftBackgroundColor: '#F4E7D3', rightBackgroundColor: '#F4E7D3', accentColor: '#4A3728', blobSize: 1.5, blobSpeed: 0.6, dispersal: 2.5 },
  'Abyss': { leftBackgroundColor: '#001219', rightBackgroundColor: '#001219', accentColor: '#94D2BD', blobSize: 0.5, blobSpeed: 0.3, dispersal: 3.0 },
  'B&W': { leftBackgroundColor: '#FFFFFF', rightBackgroundColor: '#000000', accentColor: '#FFFFFF', blobSize: 1.0, blobSpeed: 1.0, dispersal: 1.0 }
};

const PLACEHOLDER_TEXT = "Source is everywhere.\nWe are simply the vessel.\nWrite what comes to mind.";

const wrapText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
  const paragraphs = text.split('\n');
  let currentY = y;
  
  for (const para of paragraphs) {
    if (!para.trim() && paragraphs.length > 1) {
      currentY += lineHeight;
      continue;
    }
    const words = para.split(' ');
    let line = '';
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && n > 0) {
        ctx.fillText(line, x, currentY);
        line = words[n] + ' ';
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
    currentY += lineHeight;
  }
};

const App: React.FC = () => {
  const [audioSource, setAudioSource] = useState<AudioSourceType>(AudioSourceType.NONE);
  const [variation, setVariation] = useState<VisualizerVariation>(VisualizerVariation.GALAXY);
  const [analyzer, setAnalyzer] = useState<AnalyserNode | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<VisualizerSettings>(DEFAULT_SETTINGS);
  const [isRecording, setIsRecording] = useState(false);
  const [isStudioRendering, setIsStudioRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isGeneratingQuote, setIsGeneratingQuote] = useState(false);
  const [audioProgress, setAudioProgress] = useState({ current: 0, total: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [text, setText] = useState('');
  
  const textRef = useRef(text);
  const settingsRef = useRef(settings);
  const isStudioRenderingRef = useRef(isStudioRendering);
  
  useEffect(() => { textRef.current = text; }, [text]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { isStudioRenderingRef.current = isStudioRendering; }, [isStudioRendering]);

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioTagRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const visualizerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeAnimRef = useRef<number | null>(null);

  const uiColor = getAutoColor(settings.rightBackgroundColor);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (compositeAnimRef.current) {
      cancelAnimationFrame(compositeAnimRef.current);
      clearTimeout(compositeAnimRef.current);
    }
  }, []);

  const cleanup = useCallback(() => {
    setErrorMessage(null);
    setIsPlaying(false);
    stopRecording();
    if (streamRef.current) { streamRef.current.getTracks().forEach(track => track.stop()); streamRef.current = null; }
    if (sourceNodeRef.current) { sourceNodeRef.current.disconnect(); sourceNodeRef.current = null; }
    if (audioTagRef.current) { audioTagRef.current.pause(); audioTagRef.current.src = ""; audioTagRef.current.load(); }
  }, [stopRecording]);

  const initAudio = useCallback(async (type: AudioSourceType, file?: File) => {
    cleanup();
    try {
      if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioContextRef.current;
      
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      
      const newAnalyzer = ctx.createAnalyser();
      newAnalyzer.fftSize = 1024;

      if (type === AudioSourceType.MICROPHONE) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(newAnalyzer);
        sourceNodeRef.current = source;
        setAnalyzer(newAnalyzer);
        setAudioSource(AudioSourceType.MICROPHONE);
        setAudioFile(null);
        setAudioBuffer(null);
        setIsPlaying(true);
      } else if (type === AudioSourceType.FILE && file) {
        setAudioFile(file);
        const arrayBuffer = await file.arrayBuffer();
        const buffer = await ctx.decodeAudioData(arrayBuffer);
        setAudioBuffer(buffer);

        const url = URL.createObjectURL(file);
        const audio = new Audio(url);
        audio.crossOrigin = "anonymous";
        audioTagRef.current = audio;
        const source = ctx.createMediaElementSource(audio);
        source.connect(newAnalyzer);
        newAnalyzer.connect(ctx.destination);
        sourceNodeRef.current = source;
        
        audio.addEventListener('timeupdate', () => setAudioProgress({ current: audio.currentTime, total: audio.duration || 0 }));
        audio.addEventListener('play', () => setIsPlaying(true));
        audio.addEventListener('pause', () => setIsPlaying(false));
        audio.addEventListener('ended', () => {
          setIsPlaying(false);
          if (isStudioRenderingRef.current) stopRecording();
        });
        
        audio.addEventListener('loadedmetadata', async () => {
          if (ctx.state === 'suspended') await ctx.resume();
          try {
            await audio.play();
            setIsPlaying(true);
          } catch (e) {
            console.error("Autoplay prevented:", e);
          }
        }, { once: true });
        
        setAnalyzer(newAnalyzer);
        setAudioSource(AudioSourceType.FILE);
      }
    } catch (err: any) {
      setErrorMessage("Audio failed. Please ensure microphone access or valid file.");
      setAudioSource(AudioSourceType.NONE);
    }
  }, [cleanup, isStudioRendering, stopRecording]);

  const drawCompositeFrame = useCallback(() => {
    const canvas = compositeCanvasRef.current;
    const sourceCanvas = visualizerCanvasRef.current;
    if (!canvas || !sourceCanvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const curSettings = settingsRef.current;
    const curText = textRef.current;
    const { width, height } = canvas;
    const mid = width / 2;

    // Fast static clearing
    ctx.fillStyle = curSettings.leftBackgroundColor;
    ctx.fillRect(0, 0, mid, height);
    
    // Draw visualizer with proper aspect matching
    const sAspect = sourceCanvas.width / sourceCanvas.height;
    const tAspect = mid / height;
    let sW = sourceCanvas.width, sH = sourceCanvas.height, sX = 0, sY = 0;
    if (sAspect > tAspect) {
      sW = sH * tAspect;
      sX = (sourceCanvas.width - sW) / 2;
    } else {
      sH = sW / tAspect;
      sY = (sourceCanvas.height - sH) / 2;
    }
    ctx.drawImage(sourceCanvas, sX, sY, sW, sH, 0, 0, mid, height);

    ctx.fillStyle = curSettings.rightBackgroundColor;
    ctx.fillRect(mid, 0, mid, height);

    const is4K = width > 2000;
    const pad = is4K ? 240 : 120;
    const textColor = getAutoColor(curSettings.rightBackgroundColor);
    ctx.fillStyle = textColor;
    
    const logoSize = is4K ? 180 : 90;
    ctx.font = `bold ${logoSize}px "Sorts Mill Goudy"`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText("THE WAY", mid + pad, pad);
    ctx.fillText("OF SOUND", mid + pad, pad + logoSize * 0.9);

    const metaSize = is4K ? 48 : 24;
    ctx.font = `italic ${metaSize}px "Sorts Mill Goudy"`;
    ctx.textAlign = 'right';
    ctx.globalAlpha = 0.5;
    const pageNum = Math.max(1, Math.ceil(curText.length / 800));
    ctx.fillText(`VOLUME. ${pageNum < 10 ? '0' + pageNum : pageNum}`, width - pad, pad);
    ctx.globalAlpha = 1;

    const bodySize = is4K ? 80 : 40;
    const lineHeight = bodySize * 1.6;
    const bodyTop = pad + logoSize * 2.8;
    ctx.font = `${bodySize}px "Sorts Mill Goudy"`;
    ctx.textAlign = 'left';
    const maxWidth = mid - (pad * 2);
    
    if (!curText.trim()) {
      ctx.globalAlpha = 0.2;
      wrapText(ctx, PLACEHOLDER_TEXT, mid + pad, bodyTop, maxWidth, lineHeight);
      ctx.globalAlpha = 1;
    } else {
      wrapText(ctx, curText, mid + pad, bodyTop, maxWidth, lineHeight);
    }

    if (isStudioRenderingRef.current) {
      // Use setTimeout when rendering to attempt to keep processing in background
      compositeAnimRef.current = window.setTimeout(drawCompositeFrame, 1000 / 60) as any;
    } else {
      compositeAnimRef.current = requestAnimationFrame(drawCompositeFrame);
    }
  }, []);

  const abortControllerRef = useRef<AbortController | null>(null);

  const startExport = async (studio: boolean = false) => {
    try {
      if (!studio) {
        // Legacy snapshot UI logic (keeps it for quick captures)
        setErrorMessage(null);
        const is4K = settings.exportResolution === '4K';
        const width = is4K ? 3840 : 1920;
        const height = is4K ? 2160 : 1080;
        const cCanvas = document.createElement('canvas');
        cCanvas.width = width; cCanvas.height = height;
        compositeCanvasRef.current = cCanvas;
        drawCompositeFrame();
        const stream = (cCanvas as any).captureStream(60);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: is4K ? 50000000 : 25000000 });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `WayOfSound-UI-${Date.now()}.webm`;
          a.click();
          setIsRecording(false);
          if (compositeAnimRef.current) cancelAnimationFrame(compositeAnimRef.current);
        };
        recorder.start();
        setIsRecording(true);
        setTimeout(() => recorder.stop(), 5000);
        return;
      }

      // NEW Studio Render Logic (Offline)
      if (!audioBuffer || !audioFile) {
        setErrorMessage("Please upload an audio file first for Studio Render.");
        return;
      }

      abortControllerRef.current = new AbortController();
      setIsStudioRendering(true);
      setRenderProgress({ percent: 0, currentFrame: 0, totalFrames: 0, status: "Analyzing Audio..." });

      // 1. Analyze Audio Offline (30fps as requested)
      const fps = 30;
      const analyzedData = await analyzeAudioBuffer(audioBuffer, fps);

      if (abortControllerRef.current.signal.aborted) return;

      // 2. Run Offline Render
      const is4K = settings.exportResolution === '4K';
      const width = 1920; 
      const height = 1080; 
      const scale = is4K ? 2 : 1;
      
      const { blob, extension } = await runOfflineRender({
        width: width * scale,
        height: height * scale,
        settings,
        variation,
        text,
        audioData: analyzedData,
        audioFile: audioFile,
        fps,
        onProgress: setRenderProgress,
        signal: abortControllerRef.current.signal
      });

      // 3. Download
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `WayOfSound-Studio-${Date.now()}.${extension}`;
      a.click();

    } catch (err: any) {
      if (err?.message !== "Render aborted") {
        console.error("Export error:", err);
        setErrorMessage("Export error: " + (err?.message || JSON.stringify(err) || String(err)));
      }
    } finally {
      setIsStudioRendering(false);
      setRenderProgress(null);
      abortControllerRef.current = null;
    }
  };

  const formatText = (input: string) => {
    return input
      .replace(/([.,])\s*(?!\n)/g, '$1\n')
      .replace(/\n\s+/g, '\n');
  };

  const generateQuote = useCallback(async () => {
    setIsGeneratingQuote(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "Generate a short contemplative poetic quote about art, silence, or sound. Max 15 words.",
      });
      const quote = response.text?.trim().replace(/^["']|["']$/g, '');
      if (quote) {
        const processedQuote = formatText(quote);
        setText(prev => (prev.trim() ? prev + "\n\n" + processedQuote : processedQuote));
      }
    } catch (error) {
      setErrorMessage("Inspiration failed.");
    } finally {
      setIsGeneratingQuote(false);
    }
  }, [formatText]);

  return (
    <div className={`flex flex-col md:flex-row h-screen w-full overflow-hidden goudy selection:bg-white selection:text-black ${settings.enableMouseInteraction ? 'cursor-none-all' : ''}`}>
      {settings.enableMouseInteraction && <CustomCursor accentColor={uiColor} />}
      <div 
        className="relative w-full md:w-1/2 h-1/2 md:h-full transition-colors duration-700 overflow-hidden"
        style={{ backgroundColor: settings.leftBackgroundColor }}
      >
        <Visualizer 
          analyzer={analyzer} 
          variation={variation} 
          settings={settings} 
          isStudioRendering={isStudioRendering}
          onCanvasReady={(canvas) => visualizerCanvasRef.current = canvas}
        />
        {isStudioRendering && (
          <div className="absolute inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
             <div className="w-24 h-24 border-2 border-white/10 border-t-white rounded-full animate-spin mb-8" />
             <h2 className="text-[14px] tracking-[0.6em] uppercase mb-4">Studio Rendering</h2>
             
             {renderProgress && (
               <div className="w-full max-w-xs space-y-4">
                 <div className="h-[1px] w-full bg-white/10 relative overflow-hidden">
                    <div 
                      className="absolute left-0 top-0 h-full bg-white transition-all duration-300"
                      style={{ width: `${renderProgress.percent}%` }}
                    />
                 </div>
                 <div className="flex justify-between text-[10px] tracking-widest opacity-40 uppercase">
                    <span>{renderProgress.status}</span>
                    <span>{renderProgress.percent}%</span>
                 </div>
               </div>
             )}

             <p className="text-[11px] tracking-widest opacity-20 uppercase max-w-xs mt-12">
               Offline rendering sequence initialized. Leveraging OffscreenCanvas for high-fidelity export. 
               This process is faster than real-time and avoids display capture lag.
             </p>

             <button 
               onClick={() => abortControllerRef.current?.abort()}
               className="mt-12 text-[10px] tracking-[0.4em] uppercase border border-white/20 px-8 py-3 rounded-full hover:bg-white hover:text-black transition-all"
             >
               Cancel Export
             </button>
          </div>
        )}
      </div>
      <div 
        className="w-full md:w-1/2 h-1/2 md:h-full overflow-y-auto relative transition-colors duration-700"
        style={{ backgroundColor: settings.rightBackgroundColor }}
      >
        <WritingPane 
          audioSource={audioSource} variation={variation} settings={settings}
          onVariationChange={setVariation} onSettingsChange={setSettings}
          onMicToggle={() => audioSource === AudioSourceType.MICROPHONE ? cleanup() : initAudio(AudioSourceType.MICROPHONE)}
          onFileUpload={(e) => { 
            const f = e.target.files?.[0]; 
            if (f) initAudio(AudioSourceType.FILE, f);
            e.target.value = ''; 
          }}
          onExport={() => startExport(false)}
          onStudioRender={() => startExport(true)}
          isRecording={isRecording} isStudioRendering={isStudioRendering}
          isGeneratingQuote={isGeneratingQuote}
          onGenerateQuote={generateQuote}
          audioProgress={audioProgress} text={text} setText={setText}
          onApplyPreset={(name) => { const p = VISUAL_PRESETS[name]; if (p) setSettings(prev => ({ ...prev, ...p })); }}
          uiColor={uiColor}
          isPlaying={isPlaying} onTogglePlayback={() => audioTagRef.current?.paused ? audioTagRef.current.play() : audioTagRef.current?.pause()} 
          onSeek={(p) => { if (audioTagRef.current) audioTagRef.current.currentTime = (p/100) * audioTagRef.current.duration; }}
        />
        {errorMessage && (
           <div className="fixed bottom-8 right-8 bg-red-900/80 backdrop-blur px-6 py-3 border border-red-500/20 text-[10px] tracking-widest uppercase text-white z-[100]">
             {errorMessage}
           </div>
        )}
      </div>
    </div>
  );
};

export default App;
