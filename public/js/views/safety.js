// Safety registers. Most are the generic register screen with a few options.
import { RESOURCES, riskRating } from '../schema.js';
import { $, $$, api, esc, state, isManager, md, modal, toast, run, statusBadge, badge, fmtDate, fmtDateTime, userName, machineName, dueBadge, riskBadge,
  daysUntil, editRecord, fileLinks, downloadCsv } from '../ui.js';
import { register, linkedActions } from './register.js';
import { rerender } from '../router.js';

export const hazards = (el, params) => register(el, 'hazards', {
  title: 'Hazards and near misses', newLabel: 'Report a hazard or near miss',
  intro: 'See something unsafe, or have a close call? Report it here. It takes a minute, and nobody gets in trouble for reporting.',
  preset: () => (params.machine ? { machine_id: Number(params.machine), location: state.machines.find((m) => m.id === Number(params.machine))?.location || null } : {}),
  tabs: [{ label: 'Open', fn: (r) => r.status !== 'Closed' }, { label: 'Closed', fn: (r) => r.status === 'Closed' }, { label: 'All' }],
  row: (r) => ({ title: r.title, sub: `${esc(r.type)} · ${fmtDateTime(r.created_at)} · ${esc(userName(r.reported_by))}${r.machine_id ? ' · ' + esc(machineName(r.machine_id)) : ''}`, right: `${riskBadge(r)} ${statusBadge(r.status)}` }),
  before: (r) => { const k = riskRating(r.likelihood, r.consequence); return `<p>${statusBadge(r.status)} ${k ? badge(`${k.label} risk (score ${k.score})`, k.cls) : ''} <span class="muted">Reported by ${esc(userName(r.reported_by))}</span></p>`; },
  skip: ['status'],
  extra: (box, rec) => linkedActions(box, 'Hazard', rec),
  onCreated: () => toast('Thanks. Your report is now on the managers\' dashboard.'),
  empty: 'No reports here.',
}, params);

export const incidents = (el, params) => register(el, 'incidents', {
  newLabel: 'Report an incident',
  intro: `Record every injury, illness and incident, however small. ${isManager() ? 'A death, serious injury or dangerous incident is <strong>notifiable</strong>: call SafeWork SA on 1800 777 209 immediately, do not disturb the site, and keep the record for at least 5 years.' : 'You can see the incidents you have reported. Managers see the full register.'}`,
  tabs: [{ label: 'Open', fn: (r) => r.status !== 'Closed' }, { label: 'Closed', fn: (r) => r.status === 'Closed' }, { label: 'All' }],
  row: (r) => ({ title: r.title, sub: `${esc(r.type)} · ${fmtDateTime(r.occurred_at)}${r.person_involved ? ' · ' + esc(r.person_involved) : ''}`,
    right: `${r.notifiable ? badge(r.regulator_notified_at ? 'Notifiable' : 'Notifiable: not yet reported', r.regulator_notified_at ? 'warn' : 'bad') : ''} ${statusBadge(r.status)}` }),
  extra: (box, rec) => linkedActions(box, 'Incident', rec),
  onCreated: () => toast('Incident recorded. It is on the managers\' dashboard. Tell your manager in person as well.'),
}, params);

export const actions = (el, params) => register(el, 'actions', {
  intro: 'Fixes that came out of a hazard report, incident, pre-start check or meeting. Each one has an owner and a due date, and stays here until it is done.',
  tabs: [{ label: 'Mine', fn: (r) => r.assigned_to === state.me.id && r.status !== 'Done' }, { label: 'All open', fn: (r) => r.status !== 'Done' }, { label: 'Done', fn: (r) => r.status === 'Done' }],
  row: (r) => ({ title: r.title, sub: `${esc(userName(r.assigned_to))} · from ${esc((r.source_type || 'other').toLowerCase())}`, right: r.status === 'Done' ? statusBadge('Done') : dueBadge(r.due_date, 7) }),
  extra: (box, rec) => { if (rec.source_id && ['Hazard', 'Incident'].includes(rec.source_type)) box.innerHTML = `<p><a data-close href="#/${rec.source_type === 'Hazard' ? 'hazards' : 'incidents'}/${rec.source_id}">Open the ${rec.source_type.toLowerCase()} this came from</a></p>`; },
  empty: 'No actions here.',
}, params);

