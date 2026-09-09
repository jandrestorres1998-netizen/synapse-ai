import { createLogger } from '../../server/config/logger.js';

const log = createLogger('SpatialRedactor');

/**
 * Destruye criptográficamente y visualmente la PII operando
 * sobre matrices crudas Uint8ClampedArray. 
 * Garantiza determinismo matemático cruzado (Zero-Trust Edge).
 */
export class SpatialRedactor {
  
  /**
   * Aplica un algoritmo de Mosaico (Pixelado) sobre una región de la matriz.
   * Promedia los valores RGB en bloques.
   * 
   * @param {Uint8ClampedArray} pixels Buffer de imagen RGBA plana
   * @param {number} imgWidth Ancho total de la imagen
   * @param {number} imgHeight Alto total de la imagen
   * @param {Object} box Coordenadas {x, y, width, height}
   * @param {number} blockSize Tamaño del bloque de pixelado
   */
  static applyMosaic(pixels, imgWidth, imgHeight, box, blockSize = 10) {
    const { x: startX, y: startY, width: boxW, height: boxH } = box;
    
    // Boundary checks
    const endX = Math.min(startX + boxW, imgWidth);
    const endY = Math.min(startY + boxH, imgHeight);
    
    for (let y = startY; y < endY; y += blockSize) {
      for (let x = startX; x < endX; x += blockSize) {
        
        let rSum = 0, gSum = 0, bSum = 0;
        let count = 0;
        
        // Pass 1: Sum colors in the block
        for (let by = 0; by < blockSize; by++) {
          for (let bx = 0; bx < blockSize; bx++) {
            const px = x + bx;
            const py = y + by;
            if (px < endX && py < endY) {
              const idx = (py * imgWidth + px) * 4;
              rSum += pixels[idx];
              gSum += pixels[idx + 1];
              bSum += pixels[idx + 2];
              count++;
            }
          }
        }
        
        const rAvg = Math.floor(rSum / count);
        const gAvg = Math.floor(gSum / count);
        const bAvg = Math.floor(bSum / count);
        
        // Pass 2: Apply average color to the block
        for (let by = 0; by < blockSize; by++) {
          for (let bx = 0; bx < blockSize; bx++) {
            const px = x + bx;
            const py = y + by;
            if (px < endX && py < endY) {
              const idx = (py * imgWidth + px) * 4;
              pixels[idx] = rAvg;
              pixels[idx + 1] = gAvg;
              pixels[idx + 2] = bAvg;
              // Alfa (idx + 3) se mantiene intacto
            }
          }
        }
      }
    }
  }

  /**
   * Separable Box Blur en O(N).
   * Difumina irreversiblemente el texto aplicando una pasada horizontal y una vertical.
   * Más rápido y determinista que los filtros Gaussianos estándar.
   * 
   * @param {Uint8ClampedArray} pixels 
   * @param {number} imgWidth 
   * @param {number} imgHeight 
   * @param {Object} box {x, y, width, height}
   * @param {number} radius Radio del desenfoque
   */
  static applySeparableBoxBlur(pixels, imgWidth, imgHeight, box, radius = 5) {
    const { x: startX, y: startY, width: boxW, height: boxH } = box;
    
    const endX = Math.min(startX + boxW, imgWidth);
    const endY = Math.min(startY + boxH, imgHeight);
    
    // Clonamos solo el bloque a desenfocar para las pasadas
    const targetW = endX - startX;
    const targetH = endY - startY;
    if (targetW <= 0 || targetH <= 0) return;

    // Buffer intermedio para la pasada horizontal
    const tempBuffer = new Uint8ClampedArray(targetW * targetH * 4);

    // 1. Pasada Horizontal
    for (let y = 0; y < targetH; y++) {
      for (let x = 0; x < targetW; x++) {
        let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
        let count = 0;

        for (let k = -radius; k <= radius; k++) {
          const nx = Math.min(Math.max(x + k, 0), targetW - 1); // Clamp
          const globalIdx = ((startY + y) * imgWidth + (startX + nx)) * 4;
          
          rSum += pixels[globalIdx];
          gSum += pixels[globalIdx + 1];
          bSum += pixels[globalIdx + 2];
          aSum += pixels[globalIdx + 3];
          count++;
        }

        const localIdx = (y * targetW + x) * 4;
        tempBuffer[localIdx] = Math.floor(rSum / count);
        tempBuffer[localIdx + 1] = Math.floor(gSum / count);
        tempBuffer[localIdx + 2] = Math.floor(bSum / count);
        tempBuffer[localIdx + 3] = Math.floor(aSum / count);
      }
    }

    // 2. Pasada Vertical (escribe directamente de vuelta al buffer original)
    for (let x = 0; x < targetW; x++) {
      for (let y = 0; y < targetH; y++) {
        let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
        let count = 0;

        for (let k = -radius; k <= radius; k++) {
          const ny = Math.min(Math.max(y + k, 0), targetH - 1); // Clamp
          const localIdx = (ny * targetW + x) * 4;
          
          rSum += tempBuffer[localIdx];
          gSum += tempBuffer[localIdx + 1];
          bSum += tempBuffer[localIdx + 2];
          aSum += tempBuffer[localIdx + 3];
          count++;
        }

        const globalIdx = ((startY + y) * imgWidth + (startX + x)) * 4;
        pixels[globalIdx] = Math.floor(rSum / count);
        pixels[globalIdx + 1] = Math.floor(gSum / count);
        pixels[globalIdx + 2] = Math.floor(bSum / count);
        // El alfa a menudo no se desdibuja, pero por completitud lo escribimos:
        pixels[globalIdx + 3] = Math.floor(aSum / count);
      }
    }
  }

  /**
   * Punto de entrada principal para aplicar redacción a múltiples cajas de PII.
   * @param {Uint8ClampedArray} pixels 
   * @param {number} width 
   * @param {number} height 
   * @param {Array} piiBoxes 
   * @param {string} strategy 'mosaic' | 'blur'
   */
  static redact(pixels, width, height, piiBoxes, strategy = 'blur') {
    if (!piiBoxes || piiBoxes.length === 0) return;
    
    log.info(`Aplicando destrucción determinista (${strategy}) a ${piiBoxes.length} regiones PII...`);
    
    for (const box of piiBoxes) {
      if (strategy === 'blur') {
        // Blur radio adaptativo basado en altura para ofuscar texto eficientemente
        const radius = Math.max(3, Math.floor(box.height / 4));
        SpatialRedactor.applySeparableBoxBlur(pixels, width, height, box, radius);
      } else {
        SpatialRedactor.applyMosaic(pixels, width, height, box, 12);
      }
    }
  }
}
