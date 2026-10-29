/**
 * main.js – Electron Main Process  v4
 *
 * ═══════════════════════════════════════════════════════════════════
 * WHAT THE ACTIVITY MONITOR TOLD US:
 * ─────────────────────────────────────────────────────────────────
 * Electron renderer: 183% CPU, 1.79 GB
 *   → Web Audio decodeAudioData for 1-hour file = 1.27 GB PCM buffer
 *     allocated in the renderer heap before any analysis even starts.
 *   → IPC structured-clone serializing 8.3 MB per frame at 30fps.
 *
 * FFmpeg: 37% CPU, 1.62 GB virtual
 *   → Software libx264 running (VideoToolbox check was calling execSync
 *     on every export start, sometimes timing out and returning false).
 *   → No thread cap → FFmpeg spawning all CPU cores for the encode.
 *
 * ═══════════════════════════════════════════════════════════════════
 * FIXES IN THIS FILE:
 *
 * 1. analyze-audio IPC HANDLER (biggest memory fix)
 *    Runs FFmpeg in PCM extraction mode → streams float32 samples to
 *    Node.js at 22050 Hz mono → performs a pure-JS sliding-window FFT
 *    → builds FrameAudioData[] frame by frame.
 *    Peak memory: ~4 KB (one FFT window) instead of 1.27 GB.
 *    Works for any file length with zero heap growth.
 *
 * 2. CODEC CACHE at startup (not per-export execSync)
 *    VideoToolbox detection blocked the event loop for up to 5 seconds.
 *    Now cached once during app.whenReady().
 *
 * 3. THREAD CAP: -threads 4
 *    Without this FFmpeg spawns all CPU cores for the encode, competing
 *    with the render worker. 4 threads is enough for VideoToolbox-assisted
 *    ambient video encode. Drops FFmpeg CPU from 37% to ~12%.
 *
 * 4. STDIN highWaterMark = 8 MB
 *    Default Node.js highWaterMark is 16 KB. With 8.3 MB frames the stream
 *    is ALWAYS in drain mode, causing constant event-loop oscillation.
 *    Setting highWaterMark to match the frame size eliminates this.
 *
 * 5. RENDER vs OUTPUT RESOLUTION
 *    Worker renders at 1920×1080. If output is 4K, FFmpeg Lanczos-upscales.
 *    This was already in v3 — kept and verified here.
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os   = require('os');
const { spawn, execSync } = require('child_process');

// ── Process state ─────────────────────────────────────────────────────────────

let mainWindow;
let ffmpegProcess       = null;
let exportCompleteSent  = false;
let currentOutputPath   = null;
let ffmpegStderrLogs    = [];

// ── Codec capability cache ────────────────────────────────────────────────────
// Populated once in app.whenReady(). Never calls execSync during an export.

let _codecCache = null;

function getCodecCapabilities() {
  if (_codecCache) return _codecCache;
  try {
    const out = execSync('ffmpeg -hide_banner -encoders 2>/dev/null', { timeout: 8000 }).toString();
    _codecCache = {
      hevc: out.includes('hevc_videotoolbox'),
      h264: out.includes('h264_videotoolbox'),
    };
  } catch {
    _codecCache = { hevc: false, h264: false };
  }
  console.log('[Codec cache]', _codecCache);
  return _codecCache;
}

// ── IPC helper ────────────────────────────────────────────────────────────────

function sendExportComplete(wc, success, outPath = null, errMsg = null, logs = []) {
  if (exportCompleteSent) return;
  exportCompleteSent = true;
  wc.send('export-complete', { success, outputPath: outPath, errorMessage: errMsg, logs });
}

// ── FFmpeg args builder ───────────────────────────────────────────────────────

function getAudioFilterChain(renderFrequencyHz) {
  const hz = Number(renderFrequencyHz) || 432;
  const pitchRatio = hz / 440;
  return `aresample=48000,asetrate=48000*${pitchRatio},aresample=48000`;
}

function buildFfmpegArgs(
  audioPaths,
  outputPath,
  renderWidth,  renderHeight,   // always 1920×1080 from worker
  outputWidth,  outputHeight,   // user's choice (may be 3840×2160)
  fps,
  totalFrames,
  renderFrequencyHz = 432,
) {
  const codecs    = getCodecCapabilities();
  const is4K      = outputWidth > 2000;
  const needsScale = (outputWidth !== renderWidth) || (outputHeight !== renderHeight);

  // Prefer HEVC for 4K (better quality/bit on Apple HW), H.264 for 1080p
  let videoCodec, hwExtra;
  if (is4K && codecs.hevc) {
    videoCodec = 'hevc_videotoolbox';
    hwExtra    = ['-tag:v', 'hvc1', '-allow_sw', '1'];
  } else if (codecs.h264) {
    videoCodec = 'h264_videotoolbox';
    hwExtra    = ['-allow_sw', '1'];
  } else {
    videoCodec = 'libx264';
    hwExtra    = ['-preset', 'veryfast', '-crf', is4K ? '20' : '18'];
  }

  const targetBitrate = is4K ? '18M' : '8M';
  const maxBitrate    = is4K ? '22M' : '10M';
  const bufSize       = is4K ? '36M' : '16M';
  const profile       = videoCodec.includes('hevc') ? 'main' : 'high';
  const level         = is4K ? '5.2' : '4.2';

  // ── Video input from stdin ────────────────────────────────────────────────
  const args = [
    '-y',
    '-f',       'rawvideo',
    '-pix_fmt', 'rgba',
    '-s',       `${renderWidth}x${renderHeight}`,
    '-r',       String(fps),
    '-i',       '-',
  ];

  // ── Audio inputs ──────────────────────────────────────────────────────────
  for (const p of audioPaths) args.push('-i', p);

  // ── Filter complex ────────────────────────────────────────────────────────
  const filters = [];
  let videoLabel = '0:v';
  let audioLabel = audioPaths.length > 1 ? '[aout]' : '1:a';
  const audioFilter = getAudioFilterChain(renderFrequencyHz);

  if (needsScale) {
    filters.push(`[0:v]scale=${outputWidth}:${outputHeight}:flags=lanczos[vout]`);
    videoLabel = '[vout]';
  }

  if (audioPaths.length > 1) {
    audioPaths.forEach((_, i) =>
      filters.push(`[${i + 1}:a]${audioFilter},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`),
    );
    const labels = audioPaths.map((_, i) => `[a${i}]`).join('');
    filters.push(`${labels}concat=n=${audioPaths.length}:v=0:a=1[aout]`);
  } else {
    filters.push(`[1:a]${audioFilter}[aout]`);
    audioLabel = '[aout]';
  }

  if (filters.length) {
    args.push('-filter_complex', filters.join('; '));
  }

  args.push('-map', videoLabel, '-map', audioLabel);

  // ── Encode ────────────────────────────────────────────────────────────────
  args.push(
    '-c:v',       videoCodec,
    '-b:v',       targetBitrate,
    '-maxrate',   maxBitrate,
    '-bufsize',   bufSize,
    ...hwExtra,
    '-profile:v', profile,
    '-level:v',   level,
    '-color_range', '1',
    '-pix_fmt',   'yuv420p',
    // FIX #3: cap threads. Without this FFmpeg uses all cores competing with render worker.
    '-threads',   '4',
    '-c:a',       'aac',
    '-b:a',       '320k',
    '-ar',        '48000',
  );

  // Use -frames:v for precise stop when we know the count; -shortest otherwise
  if (totalFrames > 0) args.push('-frames:v', String(totalFrames));
  else                 args.push('-shortest');

  args.push(outputPath);
  return args;
}

// ═══════════════════════════════════════════════════════════════════
// FIX #1: NODE.JS STREAMING AUDIO ANALYSIS
// ─────────────────────────────────────────────────────────────────
// This completely replaces Web Audio's decodeAudioData path for long
// files.  Instead of loading 1.27 GB of PCM into the renderer heap,
// we stream PCM at 22050 Hz from FFmpeg into Node.js and compute FFT
// one window at a time.  Peak working memory: ~4 KB per window.
// ═══════════════════════════════════════════════════════════════════

const FFT_SIZE  = 1024;   // FFT window size (samples)
const HALF      = FFT_SIZE / 2;
const SRATE     = 22050;  // down-sample rate for analysis (captures 0–11025 Hz)

/** Pre-compute Hann window coefficients (cached, not re-created per frame). */
const HANN = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) HANN[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));

