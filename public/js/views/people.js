import { ROLES } from '../schema.js';
import { $, $$, api, esc, state, isManager, isAdmin, modal, toast, run, statusBadge, badge, fmtDate, fmtDateTime, userName, loadCommon, fileLinks } from '../ui.js';
import { register } from './register.js';
import { rerender } from '../router.js';

const initials = (name) => (name || '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
const avatar = (u) => `<span class="avatar">${esc(initials(u.name))}</span>`;

export async function directory(el) {
  const people = state.users.filter((u) => u.active);
  el.innerHTML = `<div class="page-head"><h1>Staff directory</h1>${isAdmin() ? '<a class="button" href="#/users">Manage people</a>' : ''}</div>
    <div class="list">${people.map((u) => `<div class="item">${avatar(u)}<div class="grow"><strong>${esc(u.name)}</strong><div class="muted">${esc([u.position, u.department].filter(Boolean).join(' · '))}</div></div>
      <div class="right">${u.phone ? `<a class="button small" href="tel:${esc(u.phone.replace(/\s/g, ''))}">📞 ${esc(u.phone)}</a>` : ''}<a class="button small" href="mailto:${esc(u.email)}">✉️ Email</a></div></div>`).join('')}</div>`;
}

export async function orgChart(el) {
  const people = state.users.filter((u) => u.active);
  const ids = new Set(people.map((u) => u.id));
  const kids = (id) => people.filter((u) => u.manager_id === id);
  const node = (u, seen = new Set()) => {
    if (seen.has(u.id)) return '';
    const next = new Set(seen).add(u.id);
    const c = kids(u.id);
    return `<li><div class="org-node">${avatar(u)}<strong>${esc(u.name)}</strong><span>${esc(u.position || '')}</span></div>${c.length ? `<ul>${c.map((k) => node(k, next)).join('')}</ul>` : ''}</li>`;
  };
  const roots = people.filter((u) => !u.manager_id || !ids.has(u.manager_id));
  el.innerHTML = `<div class="page-head"><h1>Org chart</h1>${isAdmin() ? '<a class="button" href="#/users">Edit reporting lines</a>' : ''}</div>
    <p class="intro">Who reports to who. ${isAdmin() ? 'Set each person\'s manager under "Manage people".' : ''}</p>
    <div class="scroll"><ul class="org">${roots.map((u) => node(u)).join('')}</ul></div>`;
}

export async function leave(el, params) {
  const cal = await api('leave-calendar');
  const today = state.me.today;
  let month = (params.month || today).slice(0, 7);
  const box = document.createElement('div');
  const reg = document.createElement('div');
  el.replaceChildren(box, reg);

  const drawCal = () => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const days = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7; // weeks start on Monday
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<td class="blank"></td>');
    for (let d = 1; d <= days; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const away = cal.filter((l) => l.start_date <= date && l.end_date >= date);
      cells.push(`<td class="${date === today ? 'today' : ''}"><span class="daynum">${d}</span>${away.map((l) => `<span class="leave-chip ${l.status === 'Approved' ? 'ok' : 'warn'}" title="${esc(l.status)}">${esc(userName(l.user_id).split(' ')[0])}</span>`).join('')}</td>`);
    }
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
    box.innerHTML = `<div class="page-head"><h1>Leave calendar</h1></div>
      <div class="row cal-nav"><button data-m="-1" aria-label="Previous month">←</button><strong>${first.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</strong><button data-m="1" aria-label="Next month">→</button></div>
      <div class="scroll"><table class="calendar"><thead><tr>${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<th>${d}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <p class="legend">${badge('Approved', 'ok')} ${badge('Waiting for approval', 'warn')}</p>`;
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(b.dataset.m), 1);
    month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    drawCal();
  });
  drawCal();

  await register(reg, 'leave', {
    title: isManager() ? 'Leave requests' : 'My leave requests', newLabel: 'Request leave',
    tabs: isManager() ? [{ label: 'Waiting', fn: (r) => r.status === 'Pending' }, { label: 'All' }] : [],
    row: (r) => ({ title: `${userName(r.user_id)}: ${fmtDate(r.start_date)}${r.end_date !== r.start_date ? ' to ' + fmtDate(r.end_date) : ''}`, sub: esc(r.type), right: statusBadge(r.status) }),
    detailTitle: (r) => `Leave: ${userName(r.user_id)}`,
    onCreated: () => rerender({ month }),
    extra: (bx, rec) => {
      if (!isManager() || rec.status !== 'Pending') return;
      bx.innerHTML = '<div class="row"><button class="primary" data-s="Approved">Approve</button><button class="danger" data-s="Declined">Decline</button></div>';
      $$('[data-s]', bx).forEach((b) => b.addEventListener('click', () => run(b, async () => {
        await api(`r/leave/${rec.id}`, { method: 'PUT', body: { status: b.dataset.s } }); toast(`Leave ${b.dataset.s.toLowerCase()}`); rerender({ month }); })));
    },
  }, params);
}

