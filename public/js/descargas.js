import { esc } from './ui.js';

/**
 * Lista de descargas con su huella.
 *
 * La huella la calcula el servidor del archivo que hay en disco. Si estuviera
 * escrita a mano en el HTML, al repaquetar la extensión seguiría publicándose
 * la huella de la versión anterior — y entonces el checksum ya no comprueba
 * nada, solo tranquiliza.
 */

function tamano(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function tarjeta(archivo) {
  const fecha = new Date(archivo.modified).toLocaleDateString('es-ES', {
    day: 'numeric', month: 'long', year: 'numeric'
  });

  return `
    <div class="dl-card">
      <div class="dl-main">
        <span class="dl-name">Extensión para el navegador${archivo.version ? ` · ${esc(archivo.version)}` : ''}</span>
        <span class="dl-meta">${esc(archivo.file)} · ${tamano(archivo.bytes)} · ${esc(fecha)}</span>
        <span class="dl-hash">SHA-256 ${esc(archivo.sha256)}</span>
      </div>
      <div class="dl-actions">
        <a class="btn" href="${esc(archivo.url)}" download>Descargar</a>
        <button class="btn btn-secondary" data-copiar="${esc(archivo.sha256)}" type="button">Copiar huella</button>
      </div>
    </div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const caja = document.getElementById('lista-descargas');
  if (!caja) return;

  try {
    const respuesta = await fetch('/api/public/downloads');
    if (!respuesta.ok) throw new Error(`El servidor respondió ${respuesta.status}`);

    const datos = await respuesta.json();

    caja.innerHTML = datos.downloads.length
      ? datos.downloads.map(tarjeta).join('') + `<p style="font-size:14px;color:var(--ink-faint);margin:6px 0 0">${esc(datos.note)}</p>`
      : '<p>Todavía no hay ningún paquete publicado.</p>';

    caja.querySelectorAll('[data-copiar]').forEach(boton => {
      boton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(boton.dataset.copiar);
          boton.textContent = 'Copiada';
        } catch {
          boton.textContent = 'No se pudo copiar';
        }
        setTimeout(() => { boton.textContent = 'Copiar huella'; }, 1400);
      });
    });
  } catch (err) {
    caja.innerHTML = `<p>No se pudo leer la lista de descargas: ${esc(err.message)}</p>`;
  }
});
