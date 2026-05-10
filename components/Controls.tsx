
import React from 'react';
import { AudioSourceType } from '../types';

interface ControlsProps {
  onMicToggle: () => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  activeSource: AudioSourceType;
  uiColor?: string;
}

export const Controls: React.FC<ControlsProps> = ({ 
  onMicToggle, 
  onFileUpload, 
  activeSource,
  uiColor = '#ffffff'
}) => {
  return (
    <div className="flex flex-col items-center space-y-6 select-none" style={{ color: uiColor }}>
      {/* Primary Audio Source */}
      <div className="flex items-center space-x-12">
        <div className="relative group">
          <input 
            type="file" 
            accept="audio/*" 
            onChange={onFileUpload} 
            className="absolute inset-0 opacity-0 cursor-pointer w-full"
          />
          <button 
            className={`text-[11px] tracking-[0.2em] uppercase transition-all duration-500 border-b pb-1 ${
              activeSource === AudioSourceType.FILE 
                ? 'border-current opacity-100' 
                : 'border-transparent opacity-40 group-hover:opacity-100'
            }`}
          >
            {activeSource === AudioSourceType.FILE ? 'Change File' : 'Upload Audio'}
          </button>
        </div>

        <button 
          onClick={onMicToggle}
          className={`text-[11px] tracking-[0.2em] uppercase transition-all duration-500 border-b pb-1 ${
            activeSource === AudioSourceType.MICROPHONE 
              ? 'border-current opacity-100' 
              : 'border-transparent opacity-40 hover:opacity-100'
          }`}
        >
          {activeSource === AudioSourceType.MICROPHONE ? 'Mic Active' : 'Use Mic'}
        </button>
      </div>

      {activeSource !== AudioSourceType.NONE && (
        <div className="flex space-x-1.5 items-end h-3 opacity-30">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="w-0.5 bg-current animate-pulse" style={{ animationDelay: `${i * 150}ms`, height: `${30 + Math.random() * 70}%` }}></div>
          ))}
        </div>
      )}
    </div>
  );
};
