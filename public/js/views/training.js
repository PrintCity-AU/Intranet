import { $, $$, api, esc, state, isManager, md, modal, toast, run, statusBadge, badge, fmtDate, fmtDateTime, userName, machineName, downloadCsv, STATUS_CLS } from '../ui.js';
import { register } from './register.js';
import { rerender } from '../router.js';

const DECLARATION = 'I have read and understood this training and the procedures for this equipment. I will follow the safe working procedure, wear the required PPE, and I will not operate this equipment on my own until a supervisor has watched me and signed me off as competent.';

// Best record for a person on a module: a current sign-off wins, otherwise the most recent.
const best = (records, userId, moduleId) => records.find((r) => r.user_id === userId && r.module_id === moduleId && r.state === 'Competent')
  || records.find((r) => r.user_id === userId && r.module_id === moduleId);

export async function trainingHome(el, params) {
  const [modules, records] = await Promise.all([api('r/training_modules'), api('training/records')]);
  const active = modules.filter((m) => m.active);
  const mgr = isManager();
  let tab = params.tab || 'mine';
  const waiting = records.filter((r) => r.state === 'Awaiting sign-off');

  const mineHtml = () => active.length ? active.map((m) => { const r = best(records, state.me.id, m.id);
    return `<a class="item" href="#/training/${m.id}"><div><strong>${esc(m.title)}</strong><div class="muted">${esc(machineName(m.machine_id) || 'General training')}${r?.expires_at && r.state === 'Competent' ? ' · refresher due ' + fmtDate(r.expires_at) : ''}</div></div>
      <div class="right">${statusBadge(r ? r.state : 'Not started')}</div></a>`; }).join('') : '<p class="empty">No training modules have been set up yet.</p>';

  const signHtml = () => waiting.length ? waiting.map((r) => `<button class="item" data-sign="${r.id}"><div><strong>${esc(userName(r.user_id))}</strong>
      <div class="muted">${esc(modules.find((m) => m.id === r.module_id)?.title || '')} · quiz passed ${fmtDateTime(r.quiz_passed_at)} (${r.quiz_score}%)</div></div>
      <div class="right">${r.user_id === state.me.id ? badge('Needs another manager', 'mid') : badge('Sign off', 'warn')}</div></button>`).join('')
    : '<p class="empty">Nobody is waiting for a sign-off.</p>';

  const matrixHtml = () => {
    const people = state.users.filter((u) => u.active);
    if (!active.length) return '<p class="empty">No training modules yet.</p>';
    return `<p class="intro">Green means the person passed the quiz and a supervisor signed them off as competent. Tap a cell for the full record.</p>
      <div class="scroll"><table class="matrix"><thead><tr><th></th>${people.map((u) => `<th>${esc(u.name)}</th>`).join('')}</tr></thead><tbody>
      ${active.map((m) => `<tr><th>${esc(m.title)}</th>${people.map((u) => { const r = best(records, u.id, m.id); const s = r ? r.state : 'Not started';
        return `<td class="${STATUS_CLS[s] || 'mid'}" ${r ? `data-rec="${r.id}"` : ''} title="${esc(s)}">${{ Competent: '✓', 'Awaiting sign-off': '…', 'Not started': '', Expired: '!', 'Retraining required': '!', Revoked: '✕', 'Not yet competent': '✕' }[s]}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>
      <p class="legend">${['Competent', 'Awaiting sign-off', 'Expired', 'Not started'].map((s) => statusBadge(s)).join(' ')}</p>
      <button data-export>Export training records</button>`;
  };

  const draw = () => {
    el.innerHTML = `<div class="page-head"><h1>Training</h1>${mgr ? '<a class="button" href="#/training-modules">Manage modules</a>' : ''}</div>
      <p class="intro">Each module has three steps: read the training, pass the quiz, then a supervisor watches you do the job and signs you off. You are not authorised on a machine until all three are done.</p>
      ${mgr ? `<div class="tabs"><button data-tab="mine" class="${tab === 'mine' ? 'on' : ''}">My training</button>
        <button data-tab="sign" class="${tab === 'sign' ? 'on' : ''}">Sign-offs${waiting.length ? ` (${waiting.length})` : ''}</button>
        <button data-tab="matrix" class="${tab === 'matrix' ? 'on' : ''}">Training matrix</button></div>` : ''}
      <div class="list">${tab === 'sign' ? signHtml() : tab === 'matrix' ? matrixHtml() : mineHtml()}</div>`;
  };
  draw();

  el.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { tab = t.dataset.tab; draw(); }
    const s = e.target.closest('[data-sign]');
    if (s) signOff(records.find((r) => r.id === Number(s.dataset.sign)), modules, () => rerender({ tab: 'sign' }));
    const c = e.target.closest('[data-rec]');
    if (c) recordDetail(records.find((r) => r.id === Number(c.dataset.rec)), modules, records, () => rerender({ tab: 'matrix' }));
    if (e.target.closest('[data-export]')) {
      downloadCsv('training-records.csv', [['Person', 'Module', 'Machine', 'Module version', 'Quiz score %', 'Quiz passed', 'Declaration made', 'Status', 'Signed off by', 'Signed off at', 'Practical checks observed', 'Sign-off notes', 'Refresher due', 'Revoked', 'Revoke reason'],
        ...records.map((r) => { const m = modules.find((x) => x.id === r.module_id) || {};
          return [userName(r.user_id), m.title, machineName(m.machine_id), r.module_version, r.quiz_score, r.quiz_passed_at, r.declared_at, r.state, userName(r.signed_off_by), r.signed_off_at, (r.observed || []).join('; '), r.signoff_notes, r.expires_at, r.revoked_at, r.revoke_reason]; })]);
    }
  });
}

function recordHtml(r, mod) {
  return `<dl class="detail">
    <div><dt>Person</dt><dd>${esc(userName(r.user_id))}</dd></div>
    <div><dt>Module</dt><dd>${esc(mod?.title || '')} (version ${r.module_version || 1})</dd></div>
    <div><dt>Status</dt><dd>${statusBadge(r.state)}</dd></div>
    <div><dt>Quiz</dt><dd>${r.quiz_score}% on ${fmtDateTime(r.quiz_passed_at)}</dd></div>
    <div><dt>Declaration</dt><dd>Made ${fmtDateTime(r.declared_at)}</dd></div>
    ${r.signed_off_at ? `<div><dt>Practical assessment</dt><dd>${esc(r.status === 'Not yet competent' ? 'Not yet competent' : 'Competent')}, assessed by ${esc(userName(r.signed_off_by))} on ${fmtDateTime(r.signed_off_at)}
      ${(r.observed || []).length ? `<ul>${r.observed.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}${r.signoff_notes ? `<p class="pre">${esc(r.signoff_notes)}</p>` : ''}</dd></div>` : ''}
    ${r.expires_at ? `<div><dt>Refresher due</dt><dd>${fmtDate(r.expires_at)}</dd></div>` : ''}
    ${r.revoked_at ? `<div><dt>Revoked</dt><dd>${fmtDateTime(r.revoked_at)} by ${esc(userName(r.revoked_by))}: ${esc(r.revoke_reason)}</dd></div>` : ''}
  </dl>`;
}

function recordDetail(r, modules, records, done) {
  const mod = modules.find((m) => m.id === r.module_id);
  const history = records.filter((x) => x.user_id === r.user_id && x.module_id === r.module_id && x.id !== r.id);
  const d = modal('Training record', `${recordHtml(r, mod)}
    ${history.length ? `<h3>Earlier records</h3>${history.map((h) => `<div class="item"><div>${fmtDate(h.quiz_passed_at)} · version ${h.module_version || 1}</div><div class="right">${statusBadge(h.state)}</div></div>`).join('')}` : ''}
    <div class="form-actions">${r.state === 'Awaiting sign-off' ? '<button class="primary" data-go>Sign off</button>' : ''}${r.status === 'Competent' ? '<button class="danger" data-revoke>Revoke sign-off</button>' : ''}</div>`, { wide: true });
  $('[data-go]', d)?.addEventListener('click', () => { d.close(); signOff(r, modules, done); });
  $('[data-revoke]', d)?.addEventListener('click', (e) => {
    const reason = prompt('Why is this sign-off being revoked? (for example: unsafe operation observed, long absence)');
    if (!reason) return;
    run(e.target, async () => { await api(`training/records/${r.id}/revoke`, { method: 'POST', body: { reason } }); d.close(); toast('Sign-off revoked'); done(); });
  });
}

function signOff(r, modules, done) {
  const mod = modules.find((m) => m.id === r.module_id) || {};
  const items = mod.practical_items || [];
  const own = r.user_id === state.me.id;
  const d = modal('Supervisor sign-off', `${recordHtml(r, mod)}
    ${own ? '<div class="alert warn">You cannot sign off your own training. Another manager has to observe you and sign this off.</div>' : `<form class="form">
      <h3>Practical assessment</h3>
      <p class="intro">Watch ${esc(userName(r.user_id))} do each of these on the machine. Only tick what you personally saw done correctly.</p>
      ${items.length ? items.map((it, i) => `<label class="check"><input type="checkbox" name="obs" value="${i}"> ${esc(it)}</label>`).join('') : '<p class="muted">This module has no practical checklist. Add one under Manage modules so sign-offs are specific.</p>'}
      <label class="field"><span>Notes</span><textarea name="notes" rows="3" placeholder="What you observed, anything to follow up"></textarea></label>
      <label class="check"><input type="checkbox" name="confirm"> I personally observed this person and I am satisfied they can operate this equipment safely without direct supervision.</label>
      <div class="form-actions"><button type="submit" class="primary" value="Competent">Sign off as competent</button><button type="submit" class="danger" value="Not yet competent">Not yet competent</button><button type="button" data-close>Cancel</button></div></form>`}`, { wide: true });
  $('form', d)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const outcome = e.submitter?.value || 'Competent';
    run(e.submitter, async () => {
      await api(`training/records/${r.id}/signoff`, { method: 'POST', body: {
        outcome, observed: $$('[name=obs]:checked', form).map((c) => items[Number(c.value)]), notes: form.elements.notes.value.trim(), confirm: form.elements.confirm.checked } });
      d.close(); toast(outcome === 'Competent' ? 'Signed off as competent' : 'Recorded as not yet competent'); done();
    });
  });
}

export async function trainingModule(el, { id }) {
  const [mod, records] = await Promise.all([api(`r/training_modules/${id}`), api('training/records')]);
  const rec = best(records, state.me.id, mod.id);
  const stateNow = rec ? rec.state : 'Not started';
  const quiz = mod.quiz || [];
  const steps = [['Read the training', true], ['Pass the quiz', !!rec && rec.module_version === (mod.version || 1) && stateNow !== 'Retraining required'], ['Supervisor sign-off', stateNow === 'Competent']];
  const needsQuiz = !rec || ['Expired', 'Retraining required', 'Revoked', 'Not yet competent'].includes(stateNow);

  el.innerHTML = `<p><a href="#/training">← All training</a></p>
    <h1>${esc(mod.title)}</h1>
    <p class="muted">${mod.machine_id ? `For <a href="#/machines/${mod.machine_id}">${esc(machineName(mod.machine_id))}</a> · ` : ''}Version ${mod.version || 1} · Your status: ${statusBadge(stateNow)}</p>
    <ol class="steps">${steps.map(([s, ok]) => `<li class="${ok ? 'done' : ''}">${esc(s)}</li>`).join('')}</ol>
    ${stateNow === 'Awaiting sign-off' ? '<div class="alert warn"><strong>Quiz passed.</strong> Ask your supervisor to watch you operate the machine and sign you off. You are not authorised until they do.</div>' : ''}
    ${stateNow === 'Competent' ? `<div class="alert ok">Signed off by ${esc(userName(rec.signed_off_by))} on ${fmtDate(rec.signed_off_at)}.${rec.expires_at ? ' Refresher due ' + fmtDate(rec.expires_at) + '.' : ''}</div>` : ''}
    ${stateNow === 'Not yet competent' ? `<div class="alert bad"><strong>Not yet competent.</strong> ${esc(rec.signoff_notes || '')} Go through the training again, redo the quiz, and arrange another practical assessment.</div>` : ''}
    ${['Expired', 'Retraining required', 'Revoked'].includes(stateNow) ? '<div class="alert bad">Your sign-off is no longer current. Redo this module and get signed off again before operating the machine.</div>' : ''}
    <div class="card pad">${md(mod.content) || '<p class="muted">No training content has been written yet.</p>'}
      ${mod.machine_id ? `<p><a class="button" href="#/machines/${mod.machine_id}">Open the machine page (SOP, PPE, shutdown)</a></p>` : ''}</div>
    ${needsQuiz ? `<form class="card pad form" data-quiz><h2>Quiz</h2><p class="muted">Pass mark ${mod.pass_mark ?? 100}%. You can try again if you do not pass.</p>
      ${quiz.map((q, i) => `<fieldset class="question" data-q="${i}"><legend>${i + 1}. ${esc(q.q)}</legend>${q.options.map((o, j) => `<label class="check"><input type="radio" name="q${i}" value="${j}"> ${esc(o)}</label>`).join('')}</fieldset>`).join('') || '<p class="muted">This module has no quiz questions.</p>'}
      <label class="check declare"><input type="checkbox" name="declared"> ${esc(DECLARATION)}</label>
      <div class="form-actions"><button class="primary" type="submit">Submit</button></div></form>` : ''}`;

  $('[data-quiz]', el)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    run($('button[type=submit]', form), async () => {
      const answers = quiz.map((_, i) => (form.elements['q' + i].value === '' ? null : Number(form.elements['q' + i].value)));
      if (answers.includes(null)) throw new Error('Answer every question.');
      if (!form.elements.declared.checked) throw new Error('Tick the declaration at the bottom to continue.');
      const res = await api(`training/modules/${mod.id}/attempt`, { method: 'POST', body: { answers, declared: true } });
      if (res.passed) { toast(`Passed with ${res.score}%`); return trainingModule(el, { id }); }
      $$('.question', form).forEach((q) => q.classList.toggle('wrong', res.wrong.includes(Number(q.dataset.q))));
      toast(`You scored ${res.score}%. The pass mark is ${res.pass_mark}%. Re-read the training, fix the highlighted questions and try again.`, true);
      $('.question.wrong', form)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
}

export const trainingModules = (el, params) => register(el, 'training_modules', {
  route: 'training-modules', title: 'Training modules', newLabel: 'Add training module',
  intro: 'Write the training, add quiz questions, and list the practical checks a supervisor must see before signing someone off. <a href="#/training">Back to training</a>',
  row: (m) => ({ title: m.title, sub: esc(machineName(m.machine_id) || 'General training') + ` · ${(m.quiz || []).length} questions · v${m.version || 1}`, right: m.active ? '' : badge('Retired', 'mid') }),
}, params);
