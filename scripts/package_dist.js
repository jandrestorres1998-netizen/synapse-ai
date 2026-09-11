import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');
const EXTENSION_DIR = path.join(PROJECT_ROOT, 'extension');

if (!fs.existsSync(DIST_DIR)) {
  fs.mkdirSync(DIST_DIR, { recursive: true });
}

console.log("==============================================================================");
console.log("📦 SYNAPSE AI DISTRIBUTION PACKAGER");
console.log("==============================================================================\n");

// Simple pure-JS zip file creator using ZIP file format specification
class SimpleZip {
  constructor() {
    this.files = [];
  }

  addFile(name, contentBuffer) {
    this.files.push({
      name: name.replace(/\\/g, '/'),
      content: contentBuffer
    });
  }

  build() {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    for (const file of this.files) {
      const fileNameBuf = Buffer.from(file.name, 'utf8');
      const compressedContent = zlib.deflateRawSync(file.content);
      const crc = calcCrc(file.content);

      // Local file header (30 bytes + filename length)
      const localHdr = Buffer.alloc(30);
      localHdr.writeUInt32LE(0x04034b50, 0); // Signature
      localHdr.writeUInt16LE(20, 4);         // Version needed
      localHdr.writeUInt16LE(0, 6);          // General flag
      localHdr.writeUInt16LE(8, 8);          // Compression: Deflate
      localHdr.writeUInt16LE(0, 10);         // Mod time
      localHdr.writeUInt16LE(0, 12);         // Mod date
      localHdr.writeUInt32LE(crc, 14);        // CRC32
      localHdr.writeUInt32LE(compressedContent.length, 18); // Compressed size
      localHdr.writeUInt32LE(file.content.length, 22);      // Uncompressed size
      localHdr.writeUInt16LE(fileNameBuf.length, 26);       // Filename length
      localHdr.writeUInt16LE(0, 28);                        // Extra field length

      const localRecord = Buffer.concat([localHdr, fileNameBuf, compressedContent]);
      localHeaders.push(localRecord);

      // Central directory header (46 bytes + filename length)
      const centralHdr = Buffer.alloc(46);
      centralHdr.writeUInt32LE(0x02014b50, 0); // Signature
      centralHdr.writeUInt16LE(20, 4);          // Version made by
      centralHdr.writeUInt16LE(20, 6);          // Version needed
      centralHdr.writeUInt16LE(0, 8);           // General flag
      centralHdr.writeUInt16LE(8, 10);          // Compression: Deflate
      centralHdr.writeUInt16LE(0, 12);          // Mod time
      centralHdr.writeUInt16LE(0, 14);          // Mod date
      centralHdr.writeUInt32LE(crc, 16);         // CRC32
      centralHdr.writeUInt32LE(compressedContent.length, 20); // Compressed size
      centralHdr.writeUInt32LE(file.content.length, 24);      // Uncompressed size
      centralHdr.writeUInt16LE(fileNameBuf.length, 28);       // Filename length
      centralHdr.writeUInt16LE(0, 30);                        // Extra field length
      centralHdr.writeUInt16LE(0, 32);                        // Comment length
      centralHdr.writeUInt16LE(0, 34);                        // Disk start
      centralHdr.writeUInt16LE(0, 36);                        // Internal attrs
      centralHdr.writeUInt32LE(0, 38);                        // External attrs
      centralHdr.writeUInt32LE(offset, 42);                   // Relative offset

      centralHeaders.push(Buffer.concat([centralHdr, fileNameBuf]));
      offset += localRecord.length;
    }

    const centralDirBuffer = Buffer.concat(centralHeaders);
    const localDataBuffer = Buffer.concat(localHeaders);

    // End of central directory record (22 bytes)
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // Signature
    eocd.writeUInt16LE(0, 4);          // Disk number
    eocd.writeUInt16LE(0, 6);          // Disk where central dir starts
    eocd.writeUInt16LE(this.files.length, 8);  // Records on this disk
    eocd.writeUInt16LE(this.files.length, 10); // Total records
    eocd.writeUInt32LE(centralDirBuffer.length, 12); // Central dir size
    eocd.writeUInt32LE(localDataBuffer.length, 16);  // Central dir offset
    eocd.writeUInt16LE(0, 20);                      // Comment length

    return Buffer.concat([localDataBuffer, centralDirBuffer, eocd]);
  }
}

