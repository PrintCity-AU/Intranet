// Small helpers shared by every screen: API calls, formatting, forms and pop-ups.
import { PPE, RESOURCES, riskRating, rank } from './schema.js';

export const state = { me: null, users: [], machines: [] };
export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isManager = () => rank(state.me?.role) >= 1;
export const isAdmin = () => state.me?.role === 'admin';
export const userName = (id) => state.users.find((u) => u.id === id)?.name || (id ? 'Former staff member' : '');
export const machineName = (id) => state.machines.find((m) => m.id === id)?.name || '';

export async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body instanceof FormData) init.body = opts.body;
  else if (opts.body !== undefined) { init.body = JSON.stringify(opts.body); init.headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch('/api/' + path, init); } catch (e) {
    throw new Error(navigator.onLine ? 'Could not reach the server. Your login may have expired, so try reloading the page.' : 'You are offline.');
  }
  const type = res.headers.get('Content-Type') || '';
  if (!type.includes('json')) throw new Error('Your login has expired. Reload the page to sign in again.');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export async function loadCommon() {
  [state.users, state.machines] = await Promise.all([api('users'), api('r/machines')]);
}

// ---- Formatting -----------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
export function fmtDate(s) {
  if (!s) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00') : new Date(s);
  if (isNaN(d)) return esc(s);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
export function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return esc(s);
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}
export const localNow = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  const t = new Date((state.me?.today || new Date().toISOString().slice(0, 10)) + 'T00:00');
  return Math.round((new Date(dateStr.slice(0, 10) + 'T00:00') - t) / 86400000);
}
export const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`;
export function dueBadge(dateStr, warnDays = 30, none = 'No date set') {
  const d = daysUntil(dateStr);
  if (d === null) return badge(none, 'mid');
  if (d < 0) return badge(`Overdue ${-d} day${d === -1 ? '' : 's'}`, 'bad');
  if (d === 0) return badge('Due today', 'bad');
  if (d <= warnDays) return badge(`Due in ${d} day${d === 1 ? '' : 's'}`, 'warn');
  return badge(fmtDate(dateStr), 'ok');
}
export const STATUS_CLS = { Open: 'bad', 'In progress': 'warn', Investigating: 'warn', Closed: 'ok', Done: 'ok', Pending: 'warn', Approved: 'ok', Declined: 'bad',
  Ordered: 'mid', Received: 'ok', Cancelled: 'mid', Operational: 'ok', 'Restricted use': 'warn', 'Out of service': 'bad', Competent: 'ok', 'Awaiting sign-off': 'warn',
  'Not yet competent': 'bad', Revoked: 'bad', Expired: 'bad', 'Retraining required': 'bad', 'Not started': 'mid', Pass: 'ok', Fail: 'bad', 'In service': 'ok' };
export const statusBadge = (s) => (s ? badge(s, STATUS_CLS[s] || 'mid') : '');
export function riskBadge(row) { const r = riskRating(row.likelihood, row.consequence); return r ? badge(`${r.label} risk`, r.cls) : ''; }
export function ppeBadges(list) {
  if (!list?.length) return '<p class="muted">None listed.</p>';
  return `<div class="ppe">${list.filter((k) => PPE[k]).map((k) => `<div class="ppe-item"><span class="ppe-icon">${PPE[k].icon}</span><span>${esc(PPE[k].label)}</span></div>`).join('')}</div>`;
}

// Safe, minimal Markdown: headings, lists, bold, italics, links and "> " warning boxes.
export function md(src) {
  if (!src) return '';
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[\s(])\*(.+?)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/api\/files\/\d+|#\/[^\s)]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  let out = '', list = null, para = [];
  const flush = () => { if (para.length) { out += `<p>${para.join('<br>')}</p>`; para = []; } if (list) { out += `</${list}>`; list = null; } };
  for (const raw of String(src).split(/\r?\n/)) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,3})\s+(.*)/))) { flush(); out += `<h${m[1].length + 2}>${inline(m[2])}</h${m[1].length + 2}>`; continue; }
    if ((m = line.match(/^>\s?(.*)/))) { flush(); out += `<div class="callout">${inline(m[1])}</div>`; continue; }
    if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (list !== 'ul') { flush(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; continue; }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { flush(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; continue; }
    if (list) flush();
    para.push(inline(line));
  }
  flush();
  return `<div class="md">${out}</div>`;
}

export function fileLinks(v) {
  const files = Array.isArray(v) ? v : v ? [v] : [];
  if (!files.length) return '';
  const imgs = files.filter((f) => /^image\//.test(f.type || ''));
  const docs = files.filter((f) => !/^image\//.test(f.type || ''));
  return `<div class="files">${imgs.map((f) => `<a href="/api/files/${f.id}" target="_blank"><img src="/api/files/${f.id}" alt="${esc(f.name)}" loading="lazy"></a>`).join('')}
    ${docs.map((f) => `<a class="doc" href="/api/files/${f.id}" target="_blank">${esc(f.name)}</a>`).join('')}</div>`;
}

// ---- Toasts and pop-ups ---------------------------------------------------
export function toast(msg, bad = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), bad ? 7000 : 3500);
}
export function modal(title, bodyHtml, { wide = false } = {}) {
  const d = document.createElement('dialog');
  d.className = 'modal' + (wide ? ' wide' : '');
  d.innerHTML = `<header><h2>${esc(title)}</h2><button class="icon" data-close aria-label="Close">✕</button></header><div class="modal-body">${bodyHtml}</div>`;
  document.body.append(d);
  d.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) d.close(); });
  d.addEventListener('close', () => d.remove());
  d.showModal();
  $('.modal-body input:not([type=file]), .modal-body select, .modal-body textarea', d)?.focus();
  return d;
}
// Runs an action from a button, showing errors instead of failing silently.
export async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { if (btn) btn.disabled = false; }
}

// ---- Forms ----------------------------------------------------------------
const userOptions = (sel) => `<option value="">Choose...</option>` + state.users.filter((u) => u.active || u.id === sel).map((u) => `<option value="${u.id}" ${u.id === sel ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
const machineOptions = (sel) => `<option value="">None</option>` + state.machines.map((m) => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

const quizQ = (item = { q: '', options: ['', ''], answer: 0 }) => `<div class="quiz-q card" data-q>
    <label>Question<input type="text" data-qtext value="${esc(item.q)}"></label>
    <div data-opts>${item.options.map((o, j) => quizOpt(o, j === item.answer)).join('')}</div>
    <div class="row"><button type="button" class="small" data-addopt>Add answer</button><button type="button" class="small danger" data-delq>Remove question</button></div>
    <p class="hint">Select the circle next to the correct answer.</p></div>`;
const quizEditor = (k, quiz) => `<div class="quiz-editor" data-quiz="${k}">${(quiz || []).map((x) => quizQ(x)).join('')}<button type="button" class="small" data-addq>Add question</button></div>`;
const quizOpt = (text, checked) => `<div class="quiz-opt"><input type="radio" name="qa-${Math.random().toString(36).slice(2, 9)}" data-correct ${checked ? 'checked' : ''}><input type="text" data-opt value="${esc(text)}" placeholder="Answer"><button type="button" class="icon" data-delopt aria-label="Remove answer">✕</button></div>`;

export function formHtml(fields, v = {}, { submit = 'Save' } = {}) {
  const mgr = isManager();
  const rows = fields.filter((f) => !f.hide && (!f.mgr || mgr)).map((f) => {
    const val = v[f.k] ?? (v.id ? null : f.def ?? null);
    const req = f.req ? 'required' : '';
    const name = `name="${f.k}"`;
    let input;
    switch (f.type) {
      case 'textarea': input = `<textarea ${name} rows="3" ${req}>${esc(val)}</textarea>`; break;
      case 'markdown': input = `<textarea ${name} rows="8" ${req}>${esc(val)}</textarea><span class="hint">Formatting: ## Heading, - bullet point, 1. numbered step, **bold**, &gt; warning box</span>`; break;
      case 'list': input = `<textarea ${name} rows="4">${esc((val || []).join('\n'))}</textarea>`; break;
      case 'date': input = `<input type="date" ${name} value="${esc(val)}" ${req}>`; break;
      case 'datetime': input = `<input type="datetime-local" ${name} value="${esc((val || ((f.req || f.now) && !v.id ? localNow() : '')).slice(0, 16))}" ${req}>`; break;
      case 'number': input = `<input type="number" step="any" ${name} value="${esc(val)}" ${req}>`; break;
      case 'bool': return `<label class="check"><input type="checkbox" ${name} ${val ? 'checked' : ''}> ${esc(f.label)}</label>`;
      case 'select': input = `<select ${name} ${req}><option value="">Choose...</option>${f.options.map((o) => `<option ${o === val ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
      case 'user':
        if (f.mgrPick && !mgr) return '';
        input = `<select ${name} ${req}>${userOptions(val ?? (f.mgrPick ? state.me.id : null))}</select>`; break;
      case 'machine': input = `<select ${name}>${machineOptions(val)}</select>`; break;
      case 'ppe': input = `<div class="ppe-pick">${Object.entries(PPE).map(([k, p]) => `<label class="check"><input type="checkbox" data-ppe="${f.k}" value="${k}" ${(val || []).includes(k) ? 'checked' : ''}> ${p.icon} ${esc(p.label)}</label>`).join('')}</div>`; break;
      case 'file': case 'files': {
        const files = Array.isArray(val) ? val : val ? [val] : [];
        input = `<div class="uploader" data-upload="${f.k}" data-multi="${f.type === 'files'}"><div data-list>${files.map(fileChip).join('')}</div>
          <input type="file" ${f.type === 'files' ? 'multiple' : ''} ${/photo/i.test(f.k) ? 'accept="image/*"' : ''}></div>`; break;
      }
      case 'quiz': input = quizEditor(f.k, val); break;
      default: input = `<input type="text" ${name} value="${esc(val)}" ${req}>`;
    }
    return `<label class="field"><span>${esc(f.label)}${f.req ? ' <em>*</em>' : ''}</span>${input}</label>`;
  }).join('');
  return `<form class="form" novalidate>${rows}<div class="form-actions"><button type="submit" class="primary">${esc(submit)}</button><button type="button" data-close>Cancel</button></div></form>`;
}
const fileChip = (f) => `<span class="chip" data-file='${esc(JSON.stringify(f))}'>${esc(f.name)} <button type="button" class="icon" data-rmfile aria-label="Remove">✕</button></span>`;

// Wires up uploads and the quiz editor inside a form.
export function bindForm(form) {
  form.addEventListener('change', async (e) => {
    const up = e.target.closest('[data-upload]');
    if (!up || e.target.type !== 'file') return;
    const list = $('[data-list]', up);
    for (const file of e.target.files) {
      const fd = new FormData(); fd.append('file', file);
      const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = `Uploading ${file.name}...`;
      list.append(chip);
      try {
        const meta = await api('files', { method: 'POST', body: fd });
        if (up.dataset.multi !== 'true') $$('[data-file]', list).forEach((c) => c.remove());
        chip.outerHTML = fileChip(meta);
      } catch (err) { chip.remove(); toast(err.message, true); }
    }
    e.target.value = '';
  });
  form.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-rmfile]')) t.closest('.chip').remove();
    if (t.closest('[data-addq]')) t.closest('[data-addq]').insertAdjacentHTML('beforebegin', quizQ());
    if (t.closest('[data-delq]')) t.closest('[data-q]').remove();
    if (t.closest('[data-addopt]')) $('[data-opts]', t.closest('[data-q]')).insertAdjacentHTML('beforeend', quizOpt('', false));
    if (t.closest('[data-delopt]')) t.closest('.quiz-opt').remove();
    // Keep one correct answer per question even though radio names are random.
    if (t.matches('[data-correct]')) $$('[data-correct]', t.closest('[data-q]')).forEach((r) => { r.checked = r === t; });
  });
}