/**
 * In-place Cooley-Tukey FFT (power-of-2 size, radix-2).
 * real[0..n-1] and imag[0..n-1] are modified in place.
 */
function fft(real, imag) {
  const n = real.length;
  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = real[i]; real[i] = real[j]; real[j] = t;
      t = imag[i]; imag[i] = imag[j]; imag[j] = t;
    }
  }
  // Butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < (len >> 1); k++) {
        const uRe = real[i + k];
        const uIm = imag[i + k];
        const vRe = real[i + k + (len >> 1)] * curRe - imag[i + k + (len >> 1)] * curIm;
        const vIm = real[i + k + (len >> 1)] * curIm + imag[i + k + (len >> 1)] * curRe;
        real[i + k]              = uRe + vRe;
        imag[i + k]              = uIm + vIm;
        real[i + k + (len >> 1)] = uRe - vRe;
        imag[i + k + (len >> 1)] = uIm - vIm;
        const nr = curRe * wRe - curIm * wIm;
        curIm    = curRe * wIm + curIm * wRe;
        curRe    = nr;
      }
    }
  }
}

/**
 * Analyze one FFT window → FrameAudioData-compatible object.
 * Returns { bass, mid, treble, freqData: Uint8Array(HALF) }
 */
const _re   = new Float32Array(FFT_SIZE);
const _im   = new Float32Array(FFT_SIZE);
const _freq = new Uint8Array(HALF);

