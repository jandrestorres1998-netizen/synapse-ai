import { createLogger } from '../config/logger.js';
import { ENV } from '../config/env.js';

const log = createLogger('ErrorHandler');

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { message: `Ruta no encontrada: ${req.method} ${req.originalUrl}`, type: 'NotFound', code: 404 }
  });
}

/**
 * Terminal error handler.
 * Stack traces are logged, never returned: they disclose paths, versions and
 * internal structure to whoever triggered the error.
 */
export function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    log.error('Error no controlado', { message: err.message, stack: err.stack, path: req.originalUrl });
  } else {
    log.warn('Error de cliente', { message: err.message, status, path: req.originalUrl });
  }

  if (res.headersSent) return next(err);

  res.status(status).json({
    error: {
      message: status >= 500 && ENV.IS_PRODUCTION
        ? 'Error interno del gateway.'
        : err.message,
      type: err.name || 'GatewayError',
      code: status,
      ...(err.stage ? { stage: err.stage } : {}),
      ...(err.details && status < 500 ? { details: err.details } : {})
    }
  });
}
