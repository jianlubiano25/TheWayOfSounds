import React, { useState, useRef, useEffect } from 'react';
import { AudioSourceType, VisualizerVariation, VisualizerSettings, ExportResolution, RenderFrequencyHz } from '../types';
import { Controls } from './Controls';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlaylistMode = 'separate-videos' | 'single-video';

interface WritingPaneProps {
  audioSource: AudioSourceType;
  variation: VisualizerVariation;
  settings: VisualizerSettings;
  onVariationChange: (v: VisualizerVariation) => void;
  onSettingsChange: (s: VisualizerSettings) => void;
  onMicToggle: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onExport: () => void;
  onStudioRender: () => void;
  isRecording: boolean;
  isStudioRendering: boolean;
  isGeneratingQuote: boolean;
  onGenerateQuote: () => void;
  audioProgress: { current: number; total: number };
  text: string;
  setText: (t: string) => void;
  onApplyPreset: (name: string) => void;
  uiColor: string;
  isPlaying: boolean;
  onTogglePlayback: () => void;
  onSeek: (percent: number) => void;
  // ── Playlist props (new) ──────────────────────────────────────────────────
  playlist?: File[];
  activeTrackIndex?: number;
  playlistMode?: PlaylistMode;
  onPlaylistModeChange?: (mode: PlaylistMode) => void;
  onSwitchTrack?: (idx: number) => void;
  onRemoveTrack?: (idx: number) => void;
  isPreview: boolean;
  onTogglePreview: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const WritingPane: React.FC<WritingPaneProps> = ({
  audioSource, variation, settings, onVariationChange, onSettingsChange,
  onMicToggle, onFileUpload, onExport, onStudioRender,
  isRecording, isStudioRendering, isGeneratingQuote, onGenerateQuote,
  audioProgress, text, setText, onApplyPreset, uiColor,
  isPlaying, onTogglePlayback, onSeek,
  playlist = [], activeTrackIndex = 0, playlistMode = 'separate-videos',
  onPlaylistModeChange, onSwitchTrack, onRemoveTrack,
  isPreview, onTogglePreview,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [panelSize, setPanelSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const updateSize = () => {
      if (containerRef.current) {
        setPanelSize({
          w: containerRef.current.clientWidth,
          h: containerRef.current.clientHeight
        });
      }
    };
    const obs = new ResizeObserver(updateSize);
    obs.observe(containerRef.current);
    updateSize();
    return () => obs.disconnect();
  }, []);

  const [showSettings, setShowSettings] = useState(false);

  const hasPlaylist = playlist.length > 1;

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return '00:00';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const formatDuration = (secs: number) => {
    if (!secs || isNaN(secs)) return '';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const variations = [
    { id: VisualizerVariation.STARS,   label: 'Stars'    },
    { id: VisualizerVariation.FLOW,    label: 'Flow'     },
    { id: VisualizerVariation.GALAXY,  label: 'Galaxy'   },
    { id: VisualizerVariation.LINES,   label: 'Spectrum' },
    { id: VisualizerVariation.CIRCLES, label: 'Rings'    },
    { id: VisualizerVariation.ROSE,    label: 'Rose'     },
  ];

  const presets = ['Void', 'Zen', 'Midnight', 'Desert', 'Abyss', 'B&W'];

  const handleColorChange = (key: keyof VisualizerSettings, value: string | boolean | number) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  // ── Pixel-Perfect Preview Scaling ──────────────────────────────────────────
  const isNarrowLayout = settings.layoutRatio !== '50-50';
  const vizWeight = settings.layoutRatio === '50-50' ? 0.5 : (settings.layoutRatio === '66-33' ? 0.666 : 0.7);
  const layoutScale = isNarrowLayout ? 0.85 : (1 - vizWeight) / 0.5;
  
  const uiScale = isPreview ? panelSize.h / 1080 : 1.0;

  // Calculate logical width based on 16:9 aspect ratio to match export word-wrapping
  const logicalFullWidth = panelSize.h * (16 / 9);
  const logicalTextPaneWidth = logicalFullWidth * (1 - vizWeight);

  const pad      = 100 * uiScale * layoutScale;
  const topPad   = 140 * uiScale;
  const logoSize = 90 * uiScale * layoutScale;
  const metaSize = 28 * uiScale * layoutScale;
  const bodySize = 44 * uiScale * Math.max(0.7, layoutScale);
  
  const maxWidth = logicalTextPaneWidth - (pad * 2);

  const progressPercent = (audioProgress.current / audioProgress.total) * 100 || 0;
  const pageNum = Math.max(1, Math.ceil(text.length / 800));

  return (
    <div
      ref={containerRef}
      className={`min-h-full w-full flex flex-col transition-colors duration-700 relative ${
        isPreview ? 'items-start overflow-hidden select-none' : 'items-center px-6 md:px-24 py-16'
      }`}
      style={{ 
        color: uiColor,
        padding: isPreview ? '0' : undefined
      }}
    >
      {/* ── Preview Toggle Button ────────────────────────────────────────── */}
      <div className="absolute top-8 right-8 z-30 flex items-center space-x-4">
        {isPreview && (
          <div className="flex bg-black/40 p-1 rounded-full border border-white/10 backdrop-blur-sm">
            {(['1080p', '4K'] as ExportResolution[]).map((res) => (
              <button
                key={res}
                onClick={() => onSettingsChange({ ...settings, exportResolution: res })}
                className={`px-3 py-1 text-[9px] uppercase tracking-widest rounded-full transition-all ${
                  settings.exportResolution === res ? 'bg-white text-black font-bold' : 'opacity-40 hover:opacity-100'
                }`}
              >
                {res}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={onTogglePreview}
          className="text-[10px] tracking-[0.3em] uppercase border border-current rounded-full px-6 py-2 hover:bg-white hover:text-black transition-all bg-black/20 backdrop-blur-sm"
        >
          {isPreview ? 'Exit Preview' : 'Preview Export'}
        </button>
      </div>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      {(!isPreview || settings.showTextHeader) && (
        <div className={isPreview ? 'contents' : `w-full flex ${settings.layoutRatio === '50-50' ? 'flex-row' : 'flex-col'} justify-between items-start mb-16 gap-4 opacity-40 transition-all duration-500`}>
          {/* Volume Block */}
          <div 
            className={!isPreview ? (settings.layoutRatio === '50-50' ? 'order-2 items-end' : 'order-1 items-start') : ''}
            style={isPreview ? { 
              position: 'absolute', 
              top: `${topPad}px`,
              left: `${pad}px`,
              opacity: 0.5 
            } : {}}
          >
            {!isPreview && audioSource === AudioSourceType.FILE && (
              <span className="text-[10px] md:text-[12px] tracking-[0.2em] font-mono mb-2">
                {formatTime(audioProgress.current)} / {formatTime(audioProgress.total)}
              </span>
            )}
            <span className={`goudy italic block ${isPreview ? 'uppercase tracking-normal' : 'text-[10px] sm:text-[12px] lg:text-[15px] tracking-[0.3em]'}`}
                  style={isPreview ? { fontSize: `${metaSize}px`, lineHeight: 1.2 } : {}}>
              {isPreview ? `VOLUME. ${pageNum < 10 ? '0' + pageNum : pageNum}` : `VOL. ${pageNum}`}
            </span>
          </div>

          {/* Title Block */}
          <div 
            className={!isPreview ? (settings.layoutRatio === '50-50' ? 'order-1' : 'order-2') : ''}
            style={isPreview ? { 
              position: 'absolute', 
              top: `${topPad + (metaSize * 1.8)}px`,
              left: `${pad}px` 
            } : {}}
          >
            {isPreview ? (
              <div 
                className="flex flex-col goudy uppercase tracking-normal text-left"
                style={{ 
                  fontSize: `${logoSize}px`, 
                  lineHeight: 0.9
                }}
              >
                <span>THE WAY</span>
                <span>OF SOUNDS</span>
              </div>
            ) : (
              <span className="text-[10px] sm:text-[12px] lg:text-[15px] tracking-[0.5em] uppercase truncate max-w-full">
                The Way of Sounds
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Variation selector ─────────────────────────────────────────────── */}
      <div className={`w-full max-w-lg mb-12 flex justify-center transition-all duration-500 ${isPreview ? 'hidden' : 'opacity-100'}`}>
        <div className="relative flex flex-wrap bg-white/5 rounded-2xl md:rounded-full p-1 w-full justify-center gap-1">
          {variations.map((v) => (
            <button
              key={v.id}
              onClick={() => onVariationChange(v.id)}
              className={`flex-1 min-w-[90px] py-2.5 text-[10px] uppercase tracking-[0.2em] rounded-full transition-all duration-300 ${
                variation === v.id ? 'bg-white text-black font-bold' : 'opacity-40 hover:opacity-100'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Text area ──────────────────────────────────────────────────────── */}
      <div className={`w-full group transition-all duration-500 ${
        isPreview ? 'max-w-none flex-grow' : 'max-w-prose flex-grow relative'
      }`}>
        <textarea
          id="writing-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={isPreview ? "" : "Source is everywhere.\nWe are simply the vessel.\nWrite what comes to mind."}
          readOnly={isPreview}
          className={`w-full bg-transparent border-none outline-none resize-none tracking-normal goudy transition-all duration-500 whitespace-pre-wrap p-0 m-0 ${
            isPreview ? 'cursor-default h-full' : 'min-h-[40vh] placeholder:opacity-20'
          }`}
          style={{ 
            color: uiColor,
            fontSize: isPreview ? `${bodySize}px` : undefined,
            lineHeight: isPreview ? 2.0 : undefined,
            position: isPreview ? 'absolute' : 'relative',
            top: isPreview ? `${topPad + (metaSize * 1.8) + (logoSize * 2.2)}px` : undefined,
            left: isPreview ? `${pad}px` : undefined,
            width: isPreview ? `${maxWidth}px` : '100%',
            opacity: isPreview 
              ? (settings.showTextHeader 
                  ? (text.trim() ? 1 : 0.2) 
                  : 0) 
              : 1
          }}
          spellCheck={false}
        />
        {!isPreview && (
          <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-40 transition-opacity">
          <button
            onClick={onGenerateQuote}
            disabled={isGeneratingQuote}
            className={`text-[9px] tracking-[0.4em] uppercase border border-current rounded-full px-4 py-2 hover:bg-white hover:text-black transition-all ${
              isGeneratingQuote ? 'animate-pulse cursor-wait' : ''
            }`}
          >
            {isGeneratingQuote ? 'Invoking...' : 'Invoke Inspiration'}
          </button>
        </div>
        )}
      </div>

      {/* ── Bottom controls ────────────────────────────────────────────────── */}
      <div className={`w-full mt-20 border-t border-white/5 pt-12 flex flex-col items-center transition-all duration-500 ${isPreview ? 'hidden' : 'opacity-100'}`}>

        {/* Playback bar */}
        {audioSource === AudioSourceType.FILE && !hasPlaylist && (
          <div className="w-full max-w-lg mb-12 flex flex-col items-center space-y-6 animate-in fade-in duration-700">
            <div className="flex items-center space-x-8">
              <button
                onClick={onTogglePlayback}
                className="text-[14px] tracking-[0.3em] uppercase opacity-60 hover:opacity-100 transition-opacity flex items-center"
              >
                {isPlaying ? (
                  <span className="flex items-center space-x-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <rect x="4" y="4" width="6" height="16" /><rect x="14" y="4" width="6" height="16" />
                    </svg>
                    <span>Pause</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                    <span>Play</span>
                  </span>
                )}
              </button>
            </div>
            <div className="w-full group relative h-6 flex items-center">
              <input
                type="range" min="0" max="100" step="0.1" value={progressPercent}
                onChange={(e) => onSeek(parseFloat(e.target.value))}
                className="w-full absolute inset-0 opacity-0 cursor-pointer z-10"
              />
              <div className="w-full h-[1px] bg-white/10 relative overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full bg-white/40 transition-all duration-100"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── PLAYLIST PANEL ────────────────────────────────────────────────
            Shown automatically when more than 1 file is loaded.
            This is the primary way to manage tracks and choose export mode.
        ──────────────────────────────────────────────────────────────────── */}
        {hasPlaylist && (
          <div className="w-full max-w-lg mb-10 border border-white/10 rounded-lg overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-500">

            {/* Panel header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-white/5">
              <span className="text-[10px] tracking-[0.4em] uppercase opacity-70">
                Playlist — {playlist.length} Tracks
              </span>
              {/* Export mode toggle */}
              <div className="flex gap-1">
                {(['separate-videos', 'single-video'] as PlaylistMode[]).map((m) => {
                  const active = playlistMode === m;
                  return (
                    <button
                      key={m}
                      onClick={() => onPlaylistModeChange?.(m)}
                      className="text-[9px] tracking-widest uppercase px-3 py-1 rounded transition-all"
                      style={{
                        background:   active ? uiColor : 'transparent',
                        color:        active ? settings.rightBackgroundColor : uiColor,
                        opacity:      active ? 1 : 0.4,
                        border:       `1px solid ${active ? uiColor : 'transparent'}`,
                      }}
                    >
                      {m === 'single-video' ? 'One Video' : 'Per Track'}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Track list */}
            <div className="max-h-52 overflow-y-auto">
              {playlist.map((file, idx) => {
                const isActive = idx === activeTrackIndex;
                return (
                  <div
                    key={idx}
                    onClick={() => onSwitchTrack?.(idx)}
                    className={`flex items-center justify-between px-5 py-3 cursor-pointer transition-all border-b border-white/5 last:border-0 ${
                      isActive ? 'bg-white/8' : 'hover:bg-white/4'
                    }`}
                    style={{ opacity: isActive ? 1 : 0.45 }}
                  >
                    {/* Active indicator dot */}
                    <div className="w-3 flex-shrink-0 mr-3 flex items-center justify-center">
                      {isActive && (
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: uiColor }} />
                      )}
                    </div>

                    {/* Track number */}
                    <span className="text-[9px] font-mono opacity-40 mr-3 flex-shrink-0">
                      {String(idx + 1).padStart(2, '0')}
                    </span>

                    {/* Track name */}
                    <span className="text-[10px] tracking-wide truncate flex-1">
                      {file.name.replace(/\.[^/.]+$/, '')}
                    </span>

                    {/* File size hint */}
                    <span className="text-[9px] opacity-30 font-mono ml-3 flex-shrink-0">
                      {(file.size / 1_000_000).toFixed(1)}mb
                    </span>

                    {/* Remove button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); onRemoveTrack?.(idx); }}
                      className="ml-4 text-[10px] opacity-20 hover:opacity-80 transition-opacity flex-shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Mode description */}
            <div className="px-5 py-3 bg-white/3 border-t border-white/5">
              <p className="text-[9px] tracking-[0.25em] opacity-30 uppercase">
                {playlistMode === 'single-video'
                  ? 'All tracks stitched into one continuous video — FFmpeg audio concat'
                  : `${playlist.length} separate video files — one per track`}
              </p>
            </div>
          </div>
        )}

        {/* Audio source controls */}
        <div className="mb-12">
          <Controls
            onMicToggle={onMicToggle}
            onFileUpload={onFileUpload}
            activeSource={audioSource}
            uiColor={uiColor}
          />
        </div>

        {/* Action buttons row */}
        <div className="flex flex-col items-center space-y-6 mb-8 w-full">
          <div className="flex flex-wrap justify-center gap-6 md:gap-12">
            <button
              onClick={() => setShowSettings((s) => !s)}
              className={`text-[10px] tracking-[0.3em] uppercase transition-opacity ${
                showSettings ? 'opacity-100' : 'opacity-40 hover:opacity-100'
              }`}
            >
              {showSettings ? 'Hide Settings' : 'Settings'}
            </button>

            {audioSource === AudioSourceType.FILE && (
              <button
                onClick={onStudioRender}
                disabled={isStudioRendering}
                className={`text-[10px] tracking-[0.3em] uppercase transition-opacity ${
                  isStudioRendering
                    ? 'opacity-20 cursor-wait animate-pulse'
                    : 'opacity-40 hover:opacity-100'
                }`}
              >
                {isStudioRendering
                  ? 'Rendering…'
                  : hasPlaylist
                    ? `Export Playlist (${playlist.length})`
                    : 'Generate Video'}
              </button>
            )}

            <button
              onClick={onExport}
              className="text-[10px] tracking-[0.3em] uppercase opacity-40 hover:opacity-100"
            >
              {isRecording ? 'Stop Recording' : 'Snapshot UI'}
            </button>
          </div>
        </div>

        {/* ── SETTINGS PANEL ───────────────────────────────────────────────── */}
        {showSettings && (
          <div className="w-full space-y-10 bg-white/5 p-8 rounded-lg border border-white/5 animate-in fade-in slide-in-from-bottom-4 duration-500">

            {/* Presets */}
            <div className="space-y-4">
              <label className="text-[9px] uppercase tracking-widest opacity-40">Visual Presets</label>
              <div className="flex flex-wrap gap-2">
                {presets.map((name) => (
                  <button
                    key={name}
                    onClick={() => onApplyPreset(name)}
                    className="px-3 py-1.5 text-[9px] uppercase tracking-widest border border-white/10 rounded-full hover:bg-white hover:text-black transition-all"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* Colors */}
            <div className="space-y-4">
              <label className="text-[9px] uppercase tracking-widest opacity-40">Colours</label>
              <div className="space-y-4">
                {[
                  { label: 'Visual Background',  key: 'leftBackgroundColor'  },
                  { label: 'Writing Background', key: 'rightBackgroundColor' },
                  { label: 'Accent Color',       key: 'accentColor'          },
                ].map(({ label, key }) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-[10px] tracking-wider opacity-60">{label}</span>
                    <input
                      type="color"
                      value={(settings as any)[key]}
                      onChange={(e) => handleColorChange(key as keyof VisualizerSettings, e.target.value)}
                      className="w-6 h-6 rounded-full overflow-hidden border-none bg-transparent cursor-pointer"
                    />
                  </div>
                ))}

                {/* Cursor toggle */}
                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                  <span className="text-[10px] tracking-wider opacity-60">Cursor Interation</span>
                  <button
                    onClick={() => handleColorChange('enableMouseInteraction', !settings.enableMouseInteraction)}
                    className={`w-10 h-5 rounded-full transition-colors relative ${
                      settings.enableMouseInteraction ? 'bg-white' : 'bg-white/10'
                    }`}
                  >
                    <div
                      className={`absolute top-1 w-3 h-3 rounded-full transition-all ${
                        settings.enableMouseInteraction ? 'left-6 bg-black' : 'left-1 bg-white/40'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Show/Hide Header Toggle */}
            <div className="flex items-center justify-between pt-2 border-t border-white/5">
              <span className="text-[10px] tracking-wider opacity-60">Show Text Pane</span>
              <button
                onClick={() => handleColorChange('showTextHeader', !settings.showTextHeader)}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  settings.showTextHeader ? 'bg-white' : 'bg-white/10'
                }`}
              >
                <div className={`absolute top-1 w-3 h-3 rounded-full transition-all ${settings.showTextHeader ? 'left-6 bg-black' : 'left-1 bg-white/40'}`} />
              </button>
            </div>

            {/* Export Content Toggle */}
            <div className="flex flex-col space-y-3">
              <label className="text-[9px] uppercase tracking-widest opacity-40">Export Content</label>
              <div className="flex bg-black/40 p-1 rounded-md">
                {(['all', 'visualizer-only'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => handleColorChange('exportContent', mode)}
                    className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded transition-colors ${
                      settings.exportContent === mode
                        ? 'bg-white/10 text-white'
                        : 'text-white/30 hover:text-white/60'
                    }`}
                  >
                    {mode === 'all' ? 'Full UI' : 'Visualizer Only'}
                  </button>
                ))}
              </div>
            </div>

            {/* Layout Ratio Selector */}
            <div className="flex flex-col space-y-3">
              <label className="text-[9px] uppercase tracking-widest opacity-40">Layout Ratio Split</label>
              <div className="flex bg-black/40 p-1 rounded-md">
                {(['50-50', '66-33', '70-30'] as const).map((ratio) => (
                  <button
                    key={ratio}
                    onClick={() => handleColorChange('layoutRatio', ratio)}
                    className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded transition-colors ${
                      settings.layoutRatio === ratio
                        ? 'bg-white/10 text-white'
                        : 'text-white/30 hover:text-white/60'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
              <p className="text-[9px] opacity-20 tracking-wider">
                Determines split between Visualizer and Writing pane.
              </p>
            </div>

            {/* Galaxy mode (only when GALAXY variation active) */}
            {variation === VisualizerVariation.GALAXY && (
              <div className="flex flex-col space-y-3">
                <label className="text-[9px] uppercase tracking-widest opacity-40">Galaxy Style</label>
                <div className="flex bg-black/40 p-1 rounded-md">
                  {(['orbital', 'field'] as const).map((mode) => (
                    <button
                      key={mode}
                      onClick={() => onSettingsChange({ ...settings, galaxyMode: mode })}
                      className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded transition-colors ${
                        settings.galaxyMode === mode
                          ? 'bg-white/10 text-white'
                          : 'text-white/30 hover:text-white/60'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Export resolution */}
            <div className="flex flex-col space-y-3">
              <label className="text-[9px] uppercase tracking-widest opacity-40">Export Resolution</label>
              <div className="flex bg-black/40 p-1 rounded-md">
                {(['1080p', '4K'] as ExportResolution[]).map((res) => (
                  <button
                    key={res}
                    onClick={() => onSettingsChange({ ...settings, exportResolution: res })}
                    className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded transition-colors ${
                      settings.exportResolution === res
                        ? 'bg-white/10 text-white'
                        : 'text-white/30 hover:text-white/60'
                    }`}
                  >
                    {res}
                    {res === '4K' && (
                      <span className="ml-1 opacity-40 text-[8px]">~20 Mbps</span>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-[9px] opacity-20 tracking-wider">
                {settings.exportResolution === '4K'
                  ? '3840 × 2160 — allow extra time for long files'
                  : '1920 × 1080 — recommended for most uploads'}
              </p>
            </div>

            {/* Audio render frequency */}
            <div className="flex flex-col space-y-3">
              <label className="text-[9px] uppercase tracking-widest opacity-40">Audio Render Frequency</label>
              <div className="flex bg-black/40 p-1 rounded-md">
                {([432, 741] as RenderFrequencyHz[]).map((hz) => (
                  <button
                    key={hz}
                    onClick={() => handleColorChange('renderFrequencyHz', hz)}
                    className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded transition-colors ${
                      settings.renderFrequencyHz === hz
                        ? 'bg-white/10 text-white'
                        : 'text-white/30 hover:text-white/60'
                    }`}
                  >
                    {hz}hz
                  </button>
                ))}
              </div>
            </div>

            {/* Sliders */}
            <div className="space-y-6">
              {[
                { label: 'Dispersal',      key: 'dispersal',      min: 0.5, max: 5,   step: 0.1 },
                { label: 'Size / Density', key: 'blobSize',       min: 0.2, max: 6,   step: 0.1 },
                { label: 'Energy / Speed', key: 'blobSpeed',      min: 0.1, max: 5,   step: 0.1 },
                { label: 'Particle Density', key: 'particleDensity', min: 0.5, max: 3, step: 0.1 },
                { label: 'Particle Girth',   key: 'particleSize',    min: 0.2, max: 4,   step: 0.1 },
                { label: 'Glow Intensity',   key: 'glowIntensity',   min: 0.0, max: 5,   step: 0.1 },
              ].map(({ label, key, min, max, step }) => (
                <div key={key} className="flex flex-col space-y-2">
                  <label className="text-[9px] uppercase tracking-widest opacity-40">
                    {label}: {((settings as any)[key] as number).toFixed(1)}
                  </label>
                  <input
                    type="range" min={min} max={max} step={step}
                    value={(settings as any)[key]}
                    onChange={(e) => onSettingsChange({ ...settings, [key]: parseFloat(e.target.value) })}
                    className="w-full accent-white"
                  />
                </div>
              ))}
            </div>

          </div>
        )}
      </div>
    </div>
  );
};
