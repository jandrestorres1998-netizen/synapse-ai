import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createLogger } from '../config/logger.js';

const log = createLogger('Downloads');
const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

/**
 * Catálogo de descargas con su huella SHA-256.
 *
 * La huella se calcula del fichero que hay en disco, no de una constante en el
 * código. Un producto de seguridad que publica una descarga con un checksum
 * escrito a mano acaba publicando el checksum de otra versión, y entonces el
 * checksum ya no comprueba nada: solo tranquiliza.
 *
 * Se cachea por tamaño y fecha de modificación, así que un repaquetado se nota
 * sin reiniciar.
 */
const cache = new Map();

function describe(fileName) {
  const filePath = path.join(DIST_DIR, fileName);
  const stat = fs.statSync(filePath);
  const clave = `${stat.size}:${stat.mtimeMs}`;
  const guardado = cache.get(fileName);

  if (guardado?.clave === clave) return guardado.valor;

  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  const version = fileName.match(/v(\d+\.\d+\.\d+)/)?.[1] ?? null;

  const valor = {
    file: fileName,
    version,
    bytes: stat.size,
    modified: stat.mtime.toISOString(),
    sha256,
    url: `/descargas/${encodeURIComponent(fileName)}`
  };

  cache.set(fileName, { clave, valor });
  return valor;
}

/** GET /api/public/downloads — público: la página de descargas no pide clave. */
export function listDownloads(req, res) {
  let archivos = [];

  try {
    archivos = fs.existsSync(DIST_DIR)
      ? fs.readdirSync(DIST_DIR).filter(f => f.endsWith('.zip')).sort()
      : [];
  } catch (err) {
    log.error('No se pudo leer el directorio de distribución', { error: err.message });
  }

  res.json({
    downloads: archivos.map(describe),
    note: 'Comprueba la huella antes de instalar. En Windows: certutil -hashfile <fichero> SHA256. En macOS o Linux: shasum -a 256 <fichero>.'
  });
}
