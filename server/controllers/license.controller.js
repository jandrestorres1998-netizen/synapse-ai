import { licenseManager, env } from '../config/container.js';
import { verifyStripeSignature } from '../security/stripe-signature.js';
import { createLogger } from '../config/logger.js';

const log = createLogger('License');

export function getLicenseStatus(req, res) {
  res.json(licenseManager.getLicenseStatus());
}

export function activateLicense(req, res) {
  const { licenseKey } = req.body;
  if (!licenseKey || typeof licenseKey !== 'string') {
    return res.status(400).json({ error: { message: 'El campo "licenseKey" es requerido.', code: 400 } });
  }

  const result = licenseManager.activateLicense(licenseKey);
  if (!result.success) {
    log.warn('Activación de licencia rechazada', { reason: result.reason });
    return res.status(403).json({ error: { message: result.reason, code: 403 } });
  }

  log.info('Licencia activada', { tier: result.tier });
  res.json(result);
}

export function deactivateLicense(req, res) {
  res.json(licenseManager.deactivateLicense());
}

export async function handleStripeWebhook(req, res) {
  const secret = env.BILLING.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    log.warn('Webhook recibido con STRIPE_WEBHOOK_SECRET sin configurar; se rechaza.');
    return res.status(503).json({ error: { message: 'Webhooks de facturación deshabilitados en esta instalación.', code: 503 } });
  }

  const rawBody = req.rawBody?.toString('utf8');
  if (!rawBody) {
    return res.status(400).json({ error: { message: 'Cuerpo de la petición no disponible para verificar la firma.', code: 400 } });
  }

  const verification = verifyStripeSignature(rawBody, req.get('stripe-signature'), secret);
  if (!verification.ok) {
    log.warn('Webhook de Stripe rechazado', { reason: verification.reason });
    return res.status(400).json({ error: { message: verification.reason, code: 400 } });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: { message: 'Cuerpo JSON inválido.', code: 400 } });
  }

  // Acknowledge quickly; issuing and delivering the license belongs to the
  // vendor's fulfilment service, which must hold the signing key. This gateway
  // runs on customer hardware and must never carry that key.
  log.info('Evento de facturación verificado', { type: event.type, id: event.id });

  res.json({
    received: true,
    type: event.type,
    note: 'Evento verificado. La emisión de licencias se realiza en el servicio de fulfilment del proveedor, no en esta instancia.'
  });
}
