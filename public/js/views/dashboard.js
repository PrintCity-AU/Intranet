import { $, api, esc, state, isManager, md, statusBadge, badge, fmtDate, userName, machineName, dueBadge, riskBadge, daysUntil } from '../ui.js';

const panel = (title, count, html, { href, cls = '' } = {}) => `<section class="card panel ${cls}"><header><h2>${esc(title)}${count ? ` <span class="count">${count}</span>` : ''}</h2>${href ? `<a href="${href}">View all</a>` : ''}</header>${html}</section>`;
const item = (href, title, sub, right) => `<a class="item" href="${href}"><div><strong>${esc(title)}</strong>${sub ? `<div class="muted">${sub}</div>` : ''}</div><div class="right">${right || ''}</div></a>`;
const none = (text) => `<p class="empty ok-empty">✓ ${esc(text)}</p>`;

export async function dashboard(el) {
  const d = await api('dashboard');
  const mgr = isManager();
  const first = (state.me.name || '').split(' ')[0];
  const todo = d.myTraining.filter((t) => t.state !== 'Competent');
  const myActions = d.actions.filter((a) => a.assigned_to === state.me.id);
  const overdue = d.actions.filter((a) => daysUntil(a.due_date) < 0);
  const sinceInjury = d.lastInjury ? Math.max(0, -daysUntil(d.lastInjury.slice(0, 10))) : null;
  const tagOver = d.testtag.filter((t) => daysUntil(t.next_due) === null || daysUntil(t.next_due) < 0).length;
  const licOver = d.licences.filter((l) => daysUntil(l.expires) < 0).length;

  const stats = mgr ? [
    ['Open hazards', d.openHazards.length, '#/hazards', d.openHazards.length ? 'warn' : 'ok'],
    ['Overdue actions', overdue.length, '#/actions', overdue.length ? 'bad' : 'ok'],
    ['Awaiting sign-off', d.awaitingSignoff.length, '#/training?tab=sign', d.awaitingSignoff.length ? 'warn' : 'ok'],
    ['Test and tag due', d.testtag.length, '#/testtag', tagOver ? 'bad' : d.testtag.length ? 'warn' : 'ok'],
    ['Licences expiring', d.licences.length, '#/licences', licOver ? 'bad' : d.licences.length ? 'warn' : 'ok'],
    ['Days since last injury', sinceInjury ?? '–', '#/incidents', 'plain'],
  ] : [];

  el.innerHTML = `<div class="page-head"><h1>G'day ${esc(first)}</h1></div>
    <div class="quick">
      <a class="button big warnbtn" href="#/hazards/new">Report a hazard or near miss</a>
      <a class="button big" href="#/machines">Machinery and procedures</a>
      <a class="button big" href="#/emergency">Emergency info</a>
    </div>
    ${d.machinesDown.length ? `<div class="alert bad"><strong>Machines not fully available:</strong> ${d.machinesDown.map((m) => `<a href="#/machines/${m.id}">${esc(m.name)}</a> (${esc(m.status.toLowerCase())})`).join(', ')}</div>` : ''}
    ${mgr ? `<div class="stats">${stats.map(([label, n, href, cls]) => `<a class="stat ${cls}" href="${href}"><strong>${n}</strong><span>${label}</span></a>`).join('')}</div>` : ''}
    <div class="panels">
    ${d.notices.length ? panel('Noticeboard', 0, d.notices.map((n) => `<article class="notice"><h3>${n.pinned ? '<span class="tag-pin">Pinned</span>' : ''}${esc(n.title)}</h3>${md(n.body)}<p class="muted small">${fmtDate(n.created_at)} · ${esc(userName(n.created_by))}</p></article>`).join(''), { href: '#/notices', cls: 'span2' }) : ''}

    ${panel('My to-do list', todo.length + myActions.length + d.policiesToRead.length,
      [...myActions.map((a) => item(`#/actions/${a.id}`, a.title, 'Corrective action', dueBadge(a.due_date, 7))),
        ...d.policiesToRead.map((p) => item(`#/policies/${p.id}`, p.title, 'Policy to read and acknowledge', badge('Please read', 'warn'))),
        ...todo.map((t) => item(`#/training/${t.module_id}`, t.title, esc(machineName(t.machine_id) || 'General training'), statusBadge(t.state)))].join('') || none('Nothing waiting on you.'))}

    ${mgr ? panel('Training waiting for your sign-off', d.awaitingSignoff.length, d.awaitingSignoff.map((r) => item('#/training?tab=sign', userName(r.user_id), esc(d.myTraining.find((t) => t.module_id === r.module_id)?.title || 'Training module'), badge('Sign off', 'warn'))).join('') || none('Nobody is waiting.'), { href: '#/training?tab=sign' }) : ''}

    ${panel('Open hazards and near misses', d.openHazards.length, d.openHazards.slice(0, 8).map((h) => item(`#/hazards/${h.id}`, h.title, `${esc(h.type)} · ${fmtDate(h.created_at)}`, `${riskBadge(h)} ${statusBadge(h.status)}`)).join('') || none('No open hazards.'), { href: '#/hazards' })}

    ${mgr ? panel('Corrective actions', d.actions.length, d.actions.slice(0, 8).map((a) => item(`#/actions/${a.id}`, a.title, esc(userName(a.assigned_to)), dueBadge(a.due_date, 7))).join('') || none('No open actions.'), { href: '#/actions' }) : ''}

    ${mgr && d.openIncidents.length ? panel('Open incidents', d.openIncidents.length, d.openIncidents.map((i) => item(`#/incidents/${i.id}`, i.title, fmtDate(i.occurred_at), `${i.notifiable && !i.regulator_notified_at ? badge('Notify SafeWork SA', 'bad') : ''} ${statusBadge(i.status)}`)).join(''), { href: '#/incidents' }) : ''}

    ${panel('Test and tag due', d.testtag.length, d.testtag.slice(0, 8).map((t) => item(`#/testtag/${t.id}`, t.name, esc([t.asset_no, t.location].filter(Boolean).join(' · ')), dueBadge(t.next_due, 30, 'Never tested'))).join('') || none('Nothing due in the next month.'), { href: '#/testtag' })}

    ${panel(mgr ? 'Licences and tickets expiring' : 'My licences expiring', d.licences.length, d.licences.map((l) => item(`#/licences/${l.id}`, l.type, esc(userName(l.user_id)), dueBadge(l.expires, 60))).join('') || none('Nothing expiring in the next 2 months.'), { href: '#/licences' })}

    ${mgr ? panel('Training lapsed or lapsing', d.trainingLapsing.length, d.trainingLapsing.map((r) => item('#/training?tab=matrix', userName(r.user_id), esc(d.myTraining.find((t) => t.module_id === r.module_id)?.title || ''), r.state === 'Competent' ? dueBadge(r.expires_at, 60) : statusBadge(r.state))).join('') || none('All sign-offs are current.'), { href: '#/training?tab=matrix' }) : ''}

    ${mgr && (d.pendingUniforms.length || d.pendingLeave.length) ? panel('Waiting for your approval', d.pendingUniforms.length + d.pendingLeave.length,
      [...d.pendingUniforms.map((o) => item('#/uniforms', `Uniform order: ${userName(o.user_id)}`, fmtDate(o.created_at), badge('Pending', 'warn'))),
        ...d.pendingLeave.map((l) => item(`#/leave/${l.id}`, `Leave: ${userName(l.user_id)}`, `${fmtDate(l.start_date)} to ${fmtDate(l.end_date)}`, badge('Pending', 'warn')))].join('')) : ''}

    ${mgr && d.sdsOld.length ? panel('Safety data sheets to update', d.sdsOld.length, d.sdsOld.map((c) => item(`#/chemicals/${c.id}`, c.name, c.sds_date ? 'SDS dated ' + fmtDate(c.sds_date) : 'No SDS date recorded', badge(c.sds_date ? 'Over or nearly 5 years old' : 'Missing', 'bad'))).join(''), { href: '#/chemicals' }) : ''}

    ${mgr && d.policyReview.length ? panel('Policies due for review', d.policyReview.length, d.policyReview.map((p) => item(`#/policies/${p.id}`, p.title, '', dueBadge(p.review_date, 60))).join(''), { href: '#/policies' }) : ''}

    ${d.awayToday.length ? panel('Away today', 0, `<p class="pad">${d.awayToday.map((a) => esc(userName(a.user_id))).join(', ')}</p>`, { href: '#/leave' }) : ''}
    </div>`;
}
