// A generic "register" screen: a searchable list, a detail pop-up, and add/edit/delete.
// Most sections of the intranet are one of these with a few options.
import { RESOURCES, rank } from '../schema.js';
import { $, $$, api, esc, state, isManager, modal, editRecord, confirmDelete, detailHtml, downloadCsv, userName, machineName, run } from '../ui.js';

export function can(level, res, rec) {
  if (level === 'staff') return true;
  if (level === 'owner') return isManager() || (rec && rec[res.owner] === state.me.id);
  return rank(state.me.role) >= rank(level);
}

export async function register(el, resName, opts = {}, params = {}) {
  const res = RESOURCES[resName];
  const route = opts.route || resName;
  let rows = [], tab = 0, q = '';
  const tabs = opts.tabs || [];

  el.innerHTML = `<div class="page-head"><h1>${esc(opts.title || res.plural)}</h1>
      <div class="row">${can(res.create, res) && opts.create !== false ? `<button class="primary" data-new>${esc(opts.newLabel || 'Add ' + res.label.toLowerCase())}</button>` : ''}
      ${isManager() ? '<button data-csv>Export</button>' : ''}</div></div>
    ${opts.intro ? `<p class="intro">${opts.intro}</p>` : ''}
    ${tabs.length ? `<div class="tabs">${tabs.map((t, i) => `<button data-tab="${i}" class="${i === 0 ? 'on' : ''}">${esc(t.label)}</button>`).join('')}</div>` : ''}
    <input type="search" placeholder="Search" data-search aria-label="Search">
    <div data-list class="list"></div>`;
  const listEl = $('[data-list]', el);

  const draw = () => {
    let shown = rows;
    if (tabs[tab]?.fn) shown = shown.filter(tabs[tab].fn);
    if (q) shown = shown.filter((r) => JSON.stringify(r).toLowerCase().includes(q));
    listEl.innerHTML = shown.length ? shown.map((r) => {
      const row = opts.row ? opts.row(r) : { title: r.title || r.name };
      return `<a class="item" href="#/${route}/${r.id}" data-id="${r.id}"><div><strong>${esc(row.title)}</strong>${row.sub ? `<div class="muted">${row.sub}</div>` : ''}</div><div class="right">${row.right || ''}</div></a>`;
    }).join('') : `<p class="empty">${esc(opts.empty || 'Nothing here yet.')}</p>`;
  };
  const load = async () => { rows = await api(`r/${resName}`); if (opts.after) await opts.after(rows); draw(); };

  const open = (rec) => {
    const d = modal(opts.detailTitle ? opts.detailTitle(rec) : rec.title || rec.name || res.label,
      `${opts.before ? opts.before(rec) : ''}${detailHtml(res.fields, rec, ['title', 'name', ...(opts.skip || [])])}
       <p class="muted small">Added ${new Date(rec.created_at).toLocaleDateString('en-AU')}${rec.created_by ? ' by ' + esc(userName(rec.created_by)) : ''}</p>
       <div data-extra></div>
       <div class="form-actions">${can(res.update, res, rec) ? '<button data-edit class="primary">Edit</button>' : ''}${can(res.del, res, rec) ? '<button data-del class="danger">Delete</button>' : ''}</div>`, { wide: true });
    const reopen = async () => { d.close(); await load(); const fresh = rows.find((r) => r.id === rec.id); if (fresh) open(fresh); };
    $('[data-edit]', d)?.addEventListener('click', () => editRecord(resName, rec, { onSaved: reopen }));
    $('[data-del]', d)?.addEventListener('click', () => confirmDelete(resName, rec, () => { d.close(); load(); }));
    d.addEventListener('close', () => { if (location.hash.startsWith(`#/${route}/`)) history.replaceState(null, '', `#/${route}`); });
    opts.extra?.($('[data-extra]', d), rec, reopen);
  };

  el.addEventListener('click', (e) => {
    const item = e.target.closest('.item[data-id]');
    if (item) { e.preventDefault(); history.replaceState(null, '', item.getAttribute('href')); open(rows.find((r) => r.id === Number(item.dataset.id))); }
    if (e.target.closest('[data-new]')) editRecord(resName, {}, { title: opts.newLabel, preset: opts.preset?.() || {}, onSaved: (saved) => { load(); opts.onCreated?.(saved); } });
    const t = e.target.closest('[data-tab]');
    if (t) { tab = Number(t.dataset.tab); $$('[data-tab]', el).forEach((b) => b.classList.toggle('on', b === t)); draw(); }
    if (e.target.closest('[data-csv]')) {
      const flds = res.fields;
      const cell = (f, v) => f.type === 'user' ? userName(v) : f.type === 'machine' ? machineName(v) : f.type === 'file' ? v?.name
        : f.type === 'files' ? (v || []).map((x) => x.name).join('; ') : Array.isArray(v) && f.type !== 'quiz' ? v.join('; ') : v;
      downloadCsv(`${resName}.csv`, [['ID', ...flds.map((f) => f.label), 'Created'], ...rows.map((r) => [r.id, ...flds.map((f) => cell(f, r[f.k])), r.created_at])]);
    }
  });
  $('[data-search]', el).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });

  await load();
  if (params.id) { const rec = rows.find((r) => r.id === Number(params.id)); if (rec) open(rec); }
  if (params.new) $('[data-new]', el)?.click();
  return { load };
}

// A list of corrective actions linked to a hazard or incident, shown inside its detail pop-up.
export async function linkedActions(box, sourceType, rec) {
  const draw = async () => {
    const acts = await api(`r/actions?source_type=${encodeURIComponent(sourceType)}&source_id=${rec.id}`);
    box.innerHTML = `<h3>Corrective actions</h3>${acts.length ? acts.map((a) => `<a class="item" href="#/actions/${a.id}" data-close><div><strong>${esc(a.title)}</strong><div class="muted">${esc(userName(a.assigned_to))}, due ${esc(a.due_date || '')}</div></div><div class="right"><span class="badge ${a.status === 'Done' ? 'ok' : 'warn'}">${esc(a.status)}</span></div></a>`).join('') : '<p class="muted">No actions raised yet.</p>'}
      ${isManager() ? '<button data-addaction>Add corrective action</button>' : ''}`;
    $('[data-addaction]', box)?.addEventListener('click', () => editRecord('actions', {}, { preset: { source_type: sourceType, source_id: rec.id }, onSaved: draw }));
  };
  await run(null, draw);
}
