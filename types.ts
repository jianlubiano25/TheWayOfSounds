
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

export type GalaxyDistributionMode = 'orbital' | 'field';

export type ExportResolution = '1080p' | '4K';

export type LayoutRatio = '50-50' | '66-33' | '70-30';

export type ExportContent = 'all' | 'visualizer-only';

export type RenderFrequencyHz = 432 | 741;

export interface VisualizerSettings {
  leftBackgroundColor: string;
  rightBackgroundColor: string;
  accentColor: string;
  blobSize: number;
  blobSpeed: number;
  blobQuantity: number;
  particleDensity: number;
  particleSize: number;
  glowIntensity: number;
  dispersal: number;
  exportResolution: ExportResolution;
  galaxyMode: GalaxyDistributionMode;
  enableMouseInteraction: boolean;
  renderFrequencyHz: RenderFrequencyHz;
  layoutRatio: LayoutRatio;
  exportContent: ExportContent;
  showTextHeader: boolean;
}

export interface AudioState {
  analyzer: AnalyserNode | null;
  audioContext: AudioContext | null;
  sourceType: AudioSourceType;
  isPlaying: boolean;
}
