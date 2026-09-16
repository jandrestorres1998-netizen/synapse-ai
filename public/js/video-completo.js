/**
 * El vídeo entero, bajo demanda.
 *
 * Pesa 14 MB, así que el <video> del diálogo nace sin `src`: quien no pulse
 * «Verlo entero» no se descarga nada. Poner el archivo en el marcado y confiar
 * en `preload="none"` no basta — algunos navegadores piden metadatos igual.
 *
 * Mientras el diálogo está abierto, el bucle de la sección se pausa: dos
 * vídeos moviéndose a la vez compiten, y el de detrás ya no lo está viendo
 * nadie.
 *
 * La limpieza no se cuelga del evento `close`: hay navegadores donde no se
 * dispara al cerrar por código, y entonces los 14 MB se quedan en memoria el
 * resto de la visita. Se llama a mano desde cada salida, y el evento queda
 * como red por si el cierre viene de un sitio que no controlamos.
 */

const FUENTE = '/media/recorrido-completo.mp4';

document.addEventListener('DOMContentLoaded', () => {
  const abrir = document.getElementById('btn-ver-entero');
  const cerrar = document.getElementById('btn-cerrar-video');
  const dialogo = document.getElementById('dlg-video');
  const video = document.getElementById('video-completo');
  const bucle = document.querySelector('.fondo-lienzo video');

  if (!abrir || !dialogo || !video) return;

  // Sin <dialog> el botón no debe quedarse ahí sin hacer nada.
  if (typeof dialogo.showModal !== 'function') {
    abrir.remove();
    return;
  }

  let limpiando = false;

  const soltar = () => {
    if (limpiando) return;
    limpiando = true;

    video.pause();
    // Soltar el archivo: si no, sigue ocupando memoria toda la visita.
    video.removeAttribute('src');
    video.load();

    // El bucle solo se reanuda si está en pantalla; fuera de ella el navegador
    // lo pausa igualmente y pedir play sería trabajo tirado.
    if (bucle) {
      const caja = bucle.getBoundingClientRect();
      const visible = caja.top < window.innerHeight && caja.bottom > 0;
      if (visible) bucle.play().catch(() => {});
    }

    limpiando = false;
  };

  const cerrarTodo = () => {
    if (dialogo.open) dialogo.close();
    soltar();
  };

  abrir.addEventListener('click', () => {
    if (!video.getAttribute('src')) video.setAttribute('src', FUENTE);
    dialogo.showModal();
    bucle?.pause?.();
    video.play().catch(() => {
      // Si el navegador no deja arrancar solo, quedan los controles.
    });
  });

  cerrar?.addEventListener('click', cerrarTodo);

  // Pulsar fuera del vídeo cierra, que es lo que espera cualquiera.
  dialogo.addEventListener('click', evento => {
    if (evento.target === dialogo) cerrarTodo();
  });

  // La tecla de escape cierra por su cuenta; aquí solo se limpia detrás.
  dialogo.addEventListener('cancel', () => setTimeout(soltar, 0));
  dialogo.addEventListener('close', soltar);
});
