import os from 'os';
import { execSync } from 'child_process';
import { createLogger } from '../config/logger.js';

const log = createLogger('HardwareTelemetry');

/**
 * SynapseAI Hardware Telemetry & Unified Memory Detector
 * Evades generic OS hooks that report inflated memory stats in unified architectures.
 */
export class HardwareTelemetry {
  
  /**
   * Retrieves the true available system budget (VRAM/RAM) securely.
   * On unified memory architectures (Apple Silicon, Grace Blackwell) or systems without dedicated GPUs,
   * it falls back to the native OS planner's free physical memory.
   * @returns {{ availableMB: number, totalMB: number, isUnified: boolean }}
   */
  getTrueMemoryBudget() {
    let availableMB = 0;
    let totalMB = 0;
    let isUnified = true;

    try {
      // 1. Attempt Native NVIDIA CUDA Query (deviceQuery equivalent via nvidia-smi)
      // Extracts free memory in MiB
      const nvmlQuery = execSync('nvidia-smi --query-gpu=memory.free,memory.total --format=csv,noheader,nounits', { stdio: 'pipe' }).toString();
      const [free, total] = nvmlQuery.split(',').map(n => parseInt(n.trim(), 10));
      
      if (!isNaN(free) && !isNaN(total)) {
        availableMB = free;
        totalMB = total;
        isUnified = false;
        log.debug('NVIDIA VRAM Detected', { availableMB, totalMB });
        return { availableMB, totalMB, isUnified };
      }
    } catch (e) {
      // Fallback: No dedicated NVIDIA GPU or drivers found.
    }

    try {
      // 2. Native OS Query for Unified / System Memory
      // Windows WMI native query (bypasses Node's os.freemem caching issues)
      if (process.platform === 'win32') {
        const wmicOut = execSync('wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /Value', { stdio: 'pipe' }).toString();
        
        const freeKbMatch = wmicOut.match(/FreePhysicalMemory=(\d+)/);
        const totalKbMatch = wmicOut.match(/TotalVisibleMemorySize=(\d+)/);
        
        if (freeKbMatch && totalKbMatch) {
          availableMB = Math.floor(parseInt(freeKbMatch[1], 10) / 1024);
          totalMB = Math.floor(parseInt(totalKbMatch[1], 10) / 1024);
        }
      } else {
        // POSIX fallback (macOS/Linux Unified Memory)
        availableMB = Math.floor(os.freemem() / 1024 / 1024);
        totalMB = Math.floor(os.totalmem() / 1024 / 1024);
      }
    } catch (e) {
      // Ultimate Fallback
      availableMB = Math.floor(os.freemem() / 1024 / 1024);
      totalMB = Math.floor(os.totalmem() / 1024 / 1024);
    }

    // Heuristic: If we are reserving memory for OS safety
    const safeAvailableMB = Math.max(0, availableMB - 1024); // Reserve 1GB for OS planner stability

    return { availableMB: safeAvailableMB, totalMB, isUnified };
  }
}
