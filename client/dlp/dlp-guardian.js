import { WasmOCREngine } from './wasm-ocr-engine.js';
import { SpatialRedactor } from './spatial-redactor.js';
import { createLogger } from '../../server/config/logger.js';

const log = createLogger('DLPGuardian');

/**
 * Orquestador Edge-Side para la Prevención de Pérdida de Datos (DLP).
 * Garantiza que ninguna PII (ej. tarjetas de crédito, rostros) abandone la 
 * memoria volátil del cliente hacia la red P2P (Zero-Trust Endpoint).
 */
export class DLPGuardian {
  constructor() {
    this.ocrEngine = new WasmOCREngine();
  }

  async initialize() {
    log.info('Inicializando DLP Guardian en el perímetro (Edge)...');
    await this.ocrEngine.initialize();
  }

  /**
   * Purifica una imagen cruda (Uint8ClampedArray) mutándola en su lugar (in-place)
   * para destruir cualquier PII antes de que el Gateway la envíe al enjambre.
   * 
   * @param {Uint8ClampedArray} pixels Buffer de píxeles RGBA (In-place mutation)
   * @param {number} width 
   * @param {number} height 
   * @returns {Object} { isPurified, piiCount, extractedData }
   */
  async sanitizePayload(pixels, width, height) {
    if (!pixels || width <= 0 || height <= 0) {
      throw new Error('Payload de imagen inválido.');
    }

    log.debug('Analizando payload en memoria...');

    // 1. Ejecutar Inferencia Tensorial para extraer regiones espaciales y texto
    const boundingBoxes = await this.ocrEngine.runInference(pixels, width, height);
    
    // 2. Clasificación Algorítmica (ej. Luhn para Tarjetas de Crédito)
    const classifiedBoxes = this.ocrEngine.classifyPII(boundingBoxes);
    
    // 3. Filtrar solo las cajas marcadas como PII
    const piiBoxes = classifiedBoxes.filter(box => box.isPII);

    if (piiBoxes.length === 0) {
      log.debug('El payload no contiene PII. Aprobado para transmisión.');
      return {
        isPurified: false,
        piiCount: 0,
        extractedData: classifiedBoxes // Data benigna permitida
      };
    }

    // 4. Redacción Espacial Determinista (Destrucción Matemática de la PII)
    SpatialRedactor.redact(pixels, width, height, piiBoxes, 'blur');
    log.info(`Payload purificado. ${piiBoxes.length} regiones destruidas visualmente.`);

    // 5. Retornar los metadatos pero SIN la PII en el extractedData (censuramos el texto)
    const sanitizedData = classifiedBoxes.map(box => {
      if (box.isPII) {
        return { ...box, text: '[REDACTED_BY_DLP]' };
      }
      return box;
    });

    return {
      isPurified: true,
      piiCount: piiBoxes.length,
      extractedData: sanitizedData
    };
  }
}