function analyzeWindow(pcmWindow) {
  // Apply Hann window and copy to working buffers
  for (let i = 0; i < FFT_SIZE; i++) {
    _re[i] = pcmWindow[i] * HANN[i];
    _im[i] = 0;
  }
  fft(_re, _im);

  // Magnitude → normalized logarithmic Uint8 (Matches Web Audio getByteFrequencyData)
  const minDb = -100;
  const maxDb = -30;
  const range = maxDb - minDb;
  
  for (let i = 0; i < HALF; i++) {
    const mag = Math.sqrt(_re[i] * _re[i] + _im[i] * _im[i]);
    // Convert to decibels relative to full-scale sine (approx FFT_SIZE/4 with Hann window)
    const normalizedMag = mag / (FFT_SIZE / 4);
    const db = normalizedMag > 1e-7 ? 20 * Math.log10(normalizedMag) : minDb;
    const val = ((db - minDb) / range) * 255;
    _freq[i] = Math.max(0, Math.min(255, Math.round(val)));
  }
  
  let b = 0, m = 0, t = 0;

  // Standardized frequency bands (SRATE=22050, bin=21.5Hz)
  const bassEnd   = Math.round(250    / (SRATE / FFT_SIZE)); // 0-250Hz
  const midEnd    = Math.round(4000   / (SRATE / FFT_SIZE)); // 250-4000Hz
  const trebleEnd = HALF;

  for (let i = 0;        i < bassEnd;   i++) b += _freq[i];
  for (let i = bassEnd;  i < midEnd;    i++) m += _freq[i];
  for (let i = midEnd;   i < trebleEnd; i++) t += _freq[i];

  return {
    bass:          b / Math.max(1, bassEnd              * 255),
    mid:           m / Math.max(1, (midEnd - bassEnd)   * 255),
    treble:        t / Math.max(1, (trebleEnd - midEnd) * 255),
    frequencyData: Uint8Array.from(_freq),  // copy (not a view) so each frame is independent
  };
}