export function readForm(form, fields) {
  const mgr = isManager();
  const data = {};
  for (const f of fields) {
    if (f.hide || (f.mgr && !mgr) || (f.type === 'user' && f.mgrPick && !mgr)) continue;
    const el = form.elements[f.k];
    switch (f.type) {
      case 'bool': data[f.k] = el.checked ? 1 : 0; break;
      case 'list': data[f.k] = el.value.split('\n').map((s) => s.trim()).filter(Boolean); break;
      case 'ppe': data[f.k] = $$(`[data-ppe="${f.k}"]:checked`, form).map((c) => c.value); break;
      case 'file': { const c = $(`[data-upload="${f.k}"] [data-file]`, form); data[f.k] = c ? JSON.parse(c.dataset.file) : null; break; }
      case 'files': data[f.k] = $$(`[data-upload="${f.k}"] [data-file]`, form).map((c) => JSON.parse(c.dataset.file)); break;
      case 'quiz': data[f.k] = $$(`[data-quiz="${f.k}"] [data-q]`, form).map((q) => {
        const opts = $$('.quiz-opt', q).filter((o) => $('[data-opt]', o).value.trim());
        return { q: $('[data-qtext]', q).value.trim(), options: opts.map((o) => $('[data-opt]', o).value.trim()), answer: opts.findIndex((o) => $('[data-correct]', o).checked) };
      }).filter((q) => q.q); break;
      default: data[f.k] = el.value === '' ? null : el.value;
    }
    if (f.req && (data[f.k] === null || data[f.k] === '')) throw new Error(`"${f.label}" is required.`);
  }
  return data;
}

