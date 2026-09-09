import { IntegrityChecker } from '../server/integrity-checker.js';

const manifest = new IntegrityChecker().generateManifest();
console.log(`Manifiesto de integridad generado con ${Object.keys(manifest.files).length} archivos (${manifest.algorithm}).`);
