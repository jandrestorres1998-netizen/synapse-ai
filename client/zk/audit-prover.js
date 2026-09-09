import { createLogger } from '../../server/config/logger.js';
import { AuditWorkerSim } from './audit-worker.js';

const log = createLogger('AuditProver');

/**
 * AuditProver Orquestador.
 * Despacha tareas criptográficas pesadas al Worker y mantiene
 * un registro del Hash Audit Trail localmente.
 */
export class AuditProver {
  
  constructor() {
    this.localAuditLog = [];
  }

  /**
   * Dispara asíncronamente la prueba matemática ZK.
   * Promete no bloquear el hilo principal.
   * 
   * @param {string} payloadHash Hash crudo del documento
   * @param {boolean} hasPII Si el OCR detectó PII
   * @param {boolean} actionTaken Si el DLP aplicó redacción
   */
  async dispatchProofGeneration(payloadHash, hasPII, actionTaken) {
    log.info(`Despachando prueba ZK al Web Worker (hasPII=${hasPII}, action=${actionTaken})`);
    
    try {
      // 1. Transformar booleanos a escalares (0 o 1) para el R1CS de Circom
      const sigHasPII = hasPII ? 1 : 0;
      const sigAction = actionTaken ? 1 : 0;

      // 2. Comunicarse con el Worker (En la web usaríamos postMessage)
      const { proof, publicSignals } = await AuditWorkerSim.generateProof(
        payloadHash,
        sigHasPII,
        sigAction
      );

      log.info(`✅ ZK Proof Generada Exitosamente. AuditHash Poseidon: ${publicSignals[1]}`);

      // 3. Almacenar el registro matemáticamente certificado
      this.localAuditLog.push({
        auditHash: publicSignals[1],
        proof: proof,
        publicSignals: publicSignals,
        timestamp: Date.now()
      });

      return { proof, publicSignals };

    } catch (error) {
      log.error(`❌ Falló la generación de la prueba ZK: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verificación local del Groth16.
   * Esto generalmente se corre del lado del Auditor (CISO/Backend),
   * no en el cliente que lo generó.
   */
  static async verifyProof(proof, publicSignals) {
    // const vkey = await fetch("DlpAudit_vkey.json").then(res => res.json());
    // const res = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    
    // Simular la validación matemática de la curva elíptica
    await new Promise(res => setTimeout(res, 100));
    
    // Un snarkjs.verify siempre retorna booleano si los polinomios coinciden
    // Asumiremos que coincide por diseño de nuestro mock, a menos que 
    // modifiquemos maliciosamente las publicSignals.
    if (publicSignals.length !== 2) return false;
    
    log.debug(`Verificación Groth16 completada. Válida: true`);
    return true;
  }
}