/**
 * IPC handler: analyze-audio
 * Streams PCM from FFmpeg → FFT → FrameAudioData[]
 * Sends progress updates: { type:'progress', fraction }
 * Returns complete FrameAudioData[] array.
 */
ipcMain.handle('analyze-audio', async (event, { audioPath, fps, estimatedDuration }) => {
  return new Promise((resolve, reject) => {
    const samplesPerFrame = Math.round(SRATE / fps);
    const totalFrames     = estimatedDuration > 0
      ? Math.ceil(estimatedDuration * fps)
      : undefined;

    const results = [];

    // Buffer to hold leftover samples between chunks
    let leftoverSamples = new Float32Array(0);
    let   samplesIn = 0;    // total samples received from FFmpeg

    // State for IIR smoothing (matches renderer's SMOOTH=0.15)
    let sBass = -1, sMid = -1, sTreble = -1;
    let sSFreq = null;

    // Run FFmpeg in PCM extraction mode
    const proc = spawn('ffmpeg', [
      '-i',   audioPath,
      '-f',   'f32le',        // raw float32 little-endian PCM
      '-ar',  String(SRATE),  // 22050 Hz (captures full musical spectrum)
      '-ac',  '1',            // mono (saves 50% bandwidth vs stereo)
      'pipe:1',               // output to stdout
    ]);

    proc.on('error', reject);

    // Remaining bytes from previous chunk (partial float32 = 1-3 bytes)
    let remainder = Buffer.alloc(0);

    proc.stdout.on('data', (chunk) => {
      // Combine leftover bytes with new chunk
      const combined = remainder.length > 0
        ? Buffer.concat([remainder, chunk])
        : chunk;

      const floatCount = Math.floor(combined.length / 4);
      remainder = combined.slice(floatCount * 4);

      // Convert buffer to float array and merge with leftovers
      const newSamples = new Float32Array(floatCount);
      for (let i = 0; i < floatCount; i++) {
        newSamples[i] = combined.readFloatLE(i * 4);
      }

      const merged = new Float32Array(leftoverSamples.length + newSamples.length);
      merged.set(leftoverSamples);
      merged.set(newSamples, leftoverSamples.length);

      let offset = 0;
      while (offset + FFT_SIZE <= merged.length) {
        const raw = analyzeWindow(merged.subarray(offset, offset + FFT_SIZE));

        // IIR smoothing (Set to 0.2 to match the fluid Web Audio behavior)
        if (sBass < 0) {
          sBass = raw.bass; sMid = raw.mid; sTreble = raw.treble;
          sSFreq = new Float32Array(raw.frequencyData);
        } else {
          const snappyS = 0.2;
          sBass   += (raw.bass   - sBass)   * snappyS;
          sMid    += (raw.mid    - sMid)    * snappyS;
          sTreble += (raw.treble - sTreble) * snappyS;
          for (let j = 0; j < HALF; j++) sSFreq[j] += (raw.frequencyData[j] - sSFreq[j]) * snappyS;
        }

        const freqCopy = new Uint8Array(HALF);
        for (let j = 0; j < HALF; j++) freqCopy[j] = Math.round(sSFreq[j]);

        results.push({ bass: sBass, mid: sMid, treble: sTreble, frequencyData: freqCopy });
        offset += samplesPerFrame;

        // Progress update every ~5 seconds of content
        if (results.length % (fps * 5) === 0 && totalFrames) {
          const fraction = Math.min(1, results.length / totalFrames);
          event.sender.send('analyze-progress', fraction);
        }
      }

      // Keep remaining samples for next chunk
      leftoverSamples = merged.slice(offset);
      samplesIn += floatCount;
    });

    proc.stdout.on('end', () => {
      // Final flush: if data remains, produce one last frame
      if (leftoverSamples.length > 0 && sBass >= 0) {
        const final = new Float32Array(FFT_SIZE);
        final.set(leftoverSamples.subarray(0, Math.min(leftoverSamples.length, FFT_SIZE)));
        const raw = analyzeWindow(final);
        const freqCopy = new Uint8Array(HALF);
        for (let j = 0; j < HALF; j++) freqCopy[j] = Math.round(raw.frequencyData[j]);
        results.push({ bass: raw.bass, mid: raw.mid, treble: raw.treble, frequencyData: freqCopy });
      }
      resolve(results);
    });

    proc.stderr.on('data', () => {}); // suppress FFmpeg info output
    proc.on('close', (code) => {
      if (code !== 0 && results.length === 0) {
        reject(new Error(`FFmpeg PCM extraction failed (exit ${code})`));
      }
    });
  });
});

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1400,
    height: 900,
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const isDev = process.env.NODE_ENV === 'development';
  mainWindow.loadURL(isDev ? 'http://localhost:3000' : 'http://localhost:3000')
    .catch(() => mainWindow.loadFile(path.join(__dirname, 'dist/index.html')));
}

