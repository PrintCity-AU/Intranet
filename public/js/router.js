// Hash-based routing: "#/machines/3?x=1" finds the matching screen and draws it into a fresh container.
import { $, esc } from './ui.js';

let routes = [];
let current = null;

export function setRoutes(list) { routes = list; }

export async function render(extra = {}) {
  const [path, query] = (location.hash.replace(/^#\/?/, '') || 'home').split('?');
  const segs = path.split('/').filter(Boolean);
  const params = { ...Object.fromEntries(new URLSearchParams(query || '')), ...extra };
  let view = null;
  for (const [pattern, fn] of routes) {
    const ps = pattern.split('/');
    if (ps.length !== segs.length) continue;
    const p = {};
    if (ps.every((part, i) => (part.startsWith(':') ? ((p[part.slice(1)] = decodeURIComponent(segs[i])), true) : part === segs[i]))) { view = [fn, { ...params, ...p }]; break; }
  }
  const main = $('#view');
  const box = document.createElement('div');
  const token = (current = {});
  document.querySelectorAll('dialog.modal').forEach((d) => d.close());
  if (!view) { main.replaceChildren(box); box.innerHTML = '<h1>Page not found</h1><p><a href="#/">Go to the dashboard</a></p>'; return; }
  box.innerHTML = '<p class="loading">Loading...</p>';
  main.replaceChildren(box);
  if (!Object.keys(extra).length) window.scrollTo(0, 0);
  try { await view[0](box, view[1]); } catch (e) {
    if (token === current) box.innerHTML = `<div class="alert bad"><strong>Could not load this page.</strong> ${esc(e.message)}</div><p><button data-reload>Reload</button></p>`;
  }
  document.dispatchEvent(new CustomEvent('routed', { detail: segs[0] || 'home' }));
}

// Redraw the current screen, optionally with extra parameters (for example which tab to show).
export const rerender = (extra = {}) => render({ _: 1, ...extra });
