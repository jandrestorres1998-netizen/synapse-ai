/**
 * SynapseAI Request Audit Trail Middleware
 * 
 * Logs every API request with timing, method, path, and status code.
 * Integrates with the structured logger for observable, filterable output.
 */

import { createLogger } from '../config/logger.js';

const log = createLogger('HTTP');

export function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();

  // Hook into response finish to capture status code and elapsed time
  res.on('finish', () => {
    const elapsed = Number(process.hrtime.bigint() - start) / 1_000_000; // ns → ms
    const meta = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Math.round(elapsed * 100) / 100,
      ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress
    };

    if (res.statusCode >= 500) {
      log.error('Request failed', meta);
    } else if (res.statusCode >= 400) {
      log.warn('Client error', meta);
    } else {
      log.info('Request completed', meta);
    }
  });

  next();
}
