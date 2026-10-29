// electron-export.js
// Node.js/Electron script for native FFmpeg export
// Usage: node electron-export.js <audioFile> <outputFile> <width> <height> <fps>

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

async function exportVideo({ audioFile, outputFile, width, height, fps, tuneTo432Hz = false }) {
  console.log(`Starting FFmpeg: ${width}x${height} @ ${fps}fps`);
  
  const pitchRatio = 0.981818;
  const audioFilter = tuneTo432Hz 
    ? ['-af', `aresample=48000,asetrate=48000*${pitchRatio},aresample=48000`] 
    : [];

  // FFmpeg args for rawvideo + audio muxing
  const ffmpegArgs = [
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${width}x${height}`,
    '-r', `${fps}`,
    '-i', 'pipe:0',
    '-i', audioFile,
    ...audioFilter,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    outputFile
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs, { stdio: ['pipe', 'inherit', 'inherit'] });

  ffmpeg.on('close', (code) => {
    if (code === 0) {
      console.log(`\nExport complete: ${outputFile}`);
    } else {
      console.error(`\nFFmpeg exited with code ${code}`);
    }
    process.exit(code);
  });

  // Pipe stdin from this process to ffmpeg
  process.stdin.pipe(ffmpeg.stdin);
}

// CLI usage
if (require.main === module) {
  const [audioFile, outputFile, width, height, fps, tune432] = process.argv.slice(2);
  if (!audioFile || !outputFile || !width || !height || !fps) {
    console.error('Usage: node electron-export.js <audioFile> <outputFile> <width> <height> <fps>');
    process.exit(1);
  }
  exportVideo({
    audioFile,
    outputFile,
    width: parseInt(width, 10),
    height: parseInt(height, 10),
    fps: parseInt(fps, 10),
    tuneTo432Hz: tune432 === 'true'
  });
}
