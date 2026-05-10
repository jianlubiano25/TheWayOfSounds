export interface FrameAudioData {
  bass: number;
  mid: number;
  treble: number;
  frequencyData: Uint8Array;
}

export const analyzeAudioBuffer = async (audioBuffer: AudioBuffer, fps: number = 30): Promise<FrameAudioData[]> => {
  const duration = audioBuffer.duration;
  const frameCount = Math.ceil(duration * fps);
  const sampleRate = audioBuffer.sampleRate;

  // Create an OfflineAudioContext for each frame to get accurate frequency data
  const results: FrameAudioData[] = [];
  const fftSize = 1024;

  for (let i = 0; i < frameCount; i++) {
    const frameTime = i / fps;
    // Extract a small slice of the audio for this frame
    const frameSampleStart = Math.floor(frameTime * sampleRate);
    const frameSampleCount = fftSize;
    const frameSampleEnd = Math.min(frameSampleStart + frameSampleCount, audioBuffer.length);
    const frameBuffer = new AudioBuffer({
      length: frameSampleEnd - frameSampleStart,
      sampleRate: sampleRate,
      numberOfChannels: 1
    });
    // Copy channel data
    const channelData = audioBuffer.getChannelData(0).slice(frameSampleStart, frameSampleEnd);
    frameBuffer.copyToChannel(channelData, 0, 0);

    // Analyze this frame's buffer
    const offlineCtx = new OfflineAudioContext(1, frameBuffer.length, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = frameBuffer;
    const analyser = offlineCtx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0.3;
    source.connect(analyser);
    analyser.connect(offlineCtx.destination);

    source.start();
    await offlineCtx.startRendering();

    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);

    let b = 0, m = 0, t = 0;
    const bLimit = Math.floor(freqData.length * 0.05);
    const mLimit = Math.floor(freqData.length * 0.25);
    for (let j = 0; j < bLimit; j++) b += freqData[j];
    for (let j = bLimit; j < mLimit; j++) m += freqData[j];
    for (let j = mLimit; j < freqData.length; j++) t += freqData[j];

    results.push({
      bass: b / Math.max(1, bLimit * 255),
      mid: m / Math.max(1, (mLimit - bLimit) * 255),
      treble: t / Math.max(1, (freqData.length - mLimit) * 255),
      frequencyData: freqData
    });
  }

  // Smooth the results to prevent visual jitter in animations
  const smoothed: FrameAudioData[] = [];
  const windowSize = 2; // Look ahead/behind 2 frames for smoothing
  
  for (let i = 0; i < results.length; i++) {
    let b = 0, m = 0, t = 0;
    let count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(results.length - 1, i + windowSize); j++) {
      b += results[j].bass;
      m += results[j].mid;
      t += results[j].treble;
      count++;
    }
    smoothed.push({
      ...results[i],
      bass: b / count,
      mid: m / count,
      treble: t / count
    });
  }

  return smoothed;
};
