import { createLogger } from '../../server/config/logger.js';

const log = createLogger('WasmOCREngine');

/**
 * Motor DLP Perimetral (Zero-Trust Edge)
 * Simula la sesión de inferencia de onnxruntime-web para extraer
 * Cajas Delimitadoras (Bounding Boxes) y texto.
 */
export class WasmOCREngine {
  constructor() {
    this.session = null;
  }

  /**
   * Inicializa el oráculo de inferencia tensorial (Mock para esta fase).
   */
  async initialize() {
    log.info('Cargando tensores del modelo ONNX (Mock mode)...');
    // En producción: this.session = await ort.InferenceSession.create('trocr-quantized.onnx');
    await new Promise(resolve => setTimeout(resolve, 50)); // Simula inicialización WASM
    this.session = 'mock-onnx-session-active';
    log.info('Oráculo OCR inicializado exitosamente en el perímetro.');
  }

  /**
   * Procesa una matriz de píxeles (Uint8ClampedArray) y devuelve Bounding Boxes.
   * Para probar, si detecta una estructura visual similar a una tarjeta de crédito,
   * inyectará un candidato para que el algoritmo de Luhn lo evalúe.
   * 
   * @param {Uint8ClampedArray} pixelData 
   * @param {number} width 
   * @param {number} height 
   */
  async runInference(pixelData, width, height) {
    if (!this.session) throw new Error('InferenceSession no inicializada.');
    
    // Simular latencia de inferencia VLM (Vision-Language Model)
    await new Promise(resolve => setTimeout(resolve, 30)); 

    // MOCK: Generar una estructura de Bounding Box simulada.
    // Simulamos que el OCR encontró un número de tarjeta de crédito en el centro.
    const mockBoundingBoxes = [
      {
        text: 'FACTURA 001',
        x: 10,
        y: 10,
        width: 100,
        height: 20
      },
      {
        text: '4532015112830366', // Valid Luhn credit card for testing
        x: width / 2 - 80,
        y: height / 2 - 10,
        width: 160,
        height: 20
      }
    ];

    log.debug(`Extracción OCR completada: ${mockBoundingBoxes.length} regiones detectadas.`);
    return mockBoundingBoxes;
  }

  /**
   * Ejecuta el Algoritmo de Luhn sobre una cadena de texto para verificar si
   * es matemáticamente una tarjeta de crédito válida.
   * 
   * @param {string} text 
   * @returns {boolean}
   */
  static validateLuhn(text) {
    // Limpiar espacios y guiones
    const sanitized = text.replace(/[\s-]/g, '');
    
    // Validar formato numérico de 13 a 19 dígitos
    if (!/^\d{13,19}$/.test(sanitized)) return false;

    let sum = 0;
    let shouldDouble = false;
    
    // Recorrer de derecha a izquierda
    for (let i = sanitized.length - 1; i >= 0; i--) {
      let digit = parseInt(sanitized.charAt(i), 10);

      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }

      sum += digit;
      shouldDouble = !shouldDouble;
    }

    return (sum % 10) === 0;
  }

  /**
   * Clasifica las regiones detectadas, etiquetando aquellas que contienen PII crítica.
   * @param {Array} boundingBoxes 
   * @returns {Array} Regiones marcadas con isPII = true
   */
  classifyPII(boundingBoxes) {
    return boundingBoxes.map(box => {
      const isPII = WasmOCREngine.validateLuhn(box.text);
      if (isPII) {
        log.warn(`⚠️ ALERTA DLP: PII Crítica detectada en coordenadas [${box.x}, ${box.y}]`);
      }
      return { ...box, isPII };
    });
  }
}
