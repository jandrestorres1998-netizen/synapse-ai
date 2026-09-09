import { Router } from 'express';
import { handleGatewayProcess } from '../controllers/gateway.controller.js';
import { getStats, getSecurityLogs, exportSecurityLogs, getModels, getIntegrity, recordExtensionEvent, getBudget } from '../controllers/stats.controller.js';
import { getAllMemories, createMemory, updateMemory, toggleMemory, deleteMemory } from '../controllers/memory.controller.js';
import { getVaultStatus, setVaultKey, deleteVaultKey } from '../controllers/vault.controller.js';
import { getLicenseStatus, activateLicense, deactivateLicense } from '../controllers/license.controller.js';
import { createRateLimiter } from '../middlewares/rate-limiter.js';
import { validateGatewayInput, validateVaultInput, validateMemoryInput } from '../middlewares/validators.js';

const router = Router();
const rateLimiter = createRateLimiter();

// Inference
router.post('/gateway/process', rateLimiter, validateGatewayInput, handleGatewayProcess);

// Telemetry & audit
router.get('/stats', getStats);
router.get('/security/logs', getSecurityLogs);
router.get('/security/export', exportSecurityLogs);
router.get('/integrity', getIntegrity);
router.get('/budget', getBudget);
router.get('/models', getModels);
router.post('/extension/event', rateLimiter, recordExtensionEvent);

// Context & memory hub
router.get('/memory', getAllMemories);
router.post('/memory', validateMemoryInput, createMemory);
router.put('/memory/:id', updateMemory);
router.patch('/memory/:id/toggle', toggleMemory);
router.delete('/memory/:id', deleteMemory);

// Provider credential vault
router.get('/vault/status', getVaultStatus);
router.post('/vault/keys', validateVaultInput, setVaultKey);
router.delete('/vault/keys/:provider', deleteVaultKey);

// Licensing
router.get('/license/status', getLicenseStatus);
router.post('/license/activate', activateLicense);
router.delete('/license/deactivate', deactivateLicense);

export default router;