// Opens a pop-up form for a register and saves it.
export function editRecord(resName, record = {}, { title, onSaved, fields, preset = {} } = {}) {
  const res = RESOURCES[resName];
  const flds = fields || res.fields;
  const d = modal(title || `${record.id ? 'Edit' : 'New'} ${res.label.toLowerCase()}`, formHtml(flds, { ...preset, ...record }), { wide: true });
  const form = $('form', d);
  bindForm(form);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run($('button[type=submit]', form), async () => {
      const data = { ...preset, ...readForm(form, flds) };
      const saved = await api(`r/${resName}${record.id ? '/' + record.id : ''}`, { method: record.id ? 'PUT' : 'POST', body: data });
      d.close();
      toast('Saved');
      if (resName === 'machines') await loadCommon();
      onSaved?.(saved);
    });
  });
  return d;
}

export async function confirmDelete(resName, record, onDone) {
  if (!confirm(`Delete this ${RESOURCES[resName].label.toLowerCase()}? This cannot be undone.`)) return;
  try { await api(`r/${resName}/${record.id}`, { method: 'DELETE' }); toast('Deleted'); if (resName === 'machines') await loadCommon(); onDone?.(); } catch (e) { toast(e.message, true); }
}

// Read-only display of a record, field by field.
export function showValue(f, v) {
  if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '';
  switch (f.type) {
    case 'markdown': return md(v);
    case 'textarea': return `<p class="pre">${esc(v)}</p>`;
    case 'list': return `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    case 'ppe': return ppeBadges(v);
    case 'file': case 'files': return fileLinks(v);
    case 'user': return esc(userName(v));
    case 'machine': return machineName(v) ? `<a href="#/machines/${v}">${esc(machineName(v))}</a>` : '';
    case 'bool': return v ? 'Yes' : 'No';
    case 'date': return fmtDate(v);
    case 'datetime': return fmtDateTime(v);
    case 'quiz': return `${v.length} question${v.length === 1 ? '' : 's'}`;
    default: return esc(v);
  }
}
export function detailHtml(fields, rec, skip = []) {
  return `<dl class="detail">${fields.filter((f) => !skip.includes(f.k)).map((f) => { const h = showValue(f, rec[f.k]); return h ? `<div><dt>${esc(f.label)}</dt><dd>${h}</dd></div>` : ''; }).join('')}</dl>`;
}

export function downloadCsv(filename, rows) {
  const cell = (v) => { const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