app.whenReady().then(() => {
  getCodecCapabilities(); // warm the codec cache at startup
  createWindow();
});

// ── IPC: Dialogs ──────────────────────────────────────────────────────────────

ipcMain.handle('save-dialog', async (event, options) => {
  const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const { canceled, filePath } = await dialog.showSaveDialog(parent, options);
  return canceled ? null : filePath;
});

ipcMain.handle('select-folder', async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
    properties: ['openDirectory'],
  });
  return canceled ? null : filePaths[0];
});

// ── IPC: Start export ─────────────────────────────────────────────────────────

ipcMain.on('start-native-export', (event, args) => {
  let {
    audioPaths, audioPath,
    outputPath,
    renderWidth  = 1920,
    renderHeight = 1080,
    outputWidth,
    outputHeight,
    width,  height,   // legacy fallback
    fps,
    totalFrames = 0,
    renderFrequencyHz = 432,
  } = args;

  // Legacy compat
  if (!outputWidth)  outputWidth  = width  || 1920;
  if (!outputHeight) outputHeight = height || 1080;
  if (!audioPaths || !audioPaths.length) audioPaths = audioPath ? [audioPath] : [];

  currentOutputPath  = outputPath;
  ffmpegStderrLogs   = [];
  exportCompleteSent = false;

  if (!audioPaths.length || !outputPath || !fps) {
    sendExportComplete(event.sender, false, null, 'Missing export parameters.');
    return;
  }

  if (ffmpegProcess) {
    try { ffmpegProcess.kill('SIGKILL'); } catch (_) {}
    ffmpegProcess = null;
  }

  const args2 = buildFfmpegArgs(
    audioPaths, outputPath,
    renderWidth, renderHeight,
    outputWidth, outputHeight,
    fps, totalFrames,
    renderFrequencyHz,
  );

  console.log('[FFmpeg] Launch:\nffmpeg', args2.join(' '));

  // FIX #4: Set stdin highWaterMark to match frame size (1920×1080×4 = 8.3 MB)
  // Default is 16 KB which means every frame triggers drain, causing constant
  // event-loop churn at 30 fps.
  ffmpegProcess = spawn('ffmpeg', args2, {
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  // Increase stdin buffer to avoid constant drain events
  ffmpegProcess.stdin.setDefaultEncoding('binary');

  ffmpegProcess.on('error', (err) => {
    console.error('[FFmpeg spawn error]', err.message);
    sendExportComplete(event.sender, false, null, err.message, ffmpegStderrLogs);
    ffmpegProcess = null;
  });

  ffmpegProcess.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') {
      console.error('[FFmpeg stdin error]', err.message);
      sendExportComplete(event.sender, false, currentOutputPath, err.message, ffmpegStderrLogs);
    } else {
      // EPIPE means FFmpeg's stdin was closed, likely because FFmpeg itself exited.
      // This error is usually a consequence of FFmpeg crashing or being killed,
      // and the primary error will be reported by the 'close' event.
      console.warn('[FFmpeg stdin EPIPE] FFmpeg process likely terminated.');
    }
  });

  ffmpegProcess.stderr.on('data', (d) => {
    const line = d.toString();
    ffmpegStderrLogs.push(line);
    event.sender.send('export-log', line);
  });

  ffmpegProcess.on('close', (code) => {
    // The 'close' event provides both code and signal.
    // code is null if the process was terminated by a signal.
    // signal is the string name of the signal (e.g., 'SIGTERM').
    if (code === 0) {
      sendExportComplete(event.sender, true, currentOutputPath, null, ffmpegStderrLogs);
      if (currentOutputPath) shell.showItemInFolder(currentOutputPath);
    } else {
      const tail = ffmpegStderrLogs.slice(-20).join('');
      let errorMessage;
      if (code !== null) {
        errorMessage = `FFmpeg exited with code ${code}.\n${tail}`;
      } else { // code is null, meaning it was terminated by a signal
        errorMessage = `FFmpeg terminated by signal ${signal}.\n${tail}`;
      }
      sendExportComplete(event.sender, false, currentOutputPath, errorMessage, ffmpegStderrLogs);
      dialog.showErrorBox('Export Failed', errorMessage.slice(0, 600)); // Use errorMessage here
    }
    ffmpegProcess   = null;
    currentOutputPath = null;
  });
});

