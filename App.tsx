/// <reference types="vite/client" />

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Visualizer } from './components/Visualizer';
import { WritingPane } from './components/WritingPane';
import { CustomCursor } from './components/CustomCursor';
import { AudioSourceType, VisualizerVariation, VisualizerSettings, ExportResolution } from './types';

import {
  runOfflineRender,
  runPlaylistRender,
  RenderProgress,
} from './lib/OfflineRenderer-optimized';
import {
  analyzeAudioBufferOptimized,
  analyzeMultipleFiles,
  analyzeFileForExport,
} from './lib/audio-utils-optimized';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getAutoColor = (hexcolor: string) => {
  if (!hexcolor) return '#ffffff';
  const r = parseInt(hexcolor.substring(1, 3), 16);
  const g = parseInt(hexcolor.substring(3, 5), 16);
  const b = parseInt(hexcolor.substring(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? '#1A1512' : '#F9F9F9';
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: VisualizerSettings = {
  leftBackgroundColor:  '#000000',
  rightBackgroundColor: '#000000',
  accentColor:          '#ffffff',
  blobSize:             1,
  blobSpeed:            1,
  blobQuantity:         40,
  particleDensity:      1.5,
  particleSize:         1.0,
  glowIntensity:        1.0,
  dispersal:            1.0,
  exportResolution:     '1080p',
  galaxyMode:           'orbital',
  enableMouseInteraction: true,
  renderFrequencyHz:    432,
  layoutRatio:          '50-50',
  exportContent:        'all',
  showTextHeader:       true,
};

export const VISUAL_PRESETS: Record<string, Partial<VisualizerSettings>> = {
  'Void':    { leftBackgroundColor: '#000000', rightBackgroundColor: '#000000', accentColor: '#ffffff', blobSize: 1.2, blobSpeed: 1.5, dispersal: 1.2, particleSize: 1.0, glowIntensity: 1.0 },
  'Zen':     { leftBackgroundColor: '#FDFBF7', rightBackgroundColor: '#FDFBF7', accentColor: '#2A2A2A', blobSize: 2.0, blobSpeed: 0.4, dispersal: 0.8, particleSize: 0.8, glowIntensity: 0.6 },
  'Midnight':{ leftBackgroundColor: '#00050A', rightBackgroundColor: '#00050A', accentColor: '#00A3FF', blobSize: 0.8, blobSpeed: 1.2, dispersal: 1.5, particleSize: 1.1, glowIntensity: 1.2 },
  'Desert':  { leftBackgroundColor: '#F4E7D3', rightBackgroundColor: '#F4E7D3', accentColor: '#4A3728', blobSize: 1.5, blobSpeed: 0.6, dispersal: 2.5, particleSize: 1.2, glowIntensity: 0.8 },
  'Abyss':   { leftBackgroundColor: '#001219', rightBackgroundColor: '#001219', accentColor: '#94D2BD', blobSize: 0.5, blobSpeed: 0.3, dispersal: 3.0, particleSize: 0.6, glowIntensity: 1.5 },
  'B&W':     { leftBackgroundColor: '#FFFFFF', rightBackgroundColor: '#000000', accentColor: '#FFFFFF', blobSize: 1.0, blobSpeed: 1.0, dispersal: 1.0, particleSize: 1.0, glowIntensity: 1.0 },
};

const PLACEHOLDER_TEXT = 'Source is everywhere.\nWe are simply the vessel.\nWrite what comes to mind.';

const INSPIRATION_QUOTES = [
  'Life moves in frequencies. Breathe slowly, and let your inner sound return to harmony.',
  'Stillness is a doorway. Enter gently, and the noise around you becomes a teacher.',
  'Every breath carries a quiet rhythm. Listen closely, and peace begins to organize itself.',
  'Your spirit knows the way back to calm. Let sound guide what words cannot reach.',
  'Relax into the present moment. The body softens when the soul feels heard.',
  'In silence, every frequency becomes clearer. Let the calm tone inside you rise.',
  'The heart is an instrument of light. Tune it with patience, breath, and kindness.',
  'Meditation begins with one honest pause. Stay there, and inspiration will meet you.',
  'Good energy does not need to rush. It arrives softly, like sound through open space.',
  'Let life become less heavy. Follow the gentle frequency that brings you back home.',
  'The Way of Sounds begins within. Listen, breathe, and let harmony shape the moment.',
  'Calm is not far away. It is the quiet frequency waiting beneath your thoughts.',
];

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) => {
  for (const para of text.split('\n')) {
    if (!para.trim()) { y += lineHeight; continue; }
    let line = '';
    for (const word of para.split(' ')) {
      const testLine = line + word + ' ';
      if (ctx.measureText(testLine).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = word + ' ';
        y += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, y);
    y += lineHeight;
  }
};

// ─── Playlist mode type ───────────────────────────────────────────────────────

type PlaylistMode = 'single-video' | 'separate-videos';

// ─── Component ────────────────────────────────────────────────────────────────

const App: React.FC = () => {
  // ── Audio / playback state ─────────────────────────────────────────────────
  const [audioSource, setAudioSource]   = useState<AudioSourceType>(AudioSourceType.NONE);
  const [analyzer, setAnalyzer]         = useState<AnalyserNode | null>(null);
  const [audioFile, setAudioFile]       = useState<File | null>(null);
  const [audioBuffer, setAudioBuffer]   = useState<AudioBuffer | null>(null);
  const [audioProgress, setAudioProgress] = useState({ current: 0, total: 0 });
  const [isPlaying, setIsPlaying]       = useState(false);

  // ── Playlist state ─────────────────────────────────────────────────────────
  const [playlist, setPlaylist]                 = useState<File[]>([]);
  const [playlistMode, setPlaylistMode]         = useState<PlaylistMode>('separate-videos');
  const [activeTrackIndex, setActiveTrackIndex] = useState<number>(0);

  // ── Visual / render state ──────────────────────────────────────────────────
  const [variation, setVariation]       = useState<VisualizerVariation>(VisualizerVariation.GALAXY);
  const [settings, setSettings]         = useState<VisualizerSettings>(DEFAULT_SETTINGS);
  const [isRecording, setIsRecording]   = useState(false);
  const [isStudioRendering, setIsStudioRendering] = useState(false);
  const [renderProgress, setRenderProgress]       = useState<RenderProgress | null>(null);
  const [batchProgress, setBatchProgress]         = useState<{ current: number; total: number } | null>(null);
  const [isPreview, setIsPreview]                 = useState(false);

  // ── Text / quote state ────────────────────────────────────────────────────
  const [text, setText]                         = useState('');
  const [isGeneratingQuote, setIsGeneratingQuote] = useState(false);

  // ── Error state ───────────────────────────────────────────────────────────
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const textRef              = useRef(text);
  const settingsRef          = useRef(settings);
  const isStudioRenderingRef = useRef(isStudioRendering);
  const audioContextRef      = useRef<AudioContext | null>(null);
  const sourceNodeRef        = useRef<AudioNode | null>(null);
  const streamRef            = useRef<MediaStream | null>(null);
  const audioTagRef          = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef     = useRef<MediaRecorder | null>(null);
  const compositeCanvasRef   = useRef<HTMLCanvasElement | null>(null);
  const visualizerCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  const compositeAnimRef     = useRef<number | null>(null);
  const abortControllerRef   = useRef<AbortController | null>(null);
  const isGeneratingQuoteRef = useRef(false);
  const nextQuoteIndexRef    = useRef(Math.floor(Math.random() * INSPIRATION_QUOTES.length));

  useEffect(() => { textRef.current = text; },               [text]);
  useEffect(() => { settingsRef.current = settings; },       [settings]);
  useEffect(() => { isStudioRenderingRef.current = isStudioRendering; }, [isStudioRendering]);

  const uiColor = getAutoColor(settings.rightBackgroundColor);

  // ─────────────────────────────────────────────────────────────────────────
  // Audio helpers
  // ─────────────────────────────────────────────────────────────────────────

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop();
    if (compositeAnimRef.current) {
      cancelAnimationFrame(compositeAnimRef.current);
      clearTimeout(compositeAnimRef.current);
    }
  }, []);

  const cleanup = useCallback(() => {
    setErrorMessage(null);
    setIsPlaying(false);
    stopRecording();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    if (audioTagRef.current) {
      audioTagRef.current.pause();
      audioTagRef.current.src = '';
      audioTagRef.current.load();
    }
  }, [stopRecording]);

  const initAudio = useCallback(
    async (type: AudioSourceType, file?: File) => {
      cleanup();
      try {
        if (!audioContextRef.current)
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') await ctx.resume();

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
          audio.crossOrigin = 'anonymous';
          audioTagRef.current = audio;
          const source = ctx.createMediaElementSource(audio);
          source.connect(newAnalyzer);
          newAnalyzer.connect(ctx.destination);
          sourceNodeRef.current = source;

          audio.addEventListener('timeupdate', () =>
            setAudioProgress({ current: audio.currentTime, total: audio.duration || 0 }),
          );
          audio.addEventListener('play',  () => setIsPlaying(true));
          audio.addEventListener('pause', () => setIsPlaying(false));
          audio.addEventListener('ended', () => {
            setIsPlaying(false);
            if (isStudioRenderingRef.current) stopRecording();
          });
          audio.addEventListener('loadedmetadata', async () => {
            if (ctx.state === 'suspended') await ctx.resume();
            try { await audio.play(); setIsPlaying(true); } catch (_) {}
          }, { once: true });

          setAnalyzer(newAnalyzer);
          setAudioSource(AudioSourceType.FILE);
        }
      } catch (err: any) {
        setErrorMessage('Audio failed. Check microphone access or file format.');
        setAudioSource(AudioSourceType.NONE);
      }
    },
    [cleanup, stopRecording],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Live composite canvas (preview only — not used during offline render)
  // ─────────────────────────────────────────────────────────────────────────

  const drawLiveCompositeFrame = useCallback(() => {
    const canvas = compositeCanvasRef.current;
    const sourceCanvas = visualizerCanvasRef.current;
    if (!canvas || !sourceCanvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const curSettings = settingsRef.current;
    const curText     = textRef.current;
    const { width, height } = canvas;

    const isVizOnly  = curSettings.exportContent === 'visualizer-only';
    let vizWeight    = 0.5;
    if (!isVizOnly) {
      if (curSettings.layoutRatio === '66-33') vizWeight = 0.666;
      else if (curSettings.layoutRatio === '70-30') vizWeight = 0.7;
    } else {
      vizWeight = 1.0;
    }

    const textWeight  = 1 - vizWeight;
    const isNarrow    = !isVizOnly && curSettings.layoutRatio !== '50-50';
    const layoutScale = isVizOnly ? 1.0 : (isNarrow ? 0.85 : textWeight / 0.5);

    const mid = width * vizWeight;
    const textPaneWidth = width - mid;

    ctx.fillStyle = curSettings.leftBackgroundColor;
    ctx.fillRect(0, 0, mid, height);

    const sAspect = sourceCanvas.width / sourceCanvas.height;
    const tAspect = mid / height;
    let sW = sourceCanvas.width, sH = sourceCanvas.height, sX = 0, sY = 0;
    if (sAspect > tAspect) { sW = sH * tAspect; sX = (sourceCanvas.width - sW) / 2; }
    else                   { sH = sW / tAspect; sY = (sourceCanvas.height - sH) / 2; }
    ctx.drawImage(sourceCanvas, sX, sY, sW, sH, 0, 0, mid, height);

    if (isVizOnly) {
      compositeAnimRef.current = requestAnimationFrame(drawLiveCompositeFrame);
      return;
    }

    if (curSettings.showTextHeader) {
      ctx.fillStyle = curSettings.rightBackgroundColor;
      ctx.fillRect(mid, 0, textPaneWidth, height);

      const scale    = height / 1080;
      const pad      = 100 * scale * layoutScale;
      const topPad   = 140 * scale;
      const color   = getAutoColor(curSettings.rightBackgroundColor);
      const pageNum = Math.max(1, Math.ceil(curText.length / 800));
      
      const logoSize = 90 * scale * layoutScale;
      const metaSize = 28 * scale * layoutScale;
      const bodySize = 44 * scale * Math.max(0.7, layoutScale);
      
      let bodyTop = topPad;

      ctx.fillStyle = color;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      
      // Unified stacked header logic: Volume -> Title -> Quote
      ctx.font = `italic ${metaSize}px "Sorts Mill Goudy"`;
      ctx.globalAlpha = 0.5;
      ctx.fillText(`VOLUME. ${pageNum < 10 ? '0' + pageNum : pageNum}`, mid + pad, topPad);
      ctx.globalAlpha = 1.0;

      const titleTop = topPad + metaSize * 1.8;
      ctx.font = `${logoSize}px "Sorts Mill Goudy"`;
      ctx.fillText('THE WAY',  mid + pad, titleTop);
      ctx.fillText('OF SOUNDS', mid + pad, titleTop + logoSize * 0.9);
      bodyTop = titleTop + logoSize * 2.2;

      const lineHeight = bodySize * 2.0;
      ctx.font = `${bodySize}px "Sorts Mill Goudy"`;
      ctx.textAlign = 'left';
      const maxWidth = textPaneWidth - pad * 2;

      if (!curText.trim()) {
        ctx.globalAlpha = 0.2;
        wrapText(ctx, PLACEHOLDER_TEXT, mid + pad, bodyTop, maxWidth, lineHeight);
        ctx.globalAlpha = 1;
      } else {
        wrapText(ctx, curText, mid + pad, bodyTop, maxWidth, lineHeight);
      }
    }

    compositeAnimRef.current = requestAnimationFrame(drawLiveCompositeFrame);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Export / render
  // ─────────────────────────────────────────────────────────────────────────

const startExport = async (studio: boolean = false) => {
  setErrorMessage(null);

  const electronAPI  = (window as any).electronAPI;
  const is4K         = settings.exportResolution === '4K';
  const outputWidth  = is4K ? 3840 : 1920;
  const outputHeight = is4K ? 2160 : 1080;
  // Render worker always uses 1920×1080. FFmpeg scales to 4K on output.
  const RENDER_W = 1920;
  const RENDER_H = 1080;

  try {
    // ── Preview capture (non-studio) ─────────────────────────────────────
    if (!studio) {
      const cCanvas = document.createElement('canvas');
      cCanvas.width  = RENDER_W;
      cCanvas.height = RENDER_H;
      compositeCanvasRef.current = cCanvas;
      drawLiveCompositeFrame();

      const stream   = (cCanvas as any).captureStream(30);
      const recorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 12_000_000,
      });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `WayOfSound-Preview-${Date.now()}.webm`;
        a.click();
        setIsRecording(false);
        if (compositeAnimRef.current) cancelAnimationFrame(compositeAnimRef.current);
      };
      recorder.start();
      setIsRecording(true);
      setTimeout(() => recorder.stop(), 5000);
      return;
    }

    // ── Studio render ────────────────────────────────────────────────────
    if (!electronAPI) {
      setErrorMessage('Studio Render requires the Desktop App.');
      return;
    }

    const hasPlaylist = playlist.length > 1;
    const hasAudio    = !!audioBuffer && !!audioFile;

    if (!hasPlaylist && !hasAudio) {
      setErrorMessage('Please upload an audio file first.');
      return;
    }

    abortControllerRef.current = new AbortController();
    setIsStudioRendering(true);

    // ── SINGLE FILE ──────────────────────────────────────────────────────
    if (!hasPlaylist) {
      const dateStr  = new Date().toISOString().split('T')[0];
      const baseName = audioFile!.name.replace(/\.[^/.]+$/, '');

      const outputPath = await electronAPI.saveDialog({
        title:       'Save Studio Render',
        defaultPath: `TheWayOfSound-${baseName}-${dateStr}.mp4`,
        filters:     [{ name: 'Movies', extensions: ['mp4'] }],
      });
      if (!outputPath) { setIsStudioRendering(false); return; }

      setRenderProgress({ percent: 0, currentFrame: 0, totalFrames: 0, status: 'Analyzing audio…' });

      // v4: analyzeFileForExport handles long/short routing + fps selection
      const { audioData, fps } = await analyzeFileForExport(
        audioFile!,
        30,  // requested fps (may be reduced to 24 for long files)
        (fraction) =>
          setRenderProgress({
            percent:      Math.round(fraction * 10),
            currentFrame: 0,
            totalFrames:  0,
            status:       `Analyzing audio… ${Math.round(fraction * 100)}%`,
          }),
      );

      if (abortControllerRef.current.signal.aborted) return;

      const savedPath = await runOfflineRender({
        width: outputWidth,
        height: outputHeight,
        settings, variation, text,
        audioData,
        audioFile: audioFile!,
        outputPath,
        fps,   // ← use the fps returned by analyzeFileForExport
        onProgress: setRenderProgress,
        signal: abortControllerRef.current.signal,
      });

      if (savedPath) alert(`Export complete!\n${savedPath}`);
      return;
    }

    // ── PLAYLIST ─────────────────────────────────────────────────────────
    setBatchProgress({ current: 0, total: playlist.length });
    setRenderProgress({ percent: 0, currentFrame: 0, totalFrames: 0, status: 'Analyzing playlist…' });

    // v4: Pre-analyze the entire playlist to ensure consistent FPS across the set
    const { audioDataPerFile, fps: commonFps } = await analyzeMultipleFiles(
      playlist,
      30,
      (fraction) =>
        setRenderProgress({
          percent:      Math.round(fraction * 10),
          currentFrame: 0,
          totalFrames:  0,
          status:       `Analyzing playlist… ${Math.round(fraction * 100)}%`,
        }),
    );

    if (abortControllerRef.current.signal.aborted) return;

    const dateStr = new Date().toISOString().split('T')[0];

    if (playlistMode === 'single-video') {
      const outputPath = await electronAPI.saveDialog({
        title:       'Save Playlist (Single Video)',
        defaultPath: `TheWayOfSound-Playlist-${dateStr}.mp4`,
        filters:     [{ name: 'Movies', extensions: ['mp4'] }],
      });
      if (!outputPath) { setIsStudioRendering(false); return; }

      const savedPaths = await runPlaylistRender({
        mode:   'single',
        files:  playlist,
        audioDataPerFile,
        outputPath,
        width: outputWidth,
        height: outputHeight,
        settings, variation, text,
        fps:    commonFps,
        onProgress: (p) => {
          setRenderProgress(p);
          const match = p.status.match(/track (\d+)\//i);
          if (match) setBatchProgress({ current: parseInt(match[1], 10), total: playlist.length });
        },
        signal: abortControllerRef.current.signal,
      });

      if (savedPaths.length) alert(`Playlist export complete!\n${savedPaths[0]}`);

    } else {
      const folder = await electronAPI.selectFolder();
      if (!folder) { setIsStudioRendering(false); return; }

      const outputPaths = playlist.map((file) => {
        const name = file.name.replace(/\.[^/.]+$/, '');
        // NOTE: 'path' module not available in renderer.
        // Use string join — works on Mac/Linux. Windows users: replace / with \.
        return `${folder}/${`TheWayOfSound-${name}-${dateStr}.mp4`}`;
      });

      const savedPaths = await runPlaylistRender({
        mode:        'separate',
        files:       playlist,
        audioDataPerFile,
        outputPaths,
        width: outputWidth,
        height: outputHeight,
        settings, variation, text,
        fps:         commonFps,
        onProgress: (p) => {
          setRenderProgress(p);
          const match = p.status.match(/Track (\d+)\//);
          if (match) setBatchProgress({ current: parseInt(match[1], 10), total: playlist.length });
        },
        signal: abortControllerRef.current.signal,
      });

      alert(`Batch export complete!\n${savedPaths.length} videos saved.`);
    }

  } catch (err: any) {
    if (err?.message !== 'Render aborted') {
      console.error('Export error:', err);
      setErrorMessage('Export failed: ' + (err?.message || String(err)));
    }
  } finally {
    setIsStudioRendering(false);
    setRenderProgress(null);
    setBatchProgress(null);
    abortControllerRef.current = null;
  }
};
  // ─────────────────────────────────────────────────────────────────────────
  // Playlist management helpers
  // ─────────────────────────────────────────────────────────────────────────

  const handlePlaylistUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (!files.length) return;

      if (files.length === 1) {
        // Single file — use existing single-file path
        initAudio(AudioSourceType.FILE, files[0]);
        setPlaylist([]);
      } else {
        // Multiple files — load first track for preview, store all in playlist
        initAudio(AudioSourceType.FILE, files[0]);
        setPlaylist(files);
        setActiveTrackIndex(0);
      }
      e.target.value = '';
    },
    [initAudio],
  );

  const switchTrack = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= playlist.length) return;
      setActiveTrackIndex(idx);
      initAudio(AudioSourceType.FILE, playlist[idx]);
    },
    [playlist, initAudio],
  );

  const removeFromPlaylist = useCallback(
    (idx: number) => {
      setPlaylist((prev) => {
        const next = prev.filter((_, i) => i !== idx);
        if (next.length === 0) setAudioFile(null);
        return next;
      });
    },
    [],
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Quote generation
  // ─────────────────────────────────────────────────────────────────────────

  const formatText = (input: string) => input.trim();

  const generateQuote = useCallback(async () => {
    if (isGeneratingQuoteRef.current) return;

    isGeneratingQuoteRef.current = true;
    setErrorMessage(null);
    setIsGeneratingQuote(true);

    const quote = INSPIRATION_QUOTES[nextQuoteIndexRef.current % INSPIRATION_QUOTES.length];
    nextQuoteIndexRef.current += 1;
    setText((prev) => prev.trim() ? prev + '\n\n' + formatText(quote) : formatText(quote));

    window.setTimeout(() => {
      isGeneratingQuoteRef.current = false;
      setIsGeneratingQuote(false);
    }, 250);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  let vizFlex = '1';
  let writingFlex = '1';

  const isVizOnlyExport = settings.exportContent === 'visualizer-only';
  
  if (isPreview && isVizOnlyExport) {
    vizFlex = '1';
    writingFlex = '0';
  } else {
    if (settings.layoutRatio === '66-33') { vizFlex = '2'; writingFlex = '1'; }
    else if (settings.layoutRatio === '70-30') { vizFlex = '7'; writingFlex = '3'; }
  }

  return (
    <div
      className={`flex flex-col md:flex-row h-screen w-full overflow-hidden goudy selection:bg-white selection:text-black ${
        settings.enableMouseInteraction ? 'cursor-none-all' : ''
      }`}
    >
      {settings.enableMouseInteraction && <CustomCursor accentColor={uiColor} />}

      {/* ── Visualizer panel ─────────────────────────────────────────────── */}
      <div
        className="relative w-full h-1/2 md:h-full transition-colors duration-700 overflow-hidden flex-basis-0"
        style={{ backgroundColor: settings.leftBackgroundColor, flex: vizFlex }}
      >
        <Visualizer
          analyzer={analyzer}
          variation={variation}
          settings={settings}
          isStudioRendering={isStudioRendering}
          onCanvasReady={(canvas) => { visualizerCanvasRef.current = canvas; }}
        />

        {/* Studio render overlay */}
        {isStudioRendering && (
          <div className="absolute inset-0 bg-black/95 z-50 flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-500">
            <div className="w-24 h-24 border-2 border-white/10 border-t-white rounded-full animate-spin mb-8" />
            <h2 className="text-[14px] tracking-[0.6em] uppercase mb-4">
              {batchProgress
                ? `Batch Render — Track ${batchProgress.current} of ${batchProgress.total}`
                : 'Studio Rendering'}
            </h2>

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
              Offline rendering active. OffscreenCanvas → FFmpeg hardware encoder.
              UI remains responsive during export.
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

      {/* ── Writing / controls panel ──────────────────────────────────────── */}
      <div
        className={`w-full h-1/2 md:h-full overflow-y-auto relative transition-colors duration-700 flex-basis-0 ${
          isPreview && isVizOnlyExport ? 'hidden' : 'block'
        }`}
        style={{ backgroundColor: settings.rightBackgroundColor, flex: writingFlex }}
      >
        <WritingPane
          audioSource={audioSource}
          variation={variation}
          settings={settings}
          onVariationChange={setVariation}
          onSettingsChange={setSettings}
          onMicToggle={() =>
            audioSource === AudioSourceType.MICROPHONE
              ? cleanup()
              : initAudio(AudioSourceType.MICROPHONE)
          }
          onFileUpload={handlePlaylistUpload}
          onExport={() => startExport(false)}
          onStudioRender={() => startExport(true)}
          isRecording={isRecording}
          isStudioRendering={isStudioRendering}
          isGeneratingQuote={isGeneratingQuote}
          onGenerateQuote={generateQuote}
          audioProgress={audioProgress}
          text={text}
          setText={setText}
          onApplyPreset={(name) => {
            const p = VISUAL_PRESETS[name];
            if (p) setSettings((prev) => ({ ...prev, ...p }));
          }}
          uiColor={uiColor}
          isPlaying={isPlaying}
          onTogglePlayback={() =>
            audioTagRef.current?.paused
              ? audioTagRef.current.play()
              : audioTagRef.current?.pause()
          }
          onSeek={(p) => {
            if (audioTagRef.current)
              audioTagRef.current.currentTime = (p / 100) * audioTagRef.current.duration;
          }}
          playlist={playlist}
          activeTrackIndex={activeTrackIndex}
          playlistMode={playlistMode}
          onPlaylistModeChange={setPlaylistMode}
          onSwitchTrack={switchTrack}
          onRemoveTrack={removeFromPlaylist}
          isPreview={isPreview}
          onTogglePreview={() => setIsPreview(!isPreview)}
        />

        {/* Error toast */}
        {errorMessage && (
          <div className="fixed bottom-8 right-8 bg-red-900/80 backdrop-blur px-6 py-3 border border-red-500/20 text-[10px] tracking-widest uppercase text-white z-[100]">
            {errorMessage}
          </div>
        )}
      </div>

      {/* Floating Exit Button for full-screen preview */}
      {isPreview && isVizOnlyExport && (
        <button
          onClick={() => setIsPreview(false)}
          className="fixed top-8 right-8 z-[100] text-[10px] tracking-[0.3em] uppercase border border-white/20 rounded-full px-6 py-2 hover:bg-white hover:text-black transition-all bg-black/20 backdrop-blur-sm"
          style={{ color: uiColor }}
        >
          Exit Preview
        </button>
      )}
    </div>
  );
};

export default App;
