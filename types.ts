
export enum AudioSourceType {
  MICROPHONE = 'MICROPHONE',
  FILE = 'FILE',
  NONE = 'NONE'
}

export enum VisualizerVariation {
  CIRCLES = 'CIRCLES',
  GALAXY = 'GALAXY',
  FLOW = 'FLOW',
  LINES = 'LINES',
  STARS = 'STARS',
  ROSE = 'ROSE'
}

export type ExportResolution = '1080p' | '4K';

export interface VisualizerSettings {
  leftBackgroundColor: string;
  rightBackgroundColor: string;
  accentColor: string;
  blobSize: number;
  blobSpeed: number;
  blobQuantity: number;
  particleDensity: number;
  dispersal: number;
  exportResolution: ExportResolution;
  enableMouseInteraction: boolean;
}

export interface AudioState {
  analyzer: AnalyserNode | null;
  audioContext: AudioContext | null;
  sourceType: AudioSourceType;
  isPlaying: boolean;
}
