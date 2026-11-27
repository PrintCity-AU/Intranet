import { $, $$, api, esc, state, isManager, isAdmin, loadCommon } from './ui.js';
import { setRoutes, render } from './router.js';
import { dashboard } from './views/dashboard.js';
import { machinesList, machineDetail, prestartLog, qrLabels } from './views/machines.js';
import { trainingHome, trainingModule, trainingModules } from './views/training.js';
import * as safety from './views/safety.js';
import * as people from './views/people.js';

// [route, label, icon]. "mgr" items only show for managers and admins.
const NAV = [
  ['Home', [['home', 'Dashboard', '🏠'], ['notices', 'Noticeboard', '📌']]],
  ['Safety', [['machines', 'Machinery', '⚙️'], ['training', 'Training', '🎓'], ['hazards', 'Hazards and near misses', '⚠️'], ['incidents', 'Incidents', '🩹'],
    ['actions', 'Corrective actions', '🔧'], ['prestarts', 'Pre-start checks', '✅'], ['testtag', 'Test and tag', '🔌'], ['chemicals', 'Chemicals and SDS', '🧪'],
    ['emergency', 'Emergency', '🚨'], ['toolbox', 'Toolbox talks', '🗣️'], ['policies', 'Policies', '📄'], ['licences', 'Licences and tickets', '🪪']]],
  ['Team', [['directory', 'Staff directory', '👥'], ['org', 'Org chart', '🌳'], ['leave', 'Leave calendar', '🗓️'], ['uniforms', 'Uniforms', '👕'], ['handbook', 'Handbook', '📚']]],
  ['Admin', [['users', 'Manage people', '🔑', 'admin']]],
];

// Registers accept "#/thing/new" to open the add form, and "#/thing/12" to open a record.
const reg = (fn) => (el, p) => fn(el, p.id === 'new' ? { ...p, id: undefined, new: true } : p);

function routes() {
  const list = [['home', dashboard], ['machines', machinesList], ['machines/:id', machineDetail], ['prestarts', prestartLog], ['qr', qrLabels], ['qr/:id', qrLabels],
    ['training', trainingHome], ['training/:id', trainingModule], ['emergency', safety.emergency],
    ['directory', people.directory], ['org', people.orgChart], ['uniforms', people.uniforms], ['users', people.users], ['profile', people.profile], ['audit', people.auditLog]];
  const registers = { 'training-modules': trainingModules, hazards: safety.hazards, incidents: safety.incidents, actions: safety.actions, licences: safety.licences, testtag: safety.testtag,
    chemicals: safety.chemicals, toolbox: safety.toolbox, policies: safety.policies, handbook: safety.handbook, notices: safety.notices, leave: people.leave, 'uniform-items': people.uniformItems };
  for (const [path, fn] of Object.entries(registers)) list.push([path, reg(fn)], [`${path}/:id`, reg(fn)]);
  return list;
}

function drawNav() {
  $('#nav').innerHTML = NAV.map(([group, items]) => {
    const shown = items.filter(([, , , need]) => !need || (need === 'admin' ? isAdmin() : isManager()));
    return shown.length ? `<h3>${group}</h3>${shown.map(([r, label, icon]) => `<a href="#/${r}" data-route="${r}"><span>${icon}</span>${esc(label)}</a>`).join('')}` : '';
  }).join('');
  $('#me').innerHTML = `<a href="#/profile">${esc(state.me.name)}</a>`;
}

async function start() {
  try {
    state.me = await api('me');
    await loadCommon();
  } catch (e) {
    $('#view').innerHTML = `<div class="alert bad"><strong>Could not start the intranet.</strong> ${esc(e.message)}</div><p><button data-reload>Try again</button></p>`;
    return;
  }
  drawNav();
  if (state.me.dev) document.body.insertAdjacentHTML('afterbegin', '<div class="devbar noprint">Test mode: login is not connected to Cloudflare Access.</div>');
  setRoutes(routes());
  document.addEventListener('routed', (e) => {
    document.body.classList.remove('nav-open');
    const alias = { qr: 'machines', 'training-modules': 'training', 'uniform-items': 'uniforms', audit: 'users', profile: '' };
    const cur = alias[e.detail] ?? e.detail;
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === cur));
  });
  window.addEventListener('hashchange', () => render());
  $('#menu').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  render();
}

document.addEventListener('click', (e) => { if (e.target.closest('[data-reload]')) location.reload(); });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
start();
