/**
 * SynapseAI Structured Logger
 * 
 * Centralized logging with severity levels, structured JSON output,
 * and module tagging. Replaces scattered console.log/warn/error calls.
 */

const LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 };
const LEVEL_LABELS = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

const currentLevel = LEVELS[process.env.LOG_LEVEL?.toUpperCase()] ?? LEVELS.INFO;

function formatEntry(level, module, message, meta = null) {
  const entry = {
    ts: new Date().toISOString(),
    level: LEVEL_LABELS[level],
    module,
    msg: message
  };
  if (meta) entry.meta = meta;
  return entry;
}

function emit(level, module, message, meta) {
  if (level < currentLevel) return;
  const entry = formatEntry(level, module, message, meta);
  const line = JSON.stringify(entry);

  if (level >= LEVELS.ERROR) {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

/**
 * Creates a scoped logger for a specific module.
 * @param {string} moduleName - e.g. 'Gateway', 'DLP', 'Vault', 'TLS'
 * @returns {{ debug, info, warn, error, fatal }}
 */
export function createLogger(moduleName) {
  return {
    debug: (msg, meta) => emit(LEVELS.DEBUG, moduleName, msg, meta),
    info:  (msg, meta) => emit(LEVELS.INFO,  moduleName, msg, meta),
    warn:  (msg, meta) => emit(LEVELS.WARN,  moduleName, msg, meta),
    error: (msg, meta) => emit(LEVELS.ERROR, moduleName, msg, meta),
    fatal: (msg, meta) => emit(LEVELS.FATAL, moduleName, msg, meta)
  };
}
