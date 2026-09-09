import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ICONS_DIR = path.join(__dirname, '../extension/icons');

if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

// 1. Create crisp Master SVG Icon
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0e1524"/>
      <stop offset="100%" stop-color="#080c14"/>
    </linearGradient>
    <linearGradient id="neonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="50%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  
  <!-- Outer Shield Base -->
  <path d="M 64 6 L 114 28 C 114 74, 64 122, 64 122 C 64 122, 14 74, 14 28 Z" fill="url(#shieldGrad)" stroke="url(#neonGrad)" stroke-width="4" filter="url(#glow)"/>
  
  <!-- Synapse AI Circuit Pattern -->
  <path d="M 64 24 L 28 42 L 64 60 L 100 42 Z" fill="none" stroke="url(#neonGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M 28 72 L 64 90 L 100 72" fill="none" stroke="url(#neonGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M 28 57 L 64 75 L 100 57" fill="none" stroke="url(#neonGrad)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  
  <!-- Center Energy Core -->
  <circle cx="64" cy="60" r="5" fill="#38bdf8" filter="url(#glow)"/>
  <circle cx="64" cy="75" r="4" fill="#818cf8"/>
  <circle cx="64" cy="90" r="3" fill="#c084fc"/>
</svg>`;

fs.writeFileSync(path.join(ICONS_DIR, 'icon.svg'), svgContent, 'utf8');

// Function to generate pure RGBA PNG buffer without external binary dependencies
function createPng(size, primaryColor = [56, 189, 248, 255]) {
  const width = size;
  const height = size;
  
  // Uncompressed raw image data: each scanline has 1 filter byte (0) + width * 4 bytes RGBA
  const rawData = Buffer.alloc((1 + width * 4) * height);
  const center = size / 2;
  const radius = size * 0.44;
  
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const dx = x - center;
      const dy = y - center;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= radius) {
        // Shield gradient fill
        const alpha = Math.min(255, Math.max(0, Math.floor((radius - dist + 1) * 255)));
        const gradRatio = (x + y) / (size * 2);
        rawData[offset++] = Math.floor(14 * (1 - gradRatio) + 56 * gradRatio); // R
        rawData[offset++] = Math.floor(21 * (1 - gradRatio) + 189 * gradRatio); // G
        rawData[offset++] = Math.floor(36 * (1 - gradRatio) + 248 * gradRatio); // B
        rawData[offset++] = alpha; // A
      } else {
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
        rawData[offset++] = 0;
      }
    }
  }
  
  // Deflate compressed data
  const compressed = zlib.deflateSync(rawData);
  
  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: RGBA
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  
  const ihdrChunk = createChunk('IHDR', ihdrData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  const typeBuf = Buffer.from(type, 'ascii');
  const crcPayload = Buffer.concat([typeBuf, data]);
  
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(calcCrc(crcPayload), 0);
  
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

// CRC32 implementation
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

// Generate PNG sizes
[16, 32, 48, 128].forEach(size => {
  const pngBuf = createPng(size);
  fs.writeFileSync(path.join(ICONS_DIR, `icon${size}.png`), pngBuf);
  console.log(`✓ Icono generado: icon${size}.png (${size}x${size})`);
});

console.log('✓ Iconos para Manifest V3 creados exitosamente.');
