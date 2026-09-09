import crypto from 'crypto';

/**
 * Verifies a Stripe `Stripe-Signature` header against the raw request body.
 *
 * The previous handler trusted the JSON body verbatim and minted a signed
 * ENTERPRISE license for whoever posted it — an unauthenticated endpoint that
 * handed out the paid product. Signature verification and a timestamp window
 * are both required: without the window, a captured payload replays forever.
 */
export function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader) return { ok: false, reason: 'Falta la cabecera Stripe-Signature.' };

  const parts = Object.fromEntries(
    signatureHeader.split(',').map(kv => kv.split('=').map(s => s.trim()))
  );

  const timestamp = parseInt(parts.t, 10);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) {
    return { ok: false, reason: 'Cabecera Stripe-Signature malformada.' };
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (age > toleranceSeconds) {
    return { ok: false, reason: `Marca de tiempo fuera de tolerancia (${age}s).` };
  }

  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: 'Firma inválida.' };
  }

  return { ok: true };
}

