/**
 * performance-monitor.ts - Rendering performance benchmarking
 * 
 * Use this to measure the impact of optimizations
 * Tracks memory, frame time, and encoding speed
 */

export interface PerformanceMetrics {
  totalRenderTime: number;
  totalEncodingTime: number;
  averageFrameRenderTime: number;
  peakMemoryUsage: number;
  averageMemoryUsage: number;
  framesPerSecond: number;
  estimatedTotalTime: number;
}

class PerformanceMonitor {
  private startTime: number = 0;
  private frameTimings: number[] = [];
  private memoryReadings: number[] = [];
  private isMonitoring: boolean = false;
  
  start() {
    this.startTime = performance.now();
    this.frameTimings = [];
    this.memoryReadings = [];
    this.isMonitoring = true;
    
    // Sample memory every 100ms if available
    const perfWithMemory = (performance as any);
    if (perfWithMemory.memory) {
      this.memorySamplingInterval = window.setInterval(() => {
        if (this.isMonitoring && perfWithMemory.memory) {
          this.memoryReadings.push(perfWithMemory.memory.usedJSHeapSize);
        }
      }, 100);
    }
  }
  
  markFrame() {
    if (!this.isMonitoring) return;
    const now = performance.now();
    this.frameTimings.push(now);
  }
  
  stop(): PerformanceMetrics {
    this.isMonitoring = false;
    if (this.memorySamplingInterval) {
      clearInterval(this.memorySamplingInterval);
    }
    
    const totalTime = performance.now() - this.startTime;
    const avgFrameTime = this.frameTimings.length > 0 
      ? this.frameTimings[this.frameTimings.length - 1] / this.frameTimings.length
      : 0;
    
    const peakMemory = Math.max(...this.memoryReadings, 0);
    const avgMemory = this.memoryReadings.length > 0
      ? this.memoryReadings.reduce((a, b) => a + b, 0) / this.memoryReadings.length
      : 0;
    
    return {
      totalRenderTime: totalTime,
      totalEncodingTime: 0, // Will be populated separately
      averageFrameRenderTime: avgFrameTime,
      peakMemoryUsage: peakMemory / 1024 / 1024, // Convert to MB
      averageMemoryUsage: avgMemory / 1024 / 1024,
      framesPerSecond: this.frameTimings.length / (totalTime / 1000),
      estimatedTotalTime: totalTime
    };
  }
  
  private memorySamplingInterval: number | null = null;
  
  /**
   * Get real-time performance status
   * Useful for monitoring during long exports
   */
  getStatus(): string {
    if (!this.isMonitoring) return "Not monitoring";
    
    const elapsed = performance.now() - this.startTime;
    const perfWithMemory = (performance as any);
    const memory = perfWithMemory.memory 
      ? (perfWithMemory.memory.usedJSHeapSize / 1024 / 1024).toFixed(1)
      : "N/A";
    
    return `Elapsed: ${(elapsed / 1000).toFixed(1)}s | Memory: ${memory}MB`;
  }
}

/**
 * Collect render statistics
 */
export function createPerformanceMonitor(): PerformanceMonitor {
  return new PerformanceMonitor();
}

/**
 * Format metrics for display
 */
export function formatMetrics(metrics: PerformanceMetrics): string {
  return `
Performance Metrics:
  Total Time: ${(metrics.totalRenderTime / 1000).toFixed(2)}s
  Avg Frame Time: ${metrics.averageFrameRenderTime.toFixed(2)}ms
  FPS: ${metrics.framesPerSecond.toFixed(1)}
  Peak Memory: ${metrics.peakMemoryUsage.toFixed(1)}MB
  Avg Memory: ${metrics.averageMemoryUsage.toFixed(1)}MB
  `;
}

/**
 * Compare before/after metrics
 */
export function compareMetrics(before: PerformanceMetrics, after: PerformanceMetrics): string {
  const timeImprovement = ((before.totalRenderTime - after.totalRenderTime) / before.totalRenderTime * 100).toFixed(1);
  const memoryImprovement = ((before.peakMemoryUsage - after.peakMemoryUsage) / before.peakMemoryUsage * 100).toFixed(1);
  
  return `
Performance Improvement:
  Speed: ${timeImprovement}% faster
  Memory: ${memoryImprovement}% less peak usage
  Frame Rate: ${after.framesPerSecond.toFixed(1)} FPS (before: ${before.framesPerSecond.toFixed(1)})
  `;
}

// Example usage in OfflineRenderer:
/*
import { createPerformanceMonitor } from './performance-monitor';

export const runOfflineRender = async (options: RenderOptions) => {
  const monitor = createPerformanceMonitor();
  monitor.start();
  
  // ... rendering code ...
  
  for (let i = 0; i < totalFrames; i++) {
    renderFrame(...);
    monitor.markFrame();
  }
  
  const metrics = monitor.stop();
  console.log(formatMetrics(metrics));
};
*/
