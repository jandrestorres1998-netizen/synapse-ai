import { createLogger } from '../config/logger.js';
import http from 'http';

const log = createLogger('KVCacheMath');

/**
 * SynapseAI KV Cache Arithmetic Engine
 * Dynamically queries the local inference engine (Ollama) to extract the Exact Model Topology.
 * Then calculates the VRAM requirement to avoid OOM crashes.
 */
export class KVCacheArithmetic {
  
  /**
   * Queries Ollama /api/show to fetch mathematical topology of a given model.
   * Resolves with { L, d, g }
   */
  async fetchModelTopology(modelName) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({ name: modelName });
      
      const req = http.request({
        hostname: 'localhost',
        port: 11434,
        path: '/api/show',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Ollama API returned ${res.statusCode}`));
          }
          try {
            const data = JSON.parse(body);
            const info = data.model_info || {};
            
            // Dynamically extract values regardless of model family (llama, qwen2, phi3)
            let L = 32; // Fallback defaults (Llama 3 8B)
            let d = 4096;
            let head_count = 32;
            let head_count_kv = 8;
            
            for (const key of Object.keys(info)) {
              if (key.endsWith('block_count')) L = info[key];
              if (key.endsWith('embedding_length')) d = info[key];
              if (key.endsWith('attention.head_count')) head_count = info[key];
              if (key.endsWith('attention.head_count_kv')) head_count_kv = info[key];
            }
            
            const g = head_count / (head_count_kv || 1);
            
            log.debug(`Topology fetched for ${modelName}`, { L, d, g });
            resolve({ L, d, g });
          } catch (err) {
            reject(err);
          }
        });
      });
      
      req.on('error', (e) => reject(e));
      req.write(payload);
      req.end();
    });
  }

  /**
   * Calculates required VRAM for KV Cache.
   * Formula: VRAM_KV = 2 * L * (d / g) * b_kv * N * S
   */
  calculateKVCacheBytes(L, d, g, contextTokens, concurrentSequences = 1) {
    const b_kv = 2; // Typically 2 bytes for FP16 / BF16
    
    // Formula execution
    const vramKVBytes = 2 * L * (d / g) * b_kv * contextTokens * concurrentSequences;
    
    return vramKVBytes;
  }

  /**
   * Evaluates if the current prompt context fits in the available VRAM.
   */
  async canModelFitLocal(modelName, contextTokens, availableVramMB, estimatedModelWeightsMB = 4500) {
    try {
      const topology = await this.fetchModelTopology(modelName);
      
      const vramKVCacheBytes = this.calculateKVCacheBytes(
        topology.L, 
        topology.d, 
        topology.g, 
        contextTokens
      );
      
      const vramKVCacheMB = Math.ceil(vramKVCacheBytes / 1024 / 1024);
      
      // Total VRAM Required = Model Weights + KV Cache + CUDA Buffer Reserve (approx 500MB)
      const totalRequiredMB = estimatedModelWeightsMB + vramKVCacheMB + 500;
      
      const isSafe = totalRequiredMB < availableVramMB;
      
      log.info(`VRAM KV Calculation for ${modelName}`, {
        contextTokens,
        kvCacheMB: vramKVCacheMB,
        totalRequiredMB,
        availableVramMB,
        decision: isSafe ? 'ALLOW_EDGE' : 'DENY_FAILOVER'
      });
      
      return {
        isSafe,
        requiredMB: totalRequiredMB,
        kvCacheMB: vramKVCacheMB,
        availableMB: availableVramMB
      };
      
    } catch (error) {
      log.warn(`Ollama unreachable or topology missing. Falling back to failover.`, { error: error.message });
      // If we can't mathematically prove safety, we deny execution (Zero Trust)
      return { isSafe: false, requiredMB: 999999, kvCacheMB: 0, availableMB: availableVramMB };
    }
  }
}