export const licences = (el, params) => register(el, 'licences', {
  newLabel: 'Add a licence or ticket',
  intro: isManager() ? 'Forklift licences, first aid certificates, warden training and other tickets for the whole team. Anything expiring in the next 60 days shows on the dashboard.' : 'Add your licences and certificates here with a photo, so we know they are current.',
  row: (r) => ({ title: `${r.type}${r.description ? ' - ' + r.description : ''}`, sub: esc(userName(r.user_id)) + (r.verified ? ' · sighted' : ' · not yet sighted'), right: r.expires ? dueBadge(r.expires, 60) : badge('No expiry', 'mid') }),
  detailTitle: (r) => `${r.type}: ${userName(r.user_id)}`,
}, params);

export const testtag = (el, params) => register(el, 'testtag_items', {
  route: 'testtag', title: 'Test and tag and inspections', newLabel: 'Add item',
  intro: 'Electrical equipment, leads, safety switches, fire extinguishers and first aid kits that need regular testing. Items due in the next 30 days show on the dashboard. Frequencies follow AS/NZS 3760; confirm them with your test and tag contractor.',
  tabs: [{ label: 'Due or overdue', fn: (r) => r.status === 'In service' && (daysUntil(r.next_due) === null || daysUntil(r.next_due) <= 30) }, { label: 'All in service', fn: (r) => r.status === 'In service' }, { label: 'Out of service', fn: (r) => r.status !== 'In service' }],
  row: (r) => ({ title: r.name, sub: esc([r.kind, r.asset_no, r.location].filter(Boolean).join(' · ')), right: r.status === 'In service' ? dueBadge(r.next_due, 30, 'Never tested') : badge(r.status, 'bad') }),
  extra: async (box, rec, reopen) => {
    const tests = await api(`r/testtag_tests?item_id=${rec.id}`);
    box.innerHTML = `<h3>Test history</h3>${tests.length ? tests.map((t) => `<div class="item"><div><strong>${fmtDate(t.tested_on)}</strong><div class="muted">${esc(t.tested_by)}${t.notes ? ' · ' + esc(t.notes) : ''}</div></div><div class="right">${statusBadge(t.result)}</div></div>`).join('') : '<p class="muted">No tests recorded.</p>'}
      ${isManager() ? '<button class="primary" data-test>Record a test</button>' : ''}`;
    $('[data-test]', box)?.addEventListener('click', () => editRecord('testtag_tests', {}, { title: `Record a test: ${rec.name}`, preset: { item_id: rec.id }, onSaved: reopen,
      fields: RESOURCES.testtag_tests.fields.map((f) => (f.k === 'tested_on' ? { ...f, def: state.me.today } : f)) }));
  },
}, params);

export const chemicals = (el, params) => register(el, 'chemicals', {
  intro: 'Every chemical on site with its safety data sheet (SDS). Read the SDS before you use a product for the first time. An SDS has to be replaced once it is 5 years old.',
  row: (r) => { const age = r.sds_date ? -daysUntil(r.sds_date) / 365 : null;
    return { title: r.name, sub: esc([r.used_for, r.location].filter(Boolean).join(' · ')), right: `${r.hazardous ? badge('Hazardous', 'warn') : ''} ${!r.sds ? badge('No SDS', 'bad') : age !== null && age >= 5 ? badge('SDS out of date', 'bad') : ''}` }; },
  before: (r) => (r.sds ? `<p><a class="button primary" href="/api/files/${r.sds.id}" target="_blank">Open safety data sheet</a></p>` : '<div class="alert bad">No safety data sheet has been uploaded for this product.</div>'),
}, params);

