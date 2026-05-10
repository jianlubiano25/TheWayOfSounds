import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
// @ts-ignore
import classWorkerURL from '@ffmpeg/ffmpeg/worker?url';

let ffmpeg: FFmpeg | null = null;

export async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;

  if (!window.crossOriginIsolated) {
    console.warn('Cross-Origin Isolation is not enabled. FFmpeg.wasm may fail to load or run slowly without SharedArrayBuffer.');
  }

  ffmpeg = new FFmpeg();
  
  ffmpeg.on('log', ({ message }) => console.log('[FFmpeg Init Log]', message));
  
  try {
    console.log('[FFmpeg] Fetching Blob URLs...');
    const coreURL = await toBlobURL('/ffmpeg-core-v2.js', 'text/javascript');
    console.log('[FFmpeg] Fetched coreURL');
    const wasmURL = await toBlobURL('/ffmpeg-core-v2.wasm', 'application/wasm');
    console.log('[FFmpeg] Fetched wasmURL');
    
    console.log('[FFmpeg] Loading FFmpeg with URLs', { classWorkerURL, coreURL, wasmURL });
    const loadPromise = ffmpeg.load({
      classWorkerURL: classWorkerURL,
      coreURL,
      wasmURL,
    });

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('FFmpeg load timed out after 60s.')), 60000)
    );

    await Promise.race([loadPromise, timeoutPromise]);
    console.log('[FFmpeg] Load complete!');
  } catch (err: any) {
    console.error('[FFmpeg] Init caught error:', err);
    throw new Error(`Init failed: ${err?.message || JSON.stringify(err) || String(err)}`);
  }

  return ffmpeg;
}

export interface EncodeOptions {
  frames: Blob[];
  audioFile: File;
  fps: number;
  width: number;
  height: number;
  onProgress: (percent: number) => void;
}

export async function encodeVideo(options: EncodeOptions): Promise<Blob> {
  const { frames, audioFile, fps, onProgress } = options;
  if (!frames || frames.length === 0) {
    throw new Error('No frames provided for encoding');
  }

  console.log('[FFmpeg] Initializing encoder...');
  const ffmpeg = await getFFmpeg();

  const logs: string[] = [];
  ffmpeg.on('log', ({ message }) => {
    logs.push(message);
    console.log('[FFmpeg Log]', message);
  });

  ffmpeg.on('progress', ({ progress }) => {
    onProgress(Math.round(progress * 100));
  });

  let totalFrames = 0;
  
  try {
    console.log('[FFmpeg] Writing frames to virtual FS...');
    // Write frames to virtual file system
    totalFrames = frames.length;
    for (let i = 0; i < totalFrames; i++) {
      const frame = frames.shift(); // remove from array to allow GC
      if (frame) {
        const data = new Uint8Array(await frame.arrayBuffer());
        await ffmpeg.writeFile(`frame${(i + 1).toString().padStart(6, '0')}.jpg`, data);
      }
    }

    console.log('[FFmpeg] Writing audio...');
    const audioData = new Uint8Array(await audioFile.arrayBuffer());
    await ffmpeg.writeFile('audio.input', audioData);

    console.log('[FFmpeg] Starting encoding...');
    const ret = await ffmpeg.exec([
      '-f', 'image2',
      '-framerate', fps.toString(),
      '-start_number', '1',
      '-i', 'frame%06d.jpg',
      '-i', 'audio.input',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18', // Lower CRF for higher quality, defined dots
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      'output.mp4'
    ]);
    
    if (ret !== 0) {
      throw new Error(`FFmpeg exec failed with code ${ret}. Logs: ${logs.join('\\n')}`);
    }

    console.log('[FFmpeg] Reading output...');
    const data = await ffmpeg.readFile('output.mp4');
    return new Blob([data], { type: 'video/mp4' });

  } finally {
    // Cleanup
    console.log('[FFmpeg] Cleaning up...');
    for (let i = 0; i < totalFrames; i++) {
      try { await ffmpeg.deleteFile(`frame${(i + 1).toString().padStart(6, '0')}.jpg`); } catch (e) {}
    }
    try { await ffmpeg.deleteFile('audio.input'); } catch (e) {}
    try { await ffmpeg.deleteFile('output.mp4'); } catch (e) {}
  }
}
