
import React, { useState } from 'react';
import { AudioSourceType, VisualizerVariation, VisualizerSettings, ExportResolution } from '../types';
import { Controls } from './Controls';

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
}

export const WritingPane: React.FC<WritingPaneProps> = ({ 
  audioSource, variation, settings, onVariationChange, onSettingsChange,
  onMicToggle, onFileUpload, onExport, onStudioRender,
  isRecording, isStudioRendering, isGeneratingQuote, onGenerateQuote,
  audioProgress, text, setText, onApplyPreset, uiColor,
  isPlaying, onTogglePlayback, onSeek
}) => {
  const [showSettings, setShowSettings] = useState(false);
  
  const formatTime = (time: number) => {
    if (isNaN(time)) return '00:00';
    const mins = Math.floor(time / 60); const secs = Math.floor(time % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const variations = [
    { id: VisualizerVariation.STARS, label: 'Stars' },
    { id: VisualizerVariation.FLOW, label: 'Flow' },
    { id: VisualizerVariation.GALAXY, label: 'Galaxy' },
    { id: VisualizerVariation.LINES, label: 'Spectrum' },
    { id: VisualizerVariation.CIRCLES, label: 'Rings' },
    { id: VisualizerVariation.ROSE, label: 'Rose' }
  ];

  const presets = ['Void', 'Zen', 'Midnight', 'Desert', 'Abyss', 'B&W'];

  const handleColorChange = (key: keyof VisualizerSettings, value: string | boolean) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  const progressPercent = (audioProgress.current / audioProgress.total) * 100 || 0;

  return (
    <div className="min-h-full w-full px-6 md:px-24 py-16 flex flex-col items-center" style={{ color: uiColor }}>
      <div className="w-full flex justify-between items-baseline mb-16 opacity-40">
        <span className="text-[12px] md:text-[14px] tracking-[0.5em] uppercase">The Way of Sound</span>
        <div className="flex space-x-4 items-baseline">
          {audioSource === AudioSourceType.FILE && (
             <span className="text-[10px] md:text-[12px] tracking-[0.2em] font-mono">
               {formatTime(audioProgress.current)} / {formatTime(audioProgress.total)}
             </span>
          )}
          <span className="text-[12px] md:text-[14px] tracking-[0.3em] font-serif italic">VOL. {Math.max(1, Math.ceil(text.length / 800))}</span>
        </div>
      </div>

      <div className="w-full max-w-lg mb-12 flex justify-center">
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

      <div className="max-w-prose w-full flex-grow relative group">
        <textarea
          id="writing-area"
          value={text}
          onChange={(e) => {
            const val = e.target.value;
            // Automatically add newline after period or comma followed by space
            const processed = val.replace(/([.,])\s+(?!\n)/g, '$1\n');
            setText(processed);
          }}
          placeholder={"Source is everywhere.\nWe are simply the vessel.\nWrite what comes to mind."}
          className="w-full min-h-[40vh] bg-transparent border-none outline-none resize-none text-[24px] md:text-[28px] leading-[1.8] tracking-wide placeholder:opacity-20 goudy transition-all duration-500 whitespace-pre-wrap"
          spellCheck={false}
          style={{ color: uiColor }}
        />
        
        <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-40 transition-opacity">
          <button 
            onClick={onGenerateQuote}
            disabled={isGeneratingQuote}
            className={`text-[9px] tracking-[0.4em] uppercase border border-current rounded-full px-4 py-2 hover:bg-white hover:text-black transition-all ${isGeneratingQuote ? 'animate-pulse cursor-wait' : ''}`}
          >
            {isGeneratingQuote ? 'Invoking...' : 'Invoke Inspiration'}
          </button>
        </div>
      </div>

      <div className="w-full mt-20 border-t border-white/5 pt-12 flex flex-col items-center">
        
        {/* Playback Controls Section */}
        {audioSource === AudioSourceType.FILE && (
          <div className="w-full max-w-lg mb-12 flex flex-col items-center space-y-6 animate-in fade-in duration-700">
            <div className="flex items-center space-x-8">
              <button 
                onClick={onTogglePlayback}
                className="text-[14px] tracking-[0.3em] uppercase opacity-60 hover:opacity-100 transition-opacity flex items-center"
              >
                {isPlaying ? (
                  <span className="flex items-center space-x-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="6" height="16"/><rect x="14" y="4" width="6" height="16"/></svg>
                    <span>Pause</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-2">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    <span>Play</span>
                  </span>
                )}
              </button>
            </div>
            
            <div className="w-full group relative h-6 flex items-center">
              <input 
                type="range" 
                min="0" 
                max="100" 
                step="0.1" 
                value={progressPercent}
                onChange={(e) => onSeek(parseFloat(e.target.value))}
                className="w-full absolute inset-0 opacity-0 cursor-pointer z-10"
              />
              <div className="w-full h-[1px] bg-white/10 relative overflow-hidden">
                <div 
                  className="absolute left-0 top-0 h-full bg-white/40 transition-all duration-100"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div 
                className="absolute w-2 h-2 rounded-full bg-white opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity -translate-x-1/2"
                style={{ left: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        <div className="mb-12">
          <Controls onMicToggle={onMicToggle} onFileUpload={onFileUpload} activeSource={audioSource} uiColor={uiColor} />
        </div>

        <div className="flex flex-col items-center space-y-6 mb-8 w-full">
          <div className="flex flex-wrap justify-center gap-6 md:gap-12">
            <button onClick={() => setShowSettings(!showSettings)} className={`text-[10px] tracking-[0.3em] uppercase transition-opacity ${showSettings ? 'opacity-100' : 'opacity-40 hover:opacity-100'}`}>
              Settings
            </button>
            {audioSource === AudioSourceType.FILE && (
              <button onClick={onStudioRender} disabled={isStudioRendering} className="text-[10px] tracking-[0.3em] uppercase opacity-40 hover:opacity-100">
                Generate Video
              </button>
            )}
            <button onClick={onExport} className="text-[10px] tracking-[0.3em] uppercase opacity-40 hover:opacity-100">
              {isRecording ? 'Stop Recording' : 'Snapshot UI'}
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="w-full max-sm space-y-10 bg-white/5 p-8 rounded-lg border border-white/5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="space-y-4">
              <label className="text-[9px] uppercase tracking-widest opacity-40">Presets</label>
              <div className="flex flex-wrap gap-2">
                {presets.map(name => (
                  <button key={name} onClick={() => onApplyPreset(name)} className="px-3 py-1.5 text-[9px] uppercase tracking-widest border border-white/10 rounded-full hover:bg-white hover:text-black transition-all">
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6">
              <div className="space-y-4">
                <label className="text-[9px] uppercase tracking-widest opacity-40">Aesthetics</label>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] tracking-wider opacity-60">Visual Background</span>
                    <input 
                      type="color" 
                      value={settings.leftBackgroundColor} 
                      onChange={(e) => handleColorChange('leftBackgroundColor', e.target.value)}
                      className="w-6 h-6 rounded-full overflow-hidden border-none bg-transparent cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] tracking-wider opacity-60">Writing Background</span>
                    <input 
                      type="color" 
                      value={settings.rightBackgroundColor} 
                      onChange={(e) => handleColorChange('rightBackgroundColor', e.target.value)}
                      className="w-6 h-6 rounded-full overflow-hidden border-none bg-transparent cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] tracking-wider opacity-60">Accent Color</span>
                    <input 
                      type="color" 
                      value={settings.accentColor} 
                      onChange={(e) => handleColorChange('accentColor', e.target.value)}
                      className="w-6 h-6 rounded-full overflow-hidden border-none bg-transparent cursor-pointer"
                    />
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-white/5">
                    <span className="text-[10px] tracking-wider opacity-60">Cursor Interaction</span>
                    <button 
                      onClick={() => handleColorChange('enableMouseInteraction', !settings.enableMouseInteraction)}
                      className={`w-10 h-5 rounded-full transition-colors relative ${settings.enableMouseInteraction ? 'bg-white' : 'bg-white/10'}`}
                    >
                      <div className={`absolute top-1 w-3 h-3 rounded-full transition-all ${settings.enableMouseInteraction ? 'left-6 bg-black' : 'left-1 bg-white/40'}`} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col space-y-3">
                <label className="text-[9px] uppercase tracking-widest opacity-40">Resolution</label>
                <div className="flex bg-black/40 p-1 rounded-md">
                  {(['1080p', '4K'] as ExportResolution[]).map((res) => (
                    <button key={res} onClick={() => onSettingsChange({ ...settings, exportResolution: res })} className={`flex-1 py-1.5 text-[9px] uppercase tracking-widest rounded ${settings.exportResolution === res ? 'bg-white/10 text-white' : 'text-white/30'}`}>
                      {res}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex flex-col space-y-2">
                <label className="text-[9px] uppercase tracking-widest opacity-40">Dispersal: {settings.dispersal.toFixed(1)}</label>
                <input type="range" min="0.5" max="5" step="0.1" value={settings.dispersal} onChange={(e) => onSettingsChange({ ...settings, dispersal: parseFloat(e.target.value) })} className="w-full accent-white" />
              </div>
              <div className="flex flex-col space-y-2">
                <label className="text-[9px] uppercase tracking-widest opacity-40">Size / Density: {settings.blobSize.toFixed(1)}</label>
                <input type="range" min="0.2" max="6" step="0.1" value={settings.blobSize} onChange={(e) => onSettingsChange({ ...settings, blobSize: parseFloat(e.target.value) })} className="w-full accent-white" />
              </div>
              <div className="flex flex-col space-y-2">
                <label className="text-[9px] uppercase tracking-widest opacity-40">Energy / Speed: {settings.blobSpeed.toFixed(1)}</label>
                <input type="range" min="0.1" max="5" step="0.1" value={settings.blobSpeed} onChange={(e) => onSettingsChange({ ...settings, blobSpeed: parseFloat(e.target.value) })} className="w-full accent-white" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
