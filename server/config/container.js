/**
 * Composition root.
 *
 * Every domain service is constructed once here, wired with the validated
 * environment, and shared by the controllers. Nothing else in the codebase
 * instantiates a service directly.
 */

import path from 'path';
import fs from 'fs';
import { ENV } from './env.js';
import { DLPEngine } from '../dlp-engine.js';
import { SmartRouter } from '../smart-router.js';
import { ResponseCache } from '../core/response-cache.js';
import { Telemetry } from '../core/telemetry.js';
import { BudgetLedger } from '../core/budget.js';
import { MemoryHub } from '../memory-hub.js';
import { SecureVault } from '../secure-vault.js';
import { ProviderRegistry } from '../providers/index.js';
import { IntegrityChecker } from '../integrity-checker.js';
import { LicenseManager } from '../license-manager.js';
import { PromptInjectionShield } from '../security/prompt-injection-shield.js';
import { AuditChainLedger } from '../security/audit-chain.js';

fs.mkdirSync(ENV.DATA_DIR, { recursive: true });

export const env = ENV;

export const vault = new SecureVault({ dataDir: ENV.DATA_DIR });

export const providers = new ProviderRegistry(vault, ENV);

export const router = new SmartRouter(providers);

export const dlp = new DLPEngine({
  storePlaintextSamples: ENV.DLP.STORE_PLAINTEXT_SAMPLES
});

export const cache = new ResponseCache({
  exactEnabled: ENV.CACHE.EXACT_ENABLED,
  semanticEnabled: ENV.CACHE.SEMANTIC_ENABLED,
  semanticThreshold: ENV.CACHE.SEMANTIC_THRESHOLD,
  ttlMs: ENV.CACHE.TTL_MS,
  maxEntries: ENV.CACHE.MAX_ENTRIES
});

export const memory = new MemoryHub({ dataDir: ENV.DATA_DIR });

export const injectionShield = new PromptInjectionShield();

export const auditLedger = new AuditChainLedger({
  filePath: path.join(ENV.DATA_DIR, 'audit-ledger.jsonl'),
  hmacKey: process.env.SYNAPSE_AUDIT_HMAC_KEY || ''
});

export const integrity = new IntegrityChecker();

export const licenseManager = new LicenseManager({ dataDir: ENV.DATA_DIR });

export const telemetry = new Telemetry();

export const budget = new BudgetLedger({
  dataDir: ENV.DATA_DIR,
  dailyUsdPerTenant: ENV.BUDGET.DAILY_USD_PER_TENANT,
  monthlyUsdPerTenant: ENV.BUDGET.MONTHLY_USD_PER_TENANT,
  dailyUsdGlobal: ENV.BUDGET.DAILY_USD_GLOBAL,
  monthlyUsdGlobal: ENV.BUDGET.MONTHLY_USD_GLOBAL
});