export async function emergency(el) {
  const [contacts, pages] = await Promise.all([api('r/contacts'), api('r/pages?slug=emergency')]);
  const page = pages[0];
  const groups = {};
  for (const c of contacts) (groups[c.role] ||= []).push(c);
  el.innerHTML = `<div class="page-head"><h1>Emergency</h1>${isManager() ? '<div class="row"><button data-add>Add contact</button><button data-editpage>Edit plan</button></div>' : ''}</div>
    <a class="emergency-call" href="tel:000">Call 000 for police, fire or ambulance</a>
    ${Object.entries(groups).map(([role, list]) => `<h2>${esc(role)}${list.length > 1 && !/service/i.test(role) ? 's' : ''}</h2><div class="list">${list.map((c) => `<div class="item"><div><strong>${esc(c.name)}</strong>${c.notes ? `<div class="muted">${esc(c.notes)}</div>` : ''}</div>
      <div class="right">${c.phone ? `<a class="button" href="tel:${esc(c.phone.replace(/\s/g, ''))}">📞 ${esc(c.phone)}</a>` : ''}${isManager() ? `<button class="small" data-editc="${c.id}">Edit</button>` : ''}</div></div>`).join('')}</div>`).join('')}
    ${page ? `<div class="card pad">${md(page.content)}${fileLinks(page.files)}</div>` : ''}`;
  $('[data-add]', el)?.addEventListener('click', () => editRecord('contacts', {}, { onSaved: () => rerender() }));
  $('[data-editpage]', el)?.addEventListener('click', () => editRecord('pages', page || {}, { title: 'Emergency plan', preset: page ? {} : { slug: 'emergency', title: 'Emergency plan', category: 'Emergency' }, onSaved: () => rerender() }));
  $$('[data-editc]', el).forEach((b) => b.addEventListener('click', () => {
    const c = contacts.find((x) => x.id === Number(b.dataset.editc));
    const d = editRecord('contacts', c, { onSaved: () => rerender() });
    $('.form-actions', d).insertAdjacentHTML('beforeend', '<button type="button" class="danger" data-delc>Delete</button>');
    $('[data-delc]', d).addEventListener('click', () => run(null, async () => { if (!confirm('Delete this contact?')) return; await api(`r/contacts/${c.id}`, { method: 'DELETE' }); d.close(); rerender(); }));
  }));
}

export const toolbox = async (el, params) => {
  let att = await api('toolbox/attendance');
  return register(el, 'toolbox_talks', {
    route: 'toolbox', newLabel: 'Record a toolbox talk',
    intro: 'Minutes of toolbox talks and safety meetings, with who attended. If you were there, open the talk and confirm your attendance.',
    after: async () => { att = await api('toolbox/attendance'); },
    row: (r) => { const mine = att.find((a) => a.talk_id === r.id && a.user_id === state.me.id); const n = att.filter((a) => a.talk_id === r.id).length;
      return { title: r.title, sub: `${fmtDate(r.held_on)} · ${n} attended`, right: mine && !mine.signed_at ? badge('Confirm attendance', 'warn') : mine ? badge('Attended', 'ok') : '' }; },
    extra: (box, rec, reopen) => {
      const list = att.filter((a) => a.talk_id === rec.id);
      const mine = list.find((a) => a.user_id === state.me.id);
      box.innerHTML = `<h3>Attendance</h3>${list.length ? `<ul>${list.map((a) => `<li>${esc(userName(a.user_id))} ${a.signed_at ? `<span class="muted">confirmed ${fmtDateTime(a.signed_at)}</span>` : '<span class="muted">marked present, not yet confirmed</span>'}</li>`).join('')}</ul>` : '<p class="muted">Nobody recorded yet.</p>'}
        <div class="row">${!mine?.signed_at ? '<button class="primary" data-attend>I attended this talk</button>' : ''}${isManager() ? '<button data-mark>Mark who attended</button>' : ''}</div>
        ${isManager() ? '<p><button data-action>Raise a corrective action from this talk</button></p>' : ''}`;
      $('[data-attend]', box)?.addEventListener('click', (e) => run(e.target, async () => { await api(`toolbox/${rec.id}/attend`, { method: 'POST' }); toast('Attendance confirmed'); reopen(); }));
      $('[data-action]', box)?.addEventListener('click', () => editRecord('actions', {}, { preset: { source_type: 'Toolbox talk', source_id: rec.id }, onSaved: () => toast('Action raised') }));
      $('[data-mark]', box)?.addEventListener('click', () => {
        const d = modal('Who attended?', `<form class="form">${state.users.filter((u) => u.active).map((u) => `<label class="check"><input type="checkbox" value="${u.id}" ${list.find((a) => a.user_id === u.id) ? 'checked' : ''}> ${esc(u.name)}</label>`).join('')}
          <div class="form-actions"><button class="primary" type="submit">Save</button><button type="button" data-close>Cancel</button></div></form>`);
        $('form', d).addEventListener('submit', (e) => { e.preventDefault(); run(e.submitter, async () => {
          await api(`toolbox/${rec.id}/attendance`, { method: 'PUT', body: { user_ids: $$('input:checked', d).map((c) => Number(c.value)) } }); d.close(); reopen(); }); });
      });
    },
  }, params);
};

