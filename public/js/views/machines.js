import qrcode from '../../vendor/qrcode.js';
import { RESOURCES } from '../schema.js';
import { $, $$, api, esc, state, isManager, isAdmin, md, modal, toast, run, editRecord, confirmDelete, ppeBadges, fileLinks, statusBadge,
  badge, fmtDateTime, userName, dueBadge, riskBadge } from '../ui.js';

const machineUrl = (id) => `${location.origin}/#/machines/${id}`;
function qrSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

export async function machinesList(el) {
  let cat = '', q = '';
  const cats = [...new Set(state.machines.map((m) => m.category).filter(Boolean))].sort();
  el.innerHTML = `<div class="page-head"><h1>Machinery</h1><div class="row">
      ${isManager() ? '<button class="primary" data-new>Add machine</button><a class="button" href="#/qr">Print QR labels</a>' : ''}</div></div>
    <p class="intro">Every machine has its operating procedure, PPE, shutdown steps and training in one place. Scan the QR code on a machine to open its page.</p>
    <div class="row"><input type="search" placeholder="Search machines" data-search aria-label="Search machines">
    <select data-cat aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</select></div>
    <div class="grid" data-grid></div>`;
  const draw = () => {
    const rows = state.machines.filter((m) => (!cat || m.category === cat) && (!q || JSON.stringify([m.name, m.make_model, m.location, m.asset_no]).toLowerCase().includes(q)));
    $('[data-grid]', el).innerHTML = rows.length ? rows.map((m) => `<a class="card machine" href="#/machines/${m.id}">
        ${m.photo ? `<img src="/api/files/${m.photo.id}" alt="" loading="lazy">` : '<div class="noimg">⚙️</div>'}
        <div class="pad"><strong>${esc(m.name)}</strong><div class="muted">${esc([m.category, m.location].filter(Boolean).join(' · '))}</div>
        <div>${statusBadge(m.status || 'Operational')}</div></div></a>`).join('')
      : `<p class="empty">${state.machines.length ? 'No machines match.' : 'No machines added yet.'}</p>`;
  };
  $('[data-search]', el).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
  $('[data-cat]', el).addEventListener('change', (e) => { cat = e.target.value; draw(); });
  $('[data-new]', el)?.addEventListener('click', () => editRecord('machines', {}, { onSaved: (m) => { location.hash = `#/machines/${m.id}`; } }));
  draw();
}

const section = (title, html, open = false) => (html ? `<details class="card section" ${open ? 'open' : ''}><summary>${esc(title)}</summary><div class="pad">${html}</div></details>` : '');