function calcCrc(buf) {
  let crc = 0 ^ (-1);
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
  }
  crcTable[n] = c;
}

function addDirectoryToZip(zip, baseDir, relativePrefix = '') {
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name);
    const relPath = path.join(relativePrefix, entry.name);
    if (entry.isDirectory()) {
      addDirectoryToZip(zip, fullPath, relPath);
    } else {
      zip.addFile(relPath, fs.readFileSync(fullPath));
    }
  }
}

// 1. Package Web Extension ZIP
const extZip = new SimpleZip();
addDirectoryToZip(extZip, EXTENSION_DIR);
const extZipBuffer = extZip.build();
// La version sale del manifiesto, no de una constante: el paquete se quedo en
// la v1.0.0 mientras el manifiesto ya iba por la 2.0.0, y nadie lo noto porque
// el nombre del fichero estaba escrito a mano.
const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
const extZipPath = path.join(DIST_DIR, `synapse-ai-extension-v${manifest.version}.zip`);
fs.writeFileSync(extZipPath, extZipBuffer);

console.log(`✓ Paquete de Extensión Web Creado: ${extZipPath} (${(extZipBuffer.length / 1024).toFixed(1)} KB)`);
console.log(`✓ Compatible con Chrome, Brave, Microsoft Edge y Firefox.`);

// 2. Package the server itself.
//
// Sin esto, dist/ solo contenia la extension: la web ofrecia el accesorio y no
// el programa. Se incluye lo justo para arrancar y para poder auditarlo, y se
// deja fuera lo que nunca debe salir de esta maquina.
const SERVIDOR_INCLUYE = [
  'server', 'public', 'scripts', 'tests',
  'Dockerfile', 'docker-compose.yml', '.env.example',
  'package.json', 'package-lock.json', 'LICENSE', 'README.md'
];

const srvZip = new SimpleZip();
let incluidos = 0;
for (const nombre of SERVIDOR_INCLUYE) {
  const origen = path.join(PROJECT_ROOT, nombre);
  if (!fs.existsSync(origen)) {
    console.log(`  · omitido (no existe): ${nombre}`);
    continue;
  }
  if (fs.statSync(origen).isDirectory()) addDirectoryToZip(srvZip, origen, nombre);
  else srvZip.addFile(nombre, fs.readFileSync(origen));
  incluidos++;
}

// Cinturon y tirantes: si algun dia alguien anade data/ o .env a la lista de
// arriba, esto lo para antes de publicar el paquete.
const PROHIBIDO = [/^data[\/]/, /^\.env$/, /vendor_private/, /^node_modules[\/]/, /^dist[\/]/];
const fuga = srvZip.files.find(f => PROHIBIDO.some(re => re.test(f.name)));
if (fuga) {
  console.error(`
✗ ABORTADO: el paquete del servidor incluiria "${fuga.name}", que no debe distribuirse.`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));
const srvZipBuffer = srvZip.build();
const srvZipPath = path.join(DIST_DIR, `synapse-ai-servidor-v${pkg.version}.zip`);
fs.writeFileSync(srvZipPath, srvZipBuffer);

console.log(`✓ Paquete del Servidor Creado: ${srvZipPath} (${(srvZipBuffer.length / 1024).toFixed(1)} KB)`);
console.log(`  ${incluidos} elementos, ${srvZip.files.length} ficheros. Sin data/, sin .env, sin node_modules.`);
console.log("\n==============================================================================");
console.log("🎉 EMPAQUETADO COMPLETADO EXITOSAMENTE");
console.log("==============================================================================");