export async function uniforms(el, params) {
  const [items, orders] = await Promise.all([api('r/uniform_items'), api('uniform-orders')]);
  const avail = items.filter((i) => i.active);
  const money = (n) => '$' + Number(n || 0).toFixed(2);
  const pending = orders.filter((o) => o.status === 'Pending');
  const orderRow = (o) => `<button class="item" data-order="${o.id}"><div><strong>${esc(userName(o.user_id))} · ${fmtDate(o.created_at)}</strong>
    <div class="muted">${o.lines.map((l) => `${l.qty} × ${esc(l.name)}${l.size ? ' (' + esc(l.size) + ')' : ''}`).join(', ')}</div></div><div class="right">${money(o.total)} ${statusBadge(o.status)}</div></button>`;

  el.innerHTML = `<div class="page-head"><h1>Uniform ordering</h1>${isManager() ? '<a class="button" href="#/uniform-items">Edit catalogue</a>' : ''}</div>
    <p class="intro">Pick what you need and send the order. A manager approves it before it is ordered.</p>
    ${isManager() && pending.length ? `<h2>Waiting for approval (${pending.length})</h2><div class="list">${pending.map(orderRow).join('')}</div>` : ''}
    <h2>Order form</h2>
    ${avail.length ? `<form class="form" data-orderform><div class="grid">${avail.map((i) => `<div class="card uniform" data-item="${i.id}">
        ${i.photo ? `<img src="/api/files/${i.photo.id}" alt="" loading="lazy">` : '<div class="noimg">👕</div>'}
        <div class="pad"><strong>${esc(i.name)}</strong><div class="muted">${esc(i.description || '')}${i.price ? ' · ' + money(i.price) : ''}</div>
        <div class="row">${(i.sizes || []).length ? `<select data-size aria-label="Size"><option value="">Size</option>${i.sizes.map((s) => `<option>${esc(s)}</option>`).join('')}</select>` : ''}
        <input type="number" min="0" max="20" value="0" data-qty aria-label="Quantity"></div></div></div>`).join('')}</div>
      <label class="field"><span>Notes for your manager</span><textarea name="notes" rows="2" placeholder="For example: replacing a worn-out shirt"></textarea></label>
      <div class="form-actions"><button class="primary" type="submit">Send order for approval</button></div></form>`
      : `<p class="empty">The uniform catalogue is empty.${isManager() ? ' Add items under "Edit catalogue".' : ''}</p>`}
    <h2>${isManager() ? 'All orders' : 'My orders'}</h2>
    <div class="list">${orders.length ? orders.map(orderRow).join('') : '<p class="empty">No orders yet.</p>'}</div>`;

  $('[data-orderform]', el)?.addEventListener('submit', (e) => {
    e.preventDefault();
    run(e.submitter, async () => {
      const lines = $$('[data-item]', el).map((c) => ({ item_id: Number(c.dataset.item), size: $('[data-size]', c)?.value || null, qty: Number($('[data-qty]', c).value) })).filter((l) => l.qty > 0);
      if (!lines.length) throw new Error('Set a quantity on at least one item.');
      await api('uniform-orders', { method: 'POST', body: { lines, notes: e.target.elements.notes.value.trim() } });
      toast('Order sent for approval'); rerender();
    });
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-order]');
    if (!b) return;
    const o = orders.find((x) => x.id === Number(b.dataset.order));
    const mgr = isManager();
    const btns = [];
    if (mgr && o.status === 'Pending') btns.push(['Approved', 'Approve', 'primary'], ['Declined', 'Decline', 'danger']);
    if (mgr && o.status === 'Approved') btns.push(['Ordered', 'Mark as ordered', 'primary']);
    if (mgr && ['Approved', 'Ordered'].includes(o.status)) btns.push(['Received', 'Mark as received', '']);
    if (o.status === 'Pending' && o.user_id === state.me.id) btns.push(['Cancelled', 'Cancel order', 'danger']);
    const d = modal(`Uniform order: ${userName(o.user_id)}`, `<p>${statusBadge(o.status)} <span class="muted">Placed ${fmtDateTime(o.created_at)}</span></p>
      <table class="plain"><thead><tr><th>Item</th><th>Size</th><th>Qty</th><th>Cost</th></tr></thead><tbody>${o.lines.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.size || '')}</td><td>${l.qty}</td><td>${money(l.qty * l.price)}</td></tr>`).join('')}
      <tr><th colspan="3">Total</th><th>${money(o.total)}</th></tr></tbody></table>
      ${o.notes ? `<p class="pre">${esc(o.notes)}</p>` : ''}
      ${o.decided_by ? `<p class="muted">${esc(o.status === 'Declined' ? 'Declined' : 'Approved')} by ${esc(userName(o.decided_by))} on ${fmtDateTime(o.decided_at)}${o.decision_note ? ': ' + esc(o.decision_note) : ''}</p>` : ''}
      ${btns.some(([s]) => ['Approved', 'Declined'].includes(s)) ? '<label class="field"><span>Note (optional)</span><input type="text" data-note></label>' : ''}
      <div class="form-actions">${btns.map(([s, label, cls]) => `<button class="${cls}" data-set="${s}">${label}</button>`).join('')}</div>`);
    $$('[data-set]', d).forEach((bt) => bt.addEventListener('click', () => run(bt, async () => {
      await api(`uniform-orders/${o.id}/status`, { method: 'POST', body: { status: bt.dataset.set, note: $('[data-note]', d)?.value || null } });
      d.close(); toast('Order updated'); rerender();
    })));
  });
}

export const uniformItems = (el, params) => register(el, 'uniform_items', {
  route: 'uniform-items', intro: '<a href="#/uniforms">Back to uniform ordering</a>',
  row: (r) => ({ title: r.name, sub: esc((r.sizes || []).join(', ')), right: `${r.price ? '$' + Number(r.price).toFixed(2) : ''} ${r.active ? '' : badge('Hidden', 'mid')}` }),
}, params);

function userForm(u = {}) {
  const others = state.users.filter((x) => x.id !== u.id && x.active);
  return `<form class="form">
    ${u.id ? `<p class="muted">${esc(u.email)}</p>` : '<label class="field"><span>Work email <em>*</em></span><input type="email" name="email" required></label>'}
    <label class="field"><span>Name</span><input type="text" name="name" value="${esc(u.name)}"></label>
    <label class="field"><span>Role</span><select name="role">${ROLES.map((r) => `<option ${r === (u.role || 'staff') ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <span class="hint">Staff: use everything. Manager: also approves uniforms and leave, signs off training, manages the registers. Admin: also manages people and roles.</span></label>
    <label class="field"><span>Position</span><input type="text" name="position" value="${esc(u.position)}"></label>
    <label class="field"><span>Department</span><input type="text" name="department" value="${esc(u.department)}"></label>
    <label class="field"><span>Phone</span><input type="tel" name="phone" value="${esc(u.phone)}"></label>
    <label class="field"><span>Reports to</span><select name="manager_id"><option value="">Nobody (top of the org chart)</option>${others.map((x) => `<option value="${x.id}" ${x.id === u.manager_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Start date</span><input type="date" name="start_date" value="${esc(u.start_date)}"></label>
    <label class="check"><input type="checkbox" name="active" ${u.active === 0 ? '' : 'checked'}> Active (untick when someone leaves; their records are kept)</label>
    <div class="form-actions"><button class="primary" type="submit">Save</button><button type="button" data-close>Cancel</button></div></form>`;
}

export async function users(el) {
  if (!isAdmin()) { el.innerHTML = '<div class="alert warn">Only an admin can manage people.</div>'; return; }
  el.innerHTML = `<div class="page-head"><h1>Manage people</h1><button class="primary" data-new>Add a person</button></div>
    <p class="intro">People appear here automatically the first time they sign in. Add them in advance if you want to set their role and manager first. Who is allowed to sign in at all is controlled in Cloudflare Access.</p>
    <div class="list">${state.users.map((u) => `<button class="item" data-u="${u.id}"><div><strong>${esc(u.name)}</strong><div class="muted">${esc(u.email)}${u.position ? ' · ' + esc(u.position) : ''}${u.manager_id ? ' · reports to ' + esc(userName(u.manager_id)) : ''}</div></div>
      <div class="right">${badge(u.role, u.role === 'admin' ? 'bad' : u.role === 'manager' ? 'warn' : 'mid')}${u.active ? '' : badge('Inactive', 'mid')}</div></button>`).join('')}</div>
    <p><a href="#/audit">View the activity log</a></p>`;
  const open = (u) => {
    const d = modal(u.id ? u.name : 'Add a person', userForm(u));
    $('form', d).addEventListener('submit', (e) => { e.preventDefault(); const f = e.target.elements;
      run(e.submitter, async () => {
        await api(u.id ? `users/${u.id}` : 'users', { method: u.id ? 'PUT' : 'POST', body: { email: f.email?.value, name: f.name.value.trim(), role: f.role.value, position: f.position.value.trim(),
          department: f.department.value.trim(), phone: f.phone.value.trim(), manager_id: f.manager_id.value || null, start_date: f.start_date.value || null, active: f.active.checked } });
        d.close(); toast('Saved'); await loadCommon(); rerender();
      }); });
  };
  $('[data-new]', el).addEventListener('click', () => open({}));
  $$('[data-u]', el).forEach((b) => b.addEventListener('click', () => open(state.users.find((u) => u.id === Number(b.dataset.u)))));
}

export async function profile(el) {
  const me = state.me;
  el.innerHTML = `<h1>My details</h1><p class="muted">${esc(me.email)} · ${esc(me.role)}${me.position ? ' · ' + esc(me.position) : ''}</p>
    <form class="form card pad">
      <label class="field"><span>Name</span><input type="text" name="name" value="${esc(me.name)}" required></label>
      <label class="field"><span>Mobile</span><input type="tel" name="phone" value="${esc(me.phone)}"></label>
      <h3>Emergency contact</h3><p class="hint">Only managers can see this. It is who we call if something happens to you at work.</p>
      <label class="field"><span>Name and relationship</span><input type="text" name="emergency_name" value="${esc(me.emergency_name)}"></label>
      <label class="field"><span>Phone</span><input type="tel" name="emergency_phone" value="${esc(me.emergency_phone)}"></label>
      <div class="form-actions"><button class="primary" type="submit">Save</button></div></form>
    <p><a href="#/licences">My licences and tickets</a> · <a href="#/training">My training</a></p>`;
  $('form', el).addEventListener('submit', (e) => { e.preventDefault(); const f = e.target.elements;
    run(e.submitter, async () => {
      await api('me', { method: 'PUT', body: { name: f.name.value.trim(), phone: f.phone.value.trim(), emergency_name: f.emergency_name.value.trim(), emergency_phone: f.emergency_phone.value.trim() } });
      state.me = await api('me'); await loadCommon(); toast('Saved');
    }); });
}

export async function auditLog(el) {
  const rows = await api('audit');
  el.innerHTML = `<h1>Activity log</h1><p class="intro">The last 500 changes, newest first. This is the trail of who recorded, signed off or changed what.</p>
    <div class="scroll"><table class="plain"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${fmtDateTime(r.at)}</td><td>${esc(userName(r.user_id))}</td><td>${esc(r.action)} ${esc((r.entity || '').replace(/_/g, ' '))} #${r.entity_id ?? ''}</td><td>${esc(r.detail || '')}</td></tr>`).join('')}</tbody></table></div>`;
}