export async function machineDetail(el, { id }) {
  const m = await api(`r/machines/${id}`);
  const [modules, records, prestarts, hazards, tags] = await Promise.all([
    api(`r/training_modules?machine_id=${m.id}`), api('training/records'), api(`prestarts?machine_id=${m.id}`),
    api(`r/hazards?machine_id=${m.id}`), api(`r/testtag_items?machine_id=${m.id}`),
  ]);
  const active = modules.filter((x) => x.active);
  const mine = (mod) => records.find((r) => r.user_id === state.me.id && r.module_id === mod.id && r.state === 'Competent')
    || records.find((r) => r.user_id === state.me.id && r.module_id === mod.id);
  const allCompetent = active.length && active.every((mod) => mine(mod)?.state === 'Competent');
  const openHaz = hazards.filter((h) => h.status !== 'Closed');
  const status = m.status || 'Operational';

  let authBox = '';
  if (status === 'Out of service') authBox = `<div class="alert bad"><strong>OUT OF SERVICE. Do not operate this machine.</strong></div>`;
  else if (active.length && allCompetent) authBox = `<div class="alert ok">You are trained and signed off to operate this machine.</div>`;
  else if (active.length) authBox = `<div class="alert ${m.authorised_only ? 'bad' : 'warn'}"><strong>You are not signed off on this machine yet.</strong> ${m.authorised_only ? 'Do not operate it until you have finished the training and a supervisor has signed you off.' : 'Finish the training below.'}</div>`;
  else if (m.authorised_only) authBox = `<div class="alert warn">Trained and authorised operators only. Check with your supervisor before using this machine.</div>`;

  el.innerHTML = `<p><a href="#/machines">← All machinery</a></p>
    <div class="machine-head">${m.photo ? `<img src="/api/files/${m.photo.id}" alt="">` : ''}
      <div><h1>${esc(m.name)}</h1><p class="muted">${esc([m.make_model, m.category, m.location, m.asset_no && 'Asset ' + m.asset_no].filter(Boolean).join(' · '))}</p>
      <p>${statusBadge(status)} ${m.risk_level ? badge(m.risk_level + ' risk', { Low: 'ok', Medium: 'warn', High: 'bad' }[m.risk_level]) : ''}</p></div></div>
    ${authBox}
    <div class="actions-bar">
      ${(m.prestart_items || []).length ? '<button class="primary big" data-prestart>✅ Pre-start check</button>' : ''}
      <a class="button big warnbtn" href="#/hazards/new?machine=${m.id}">⚠️ Report a hazard</a>
      ${active.length ? `<a class="button big" href="#/training/${active[0].id}">🎓 Training</a>` : ''}
    </div>
    ${m.description ? `<p>${esc(m.description)}</p>` : ''}
    ${section('PPE required', ppeBadges(m.ppe), true)}
    ${section('Key hazards', (m.hazards || []).length ? `<ul class="hazards">${m.hazards.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : '', true)}
    ${section('Standard operating procedure', md(m.sop))}
    ${section('Safe working procedure', md(m.safe_work))}
    ${section('Shutdown procedure', md(m.shutdown))}
    ${section('Emergency stop and isolation', md(m.emergency))}
    ${section('Cleaning and maintenance', md(m.maintenance))}
    ${section('Documents', fileLinks(m.documents))}
    ${section('Training and sign-off', active.length ? active.map((mod) => { const r = mine(mod); return `<a class="item" href="#/training/${mod.id}"><div><strong>${esc(mod.title)}</strong><div class="muted">${esc(mod.summary || '')}</div></div><div class="right">${statusBadge(r ? r.state : 'Not started')}</div></a>`; }).join('') : (isManager() ? '<p class="muted">No training module for this machine yet. <a href="#/training-modules">Add one</a>.</p>' : ''), true)}
    ${section(`Open hazards (${openHaz.length})`, openHaz.map((h) => `<a class="item" href="#/hazards/${h.id}"><div><strong>${esc(h.title)}</strong><div class="muted">${fmtDateTime(h.created_at)}</div></div><div class="right">${riskBadge(h)} ${statusBadge(h.status)}</div></a>`).join(''), true)}
    ${section('Recent pre-start checks', prestarts.slice(0, 10).map((p) => `<div class="item"><div><strong>${esc(userName(p.user_id))}</strong><div class="muted">${fmtDateTime(p.created_at)}${p.notes ? ' · ' + esc(p.notes) : ''}</div></div><div class="right">${p.all_ok ? badge('All OK', 'ok') : badge('Fault found', 'bad')}</div></div>`).join(''))}
    ${section('Test and tag', tags.map((t) => `<a class="item" href="#/testtag/${t.id}"><div><strong>${esc(t.name)}</strong><div class="muted">${esc(t.asset_no || '')}</div></div><div class="right">${dueBadge(t.next_due)}</div></a>`).join(''))}
    ${isManager() ? `<div class="card section pad"><div class="row"><button data-edit>Edit machine</button><a class="button" href="#/qr/${m.id}">QR label</a>${isAdmin() ? '<button class="danger" data-del>Delete</button>' : ''}</div></div>` : ''}`;

  $('[data-edit]', el)?.addEventListener('click', () => editRecord('machines', m, { onSaved: () => machineDetail(el, { id }) }));
  $('[data-del]', el)?.addEventListener('click', () => confirmDelete('machines', m, () => { location.hash = '#/machines'; }));
  $('[data-prestart]', el)?.addEventListener('click', () => prestartForm(m, () => machineDetail(el, { id })));
}

function prestartForm(m, done) {
  const d = modal(`Pre-start check: ${m.name}`, `<form class="form"><p class="intro">Check each item before you start the machine. If anything fails, do not use the machine and tell your supervisor.</p>
    ${m.prestart_items.map((item, i) => `<fieldset class="check-row"><legend>${esc(item)}</legend>
      <label><input type="radio" name="r${i}" value="ok" required> OK</label><label><input type="radio" name="r${i}" value="fail"> Fail</label><label><input type="radio" name="r${i}" value="na"> N/A</label></fieldset>`).join('')}
    <label class="field"><span>Notes (required if anything failed)</span><textarea name="notes" rows="3"></textarea></label>
    <div class="form-actions"><button class="primary" type="submit">Submit check</button><button type="button" data-close>Cancel</button></div></form>`);
  $('form', d).addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    run($('button[type=submit]', form), async () => {
      const results = m.prestart_items.map((_, i) => form.elements['r' + i].value || null);
      const res = await api('prestarts', { method: 'POST', body: { machine_id: m.id, results, notes: form.elements.notes.value.trim() } });
      d.close();
      if (res.all_ok) toast('Pre-start recorded. Good to go.');
      else modal('Fault recorded', `<div class="alert bad"><strong>Do not use this machine.</strong> A hazard report has been raised for your manager. Tag the machine out if it is unsafe.</div><div class="form-actions"><button data-close class="primary">OK</button></div>`);
      done();
    });
  });
}

export async function prestartLog(el) {
  const rows = await api('prestarts');
  el.innerHTML = `<div class="page-head"><h1>Pre-start checks</h1></div>
    <p class="intro">Open a machine and tap "Pre-start check" to do one. The latest checks across all machines are listed here.</p>
    <div class="list">${rows.length ? rows.map((p) => `<a class="item" href="#/machines/${p.machine_id}"><div><strong>${esc(state.machines.find((m) => m.id === p.machine_id)?.name || 'Removed machine')}</strong>
      <div class="muted">${esc(userName(p.user_id))} · ${fmtDateTime(p.created_at)}${p.notes ? ' · ' + esc(p.notes) : ''}</div></div>
      <div class="right">${p.all_ok ? badge('All OK', 'ok') : badge('Fault found', 'bad')}</div></a>`).join('') : '<p class="empty">No pre-start checks recorded yet.</p>'}</div>`;
}

export async function qrLabels(el, { id }) {
  const list = id ? state.machines.filter((m) => m.id === Number(id)) : state.machines;
  el.innerHTML = `<div class="page-head noprint"><h1>QR labels</h1><div class="row"><button class="primary" data-print>Print</button><a class="button" href="#/machines">Back</a></div></div>
    <p class="intro noprint">Print these, laminate them and stick one on each machine. Scanning a label opens that machine's procedures, PPE, pre-start check and hazard report form.</p>
    <div class="labels">${list.map((m) => `<div class="label"><div class="qr">${qrSvg(machineUrl(m.id))}</div><div><strong>${esc(m.name)}</strong>
      <span>Scan for safe operating procedure, PPE, pre-start check and to report a hazard</span>${m.asset_no ? `<small>Asset ${esc(m.asset_no)}</small>` : ''}</div></div>`).join('') || '<p class="empty">No machines yet.</p>'}</div>`;
  $('[data-print]', el).addEventListener('click', () => window.print());
}
