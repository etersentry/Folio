import { App } from './app.js';
import { toastError } from './ui/toasts.js';

async function boot() {
  const app = new App();
  window.folio = app; // handy for debugging; the app never reads it back
  try {
    await app.start();
  } catch (error) {
    console.error('[folio] fallo al iniciar', error);
    toastError(`No se pudo iniciar la sesión anterior: ${error.message ?? error}`);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

window.addEventListener('error', (event) => {
  console.error('[folio]', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[folio] promesa rechazada', event.reason);
});
