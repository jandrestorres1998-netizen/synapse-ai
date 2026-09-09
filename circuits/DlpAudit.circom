pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";

/**
 * Circuito Audit DLP B2B
 * Certifica matemáticamente que si se detectó PII (hasPII == 1),
 * la acción de salida fue REDACTED (actionTaken == 1).
 * 
 * Señales Privadas:
 * - payloadHash: Hash crudo del documento original (protegiendo el archivo).
 * - hasPII: 1 si el motor OCR local detectó PII, 0 en caso contrario.
 * 
 * Señales Públicas:
 * - actionTaken: 1 si se aplicó censura, 0 si pasó sin cambios.
 * - auditHash: El hash resultante (Poseidon) que se ancla en blockchain/logs.
 */
template DlpAudit() {
    // Señales de Entrada
    signal input payloadHash;
    signal input hasPII;
    signal input actionTaken;
    
    // Señales de Salida
    signal output auditHash;

    // Restricción 1: Validar que hasPII es Booleano (0 o 1)
    hasPII * (hasPII - 1) === 0;

    // Restricción 2: Validar que actionTaken es Booleano
    actionTaken * (actionTaken - 1) === 0;

    // Restricción 3: Máquina de Estados Política DLP
    // Si hasPII == 1, actionTaken DEBE SER 1.
    // Ecuación equivalente: hasPII * (1 - actionTaken) === 0
    // Si hasPII es 1 y actionTaken es 0 -> 1 * 1 = 1 != 0 (Falla)
    hasPII * (1 - actionTaken) === 0;

    // Restricción 4: Hash Poseidón de Auditoría
    // Computamos Poseidon(payloadHash, hasPII, actionTaken)
    component poseidon = Poseidon(3);
    poseidon.inputs[0] <== payloadHash;
    poseidon.inputs[1] <== hasPII;
    poseidon.inputs[2] <== actionTaken;

    auditHash <== poseidon.out;
}

component main {public [actionTaken]} = DlpAudit();