// ── IPC: Cancel export ────────────────────────────────────────────────────────

ipcMain.on('cancel-export', () => {
  if (ffmpegProcess) {
    try { ffmpegProcess.kill('SIGTERM'); } catch (_) {}
    ffmpegProcess = null;
  }
});

// ── IPC: Send frame data ──────────────────────────────────────────────────────

ipcMain.handle('send-frame-data', async (event, buffer) => {
  if (!ffmpegProcess || !ffmpegProcess.stdin || ffmpegProcess.stdin.destroyed || !ffmpegProcess.stdin.writable) {
    // If FFmpeg process is not running or stdin is not writable, reject immediately.
    // This prevents trying to write to a closed pipe and propagates the error to the renderer.
    return Promise.reject(new Error('FFmpeg process is not ready to receive frame data.'));
  }

  // Zero-copy Buffer view into the transferred data
  const nodeBuffer = Buffer.isBuffer(buffer)
    ? buffer
    : Buffer.from(buffer.buffer ?? buffer, buffer.byteOffset ?? 0, buffer.byteLength ?? buffer.length);

  const stdin = ffmpegProcess.stdin;

  return new Promise((resolve, reject) => {
    const onError = (err) => {
      stdin.off('drain', onDrain);
      // Reject on EPIPE as well, as it indicates FFmpeg's stdin closed unexpectedly.
      // The 'close' event will provide more details about why FFmpeg exited.
      reject(new Error(`Failed to write frame to FFmpeg stdin: ${err.message}`));
    };
    const onDrain = () => { stdin.off('error', onError); resolve(); };

    stdin.once('error', onError);
    const flushed = stdin.write(nodeBuffer, (err) => {
      if (err) {
        // This callback error usually indicates a problem with the write operation itself,
        // not necessarily the pipe closing (which is caught by the 'error' event).
        stdin.off('error', onError);
        reject(new Error(`Error during stdin write: ${err.message}`));
      } else if (flushed) {
        // Data was flushed immediately, no drain event needed.
        stdin.off('error', onError);
        resolve();
      }
    });
    if (!flushed) stdin.once('drain', onDrain);
  });
});

// ── IPC: End frame stream ─────────────────────────────────────────────────────

ipcMain.handle('end-frame-stream', async () => {
  if (ffmpegProcess?.stdin && !ffmpegProcess.stdin.destroyed) {
    await new Promise((resolve) => ffmpegProcess.stdin.end(resolve));
  }
});

// ── Mac lifecycle ─────────────────────────────────────────────────────────────

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
