/**
 * preload.js  v4
 *
 * Adds:
 *  analyzeAudio()     — calls Node.js FFT analysis (no Web Audio / no 1.27 GB buffer)
 *  onAnalyzeProgress  — receives fraction updates during analysis
 *  cancelExport()     — clean abort mid-render
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // ── Export pipeline ───────────────────────────────────────────────────────
  startExport:    (options) => ipcRenderer.send('start-native-export', options),
  sendFrame:      (buffer)  => ipcRenderer.invoke('send-frame-data', buffer),
  endStream:      ()        => ipcRenderer.invoke('end-frame-stream'),
  cancelExport:   ()        => ipcRenderer.send('cancel-export'),

  // ── Audio analysis (NEW v4) ────────────────────────────────────────────────
  // Uses Node.js FFT streaming via FFmpeg PCM pipe.
  // audioPath: absolute path to audio file (use getPathForFile)
  // fps: frames per second (24 or 30)
  // estimatedDuration: file duration in seconds (0 = unknown)
  analyzeAudio: (audioPath, fps, estimatedDuration) =>
    ipcRenderer.invoke('analyze-audio', { audioPath, fps, estimatedDuration }),

  // ── Dialogs ───────────────────────────────────────────────────────────────
  saveDialog:  (options) => ipcRenderer.invoke('save-dialog', options),
  selectFolder: ()       => ipcRenderer.invoke('select-folder'),
  getPathForFile: (file) => webUtils?.getPathForFile(file) || (file)?.path || '',

  // Generic invoke pass-through (legacy compat)
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // ── Event listeners ───────────────────────────────────────────────────────
  onExportLog:        (cb) => ipcRenderer.on('export-log',       (_e, v) => cb(v)),
  onceExportComplete: (cb) => ipcRenderer.once('export-complete', (_e, v) => cb(v)),
  onExportComplete:   (cb) => ipcRenderer.on('export-complete',  (_e, v) => cb(v)),
  // Fired by main.js during analyze-audio with fraction 0.0–1.0
  onAnalyzeProgress:  (cb) => ipcRenderer.on('analyze-progress', (_e, v) => cb(v)),
  // Remove analyze-progress listener when done
  offAnalyzeProgress: (cb) => ipcRenderer.removeListener('analyze-progress', cb),
});
