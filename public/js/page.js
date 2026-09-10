/**
 * Armazón compartido de las páginas de documento.
 *
 * La cabecera y el pie se inyectan desde aquí en vez de copiarse en cada
 * fichero: nueve copias del mismo menú son nueve sitios donde olvidarse de
 * actualizar un enlace.
 */

const NAV = [
  ['/#recorrido', 'Cómo funciona'],
  ['/#comparativa', 'Comparativa'],
  ['/#limites', 'Lo que no hace'],
  ['/#precios', 'Precios'],
  ['/#preguntas', 'Preguntas']
];

const PIE = [
  ['El producto', [
    ['/#como-funciona', 'Qué hace'],
    ['/#limites', 'Lo que no hace'],
    ['/auditoria', 'Auditoría adversaria'],
    ['/extension', 'Extensión del navegador'],
    ['/#precios', 'Precios'],
    ['/app', 'Ver el panel']
  ]],
  ['Documentación', [
    ['/docs', 'Índice de guías'],
    ['/docs/instalacion', 'Instalación'],
    ['/docs/configuracion', 'Configuración (.env)'],
    ['/docs/api', 'Referencia de API'],
    ['/docs/dlp', 'Catálogo de borrado'],
    ['/descargas', 'Descargas']
  ]],
  ['Legal', [
    ['/legal/aviso-legal', 'Aviso legal'],
    ['/legal/privacidad', 'Privacidad'],
    ['/legal/terminos', 'Condiciones'],
    ['/legal/cookies', 'Cookies']
  ]],
  ['Proyecto', [
    ['/legal/licencia', 'Licencia MIT'],
    ['/.well-known/security.txt', 'security.txt'],
    ['/legal/uso-aceptable', 'Uso aceptable'],
    ['/legal/vulnerabilidades', 'Avisar de un fallo'],
    ['/#contacto', 'Contacto']
  ]]
];

const MARCA = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>
  </svg>`;

function cabecera() {
  return `
    <header class="site-head">
      <div class="wrap">
        <a class="brand" href="/">
          <span class="brand-mark">${MARCA}</span>
          <span class="brand-name">SynapseAI</span>
        </a>
        <nav class="site-nav" aria-label="Principal">
          <span class="nav-glide" aria-hidden="true"></span>
          ${NAV.map(([href, texto]) => `<a href="${href}">${texto}</a>`).join('')}
        </nav>
        <div class="head-actions">
          <a href="/app">Ver el panel</a>
          <a class="btn" href="/#instalacion">Instalar</a>
        </div>
      </div>
    </header>`;
}

function pie() {
  return `
    <footer class="site-foot">
      <div class="wrap">
        <div class="foot-cols">
          ${PIE.map(([titulo, enlaces]) => `
            <div class="foot-col">
              <span class="eyebrow">${titulo}</span>
              ${enlaces.map(([href, texto]) => `<a href="${href}">${texto}</a>`).join('')}
            </div>`).join('')}
        </div>
        <div class="foot-legal">
          <span>Programa libre, licencia MIT</span><span>·</span><span>Se instala en tu red</span>
          <span class="push">Sin seguimiento ni analítica sin tu permiso</span>
        </div>
      </div>
    </footer>`;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('site-head')?.insertAdjacentHTML('afterend', cabecera());
  document.getElementById('site-head')?.remove();
  document.getElementById('site-foot')?.insertAdjacentHTML('afterend', pie());
  document.getElementById('site-foot')?.remove();

  // Índice lateral: se construye de los encabezados que ya están en la página.
  const indice = document.getElementById('doc-index');
  if (indice) {
    const titulos = [...document.querySelectorAll('.doc h2')];
    titulos.forEach((h, i) => { if (!h.id) h.id = `s${i + 1}`; });
    indice.innerHTML = titulos.map(h => `<a href="#${h.id}">${h.textContent}</a>`).join('');
  }
});
