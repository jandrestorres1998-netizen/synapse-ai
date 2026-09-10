import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { ENV, validateEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { securityHeaders } from './middlewares/security-headers.js';
import { requestLogger } from './middlewares/request-logger.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { createAuthMiddleware } from './middlewares/auth.js';
import { createRateLimiter, resolveClientIp } from './middlewares/rate-limiter.js';
import { validateOpenAIInput } from './middlewares/validators.js';
import { handleOpenAIChatCompletions } from './controllers/gateway.controller.js';
import { listDownloads } from './controllers/downloads.controller.js';
import { handleStripeWebhook } from './controllers/license.controller.js';
import { getHealth } from './controllers/stats.controller.js';
import { providers, integrity, budget } from './config/container.js';
import { logProviderStartupState, startProviderProbes } from './providers/index.js';
import apiRoutes from './routes/api.routes.js';
import v1Routes from './routes/v1.routes.js';

const log = createLogger('Server');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Fail fast on an unsafe configuration ─────────────────────────────────────
const validation = validateEnv(ENV);
for (const warning of validation.warnings) log.warn(warning);
if (!validation.isValid) {
  for (const error of validation.errors) log.fatal(error);
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');

// Express only honours X-Forwarded-* when told how many proxies sit in front.
app.set('trust proxy', ENV.TRUST_PROXY_HOPS);

app.use(securityHeaders);
app.use((req, res, next) => {
  req.clientIp = resolveClientIp(req, ENV);
  next();
});
app.use(requestLogger);

// An allowlist, not a wildcard: this process holds provider credentials, so any
// origin able to call it can spend the operator's budget and read their history.
//
// El mismo origen se acepta siempre, sin pasar por la lista. No es una
// relajacion: una peticion del propio sitio no es trafico cruzado. Y omitirlo
// rompia el panel entero, porque <script type="module"> se pide en modo CORS y
// manda cabecera Origin incluso hacia su propio host: al desplegar en un puerto
// o dominio que no estuviera en SYNAPSE_CORS_ORIGINS, el panel se quedaba sin
// JavaScript con un 500 y sin ninguna pista de por que.
app.use(cors((req, callback) => {
  callback(null, {
    origin(candidate, cb) {
      if (!candidate) return cb(null, true); // curl, server-to-server, SDKs
      if (sameHost(candidate, req.get('host'))) return cb(null, true);
      if (ENV.CORS_ORIGINS.includes(candidate)) return cb(null, true);
      cb(new Error(`Origen no permitido por CORS: ${candidate}`));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-synapse-session']
  });

  // Referenciado arriba; se declara aqui para que quede junto a su unico uso.
  function sameHost(candidate, host) {
    if (!host) return false;
    try {
      // Se compara el host con el puerto, no el esquema: detras de un proxy
      // inverso el servidor ve http donde el navegador ve https.
      return new URL(candidate).host === host;
    } catch {
      return false;
    }
  }
}));

// ── Public routes (no authentication) ────────────────────────────────────────
app.get('/healthz', getHealth);

// La pagina de descargas es publica: pedir una clave para bajarse el paquete
// que sirve para empezar a usar el producto no tendria ningun sentido.
app.get('/api/public/downloads', listDownloads);

// Un producto de seguridad sin una via declarada para avisar de un fallo no es
// creible. RFC 9116.
app.get('/.well-known/security.txt', (req, res) => {
  res.type('text/plain').send([
    '# Si encuentras un fallo de seguridad, escribe antes de publicarlo.',
    'Contact: mailto:seguridad@synapse.example',
    'Preferred-Languages: es, en',
    'Canonical: ' + req.protocol + '://' + req.get('host') + '/.well-known/security.txt',
    'Policy: ' + req.protocol + '://' + req.get('host') + '/legal/vulnerabilidades',
    '',
    '# Respondemos en 5 dias laborables. No emprendemos acciones legales contra',
    '# quien investigue de buena fe y no acceda a datos de terceros.'
  ].join('\n'));
});

// Stripe verifies a signature over the exact bytes, so the raw body is kept.
app.post('/api/webhooks/stripe',
  express.raw({ type: 'application/json', limit: '1mb' }),
  (req, res, next) => { req.rawBody = req.body; next(); },
  handleStripeWebhook
);

// ── Authenticated API ────────────────────────────────────────────────────────
const authenticate = createAuthMiddleware(ENV);
const rateLimiter = createRateLimiter(ENV);

app.use(express.json({ limit: '2mb' }));

app.post('/v1/chat/completions', authenticate, rateLimiter, validateOpenAIInput, handleOpenAIChatCompletions);
app.use('/v1', authenticate, v1Routes);
app.use('/api', authenticate, apiRoutes);

// El sitio público vive en la raíz y el panel en /app. Ambos se sirven al final
// para que no puedan ensombrecer una ruta de la API.
const publicDir = path.join(__dirname, '../public');

app.get('/app', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Los paquetes se sirven desde el propio dominio, nunca desde un tercero.
// Sin redireccion ni indice: /descargas es la pagina, y /descargas/<fichero>
// es el artefacto. Con el redirect por defecto, la estatica se quedaba con la
// ruta y la pagina no llegaba a servirse nunca.
app.use('/descargas', express.static(path.join(__dirname, '../dist'), { redirect: false, index: false }));

// Paginas sin extension: /legal/privacidad sirve public/legal/privacidad.html.
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.includes('.')) return next();
  const candidato = path.join(publicDir, `${req.path.replace(/^\/+/, '')}.html`);
  if (candidato.startsWith(publicDir) && fs.existsSync(candidato)) return res.sendFile(candidato);
  next();
});
app.use(express.static(publicDir, { index: 'landing.html' }));

// Una ruta de navegador que no existe recibe la página; una de API, el JSON de
// siempre. Devolver HTML a un cliente que espera JSON rompe su parseo.
app.use((req, res, next) => {
  const quiereHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');
  if (!quiereHtml) return next();

  const pagina = path.join(publicDir, '404.html');
  if (fs.existsSync(pagina)) return res.status(404).sendFile(pagina);
  next();
});

app.use(notFoundHandler);
app.use(errorHandler);

// ── Boot ─────────────────────────────────────────────────────────────────────
// Probe first: a provider that needs no key can still be unreachable.
startProviderProbes(providers);
await new Promise(resolve => setTimeout(resolve, 300));
logProviderStartupState(providers);

const integrityResult = integrity.verifyIntegrity();
if (!integrityResult.isValid) {
  log.warn('Verificación de integridad de archivos con discrepancias', {
    status: integrityResult.status,
    files: integrityResult.tamperedFiles.map(f => f.file)
  });
}

const server = app.listen(ENV.PORT, ENV.HOST, () => {
  log.info('SynapseAI Gateway en línea', {
    url: `http://${ENV.HOST}:${ENV.PORT}`,
    env: ENV.NODE_ENV,
    authEnabled: !ENV.AUTH.DISABLE_AUTH,
    corsOrigins: ENV.CORS_ORIGINS,
    realProviders: providers.hasRealProvider()
  });
});

// Drain in-flight requests before exiting so a deploy does not cut a stream.
function shutdown(signal) {
  log.info(`Señal ${signal} recibida; cerrando de forma ordenada.`);
  // The spend ledger is written on a debounce, so the last window would be lost
  // on exit — and a budget that forgets on restart is not a budget.
  budget.flush();
  server.close(() => {
    log.info('Servidor cerrado.');
    process.exit(0);
  });
  setTimeout(() => {
    log.warn('Cierre forzado tras el tiempo de gracia.');
    process.exit(1);
  }, 10_000).unref();
}

// A crash between reserving and settling would otherwise hold budget forever.
const reservationSweep = setInterval(() => budget.expireStaleReservations(), 60_000);
reservationSweep.unref();

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', reason => {
  log.error('Promesa rechazada sin manejar', { reason: reason?.message ?? String(reason) });
});

export default app;
export { server };