export const policies = async (el, params) => {
  let acks = await api('policies/acks');
  const acked = (p, uid = state.me.id) => acks.find((a) => a.policy_id === p.id && a.user_id === uid && a.version === (p.version || 1));
  return register(el, 'policies', {
    intro: 'Company policies. Where a policy asks for it, read it and tap "I have read and understood" so there is a record.',
    after: async () => { acks = await api('policies/acks'); },
    tabs: isManager() ? [{ label: 'Current', fn: (r) => r.active }, { label: 'Retired', fn: (r) => !r.active }] : [{ label: 'Current', fn: (r) => r.active }],
    row: (r) => ({ title: r.title, sub: `${esc(r.category || '')} · version ${r.version || 1}`, right: !r.requires_ack ? '' : acked(r) ? badge('Acknowledged', 'ok') : badge('Please read', 'warn') }),
    skip: ['requires_ack', 'active'],
    extra: (box, rec, reopen) => {
      const mine = acked(rec);
      let html = '';
      if (rec.requires_ack) html += mine ? `<div class="alert ok">You acknowledged version ${mine.version} on ${fmtDateTime(mine.acked_at)}.</div>`
        : '<label class="check declare"><input type="checkbox" data-agree> I have read and understood this policy and agree to follow it.</label><p><button class="primary" data-ack>Acknowledge</button></p>';
      if (isManager() && rec.requires_ack) {
        const people = state.users.filter((u) => u.active);
        html += `<h3>Who has acknowledged version ${rec.version || 1}</h3><ul>${people.map((u) => { const a = acked(rec, u.id); return `<li>${esc(u.name)}: ${a ? fmtDateTime(a.acked_at) : '<strong class="text-bad">not yet</strong>'}</li>`; }).join('')}</ul><button data-ackcsv>Export acknowledgements</button>`;
      }
      box.innerHTML = html;
      $('[data-ack]', box)?.addEventListener('click', (e) => run(e.target, async () => {
        if (!$('[data-agree]', box).checked) throw new Error('Tick the box to confirm you have read it.');
        await api(`policies/${rec.id}/ack`, { method: 'POST' }); toast('Acknowledged'); reopen(); }));
      $('[data-ackcsv]', box)?.addEventListener('click', () => downloadCsv('policy-acknowledgements.csv', [['Policy', 'Version', 'Person', 'Acknowledged at'],
        ...acks.filter((a) => a.policy_id === rec.id).map((a) => [rec.title, a.version, userName(a.user_id), a.acked_at])]));
    },
  }, params);
};

export const handbook = (el, params) => register(el, 'pages', {
  route: 'handbook', title: 'Handbook', newLabel: 'Add a page',
  intro: 'How-to guides and general information: opening and closing up, who to call, how to book leave, IT help and anything else worth writing down once.',
  row: (r) => ({ title: r.title, sub: esc(r.category || '') }),
  skip: ['category'],
}, params);

export const notices = (el, params) => register(el, 'notices', {
  newLabel: 'Post a notice',
  row: (r) => ({ title: (r.pinned ? '📌 ' : '') + r.title, sub: `${fmtDate(r.created_at)} · ${esc(userName(r.created_by))}`, right: r.expires && daysUntil(r.expires) < 0 ? badge('Expired', 'mid') : '' }),
  skip: ['pinned'],
}, params);
