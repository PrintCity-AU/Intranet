// Endpoints that need more than simple create/read/update/delete.
import { json, isManager, isAdmin, need, nowIso, today, addMonths, audit, decodeRow } from './api.js';
import { HttpError } from './auth.js';
import { ROLES } from '../public/js/schema.js';

const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
const parse = (s, d = null) => { try { return JSON.parse(s) ?? d; } catch { return d; } };

function publicUser(u, viewer) {
  const o = { id: u.id, email: u.email, name: u.name, role: u.role, position: u.position, department: u.department,
    phone: u.phone, manager_id: u.manager_id, start_date: u.start_date, active: u.active };
  if (isManager(viewer) || viewer.id === u.id) { o.emergency_name = u.emergency_name; o.emergency_phone = u.emergency_phone; o.last_seen = u.last_seen; }
  return o;
}

// A training record's live state, taking expiry and module changes into account.
export function recordState(rec, mod, day) {
  if (rec.status !== 'Competent') return rec.status;
  if (mod && (mod.version || 1) > (rec.module_version || 1)) return 'Retraining required';
  if (rec.expires_at && rec.expires_at < day) return 'Expired';
  return 'Competent';
}

async function trainingRecords(db, user, where = '', args = []) {
  const day = today();
  const mods = Object.fromEntries((await all(db, `SELECT id, version, title, machine_id FROM training_modules`)).map((m) => [m.id, m]));
  const rows = await all(db, `SELECT * FROM training_records ${where} ORDER BY id DESC`, ...args);
  return rows.map((r) => ({ ...r, observed: parse(r.observed, []), state: recordState(r, mods[r.module_id], day) }));
}

export async function custom(parts, request, env, user, url) {
  const db = env.DB;
  const m = request.method;
  const [a, b, c] = parts;
  const body = async () => { try { return await request.json(); } catch { return {}; } };

  // ---- Me and users -------------------------------------------------------
  if (a === 'me' && m === 'GET') return json({ ...publicUser(user, user), today: today(), dev: !env.ACCESS_AUD });
  if (a === 'me' && m === 'PUT') {
    const d = await body();
    await db.prepare(`UPDATE users SET name=?, phone=?, emergency_name=?, emergency_phone=? WHERE id=?`)
      .bind(String(d.name || user.name).slice(0, 100), d.phone || null, d.emergency_name || null, d.emergency_phone || null, user.id).run();
    return json({ ok: true });
  }
  if (a === 'users' && m === 'GET') {
    const rows = await all(db, `SELECT * FROM users ORDER BY name`);
    return json(rows.filter((u) => u.active || isManager(user)).map((u) => publicUser(u, user)));
  }
  if (a === 'users' && (m === 'POST' || m === 'PUT')) {
    need(isAdmin(user));
    const d = await body();
    const role = ROLES.includes(d.role) ? d.role : 'staff';
    const vals = [d.name || null, role, d.position || null, d.department || null, d.phone || null,
      d.manager_id ? Number(d.manager_id) : null, d.start_date || null, d.active === false || d.active === 0 ? 0 : 1];
    if (m === 'POST') {
      const email = String(d.email || '').trim().toLowerCase();
      need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 400, 'Enter a valid email address.');
      need(!(await one(db, `SELECT id FROM users WHERE email=?`, email)), 409, 'Someone with that email already exists.');
      const r = await db.prepare(`INSERT INTO users (name, role, position, department, phone, manager_id, start_date, active, email, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .bind(...vals, email, nowIso()).run();
      await audit(db, user, 'create', 'users', r.meta.last_row_id, email);
      return json({ id: r.meta.last_row_id }, 201);
    }
    const id = Number(b);
    const target = await one(db, `SELECT * FROM users WHERE id=?`, id);
    need(target, 404, 'Not found');
    if (id === user.id) need(role === 'admin' && vals[7] === 1, 400, 'You cannot remove your own admin access. Ask another admin.');
    need(Number(d.manager_id) !== id, 400, 'A person cannot report to themselves.');
    await db.prepare(`UPDATE users SET name=?, role=?, position=?, department=?, phone=?, manager_id=?, start_date=?, active=? WHERE id=?`).bind(...vals, id).run();
    await audit(db, user, 'update', 'users', id, `${target.email} role=${role} active=${vals[7]}`);
    return json({ ok: true });
  }

  // ---- Files (stored in R2) ----------------------------------------------
  if (a === 'files' && m === 'POST') {
    need(env.FILES, 503, 'File storage is not connected. Add an R2 binding called FILES in the Cloudflare Pages settings.');
    const form = await request.formData();
    const file = form.get('file');
    need(file && typeof file !== 'string', 400, 'No file received.');
    need(file.size <= 25 * 1024 * 1024, 413, 'Files must be under 25 MB.');
    const key = `${crypto.randomUUID()}/${file.name.replace(/[^\w.\- ]+/g, '_').slice(-100)}`;
    await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
    const r = await db.prepare(`INSERT INTO files (key, name, type, size, uploaded_by, created_at) VALUES (?,?,?,?,?,?)`)
      .bind(key, file.name.slice(-200), file.type || '', file.size, user.id, nowIso()).run();
    return json({ id: r.meta.last_row_id, name: file.name, type: file.type, size: file.size }, 201);
  }
  if (a === 'files' && b && m === 'GET') {
    need(env.FILES, 503, 'File storage is not connected.');
    const meta = await one(db, `SELECT * FROM files WHERE id=?`, Number(b));
    need(meta, 404, 'File not found');
    const obj = await env.FILES.get(meta.key);
    need(obj, 404, 'File not found');
    // Only pictures and PDFs open in the browser. Anything else downloads, so an uploaded web page can never run here.
    const inline = /^image\/(png|jpeg|gif|webp)$/.test(meta.type) || meta.type === 'application/pdf';
    return new Response(obj.body, { headers: {
      'Content-Type': inline ? meta.type : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${meta.name.replace(/["\\\r\n]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, max-age=86400',
    } });
  }

  // ---- Training -----------------------------------------------------------
  if (a === 'training' && b === 'records' && !c && m === 'GET') {
    const who = url.searchParams.get('user_id');
    if (!isManager(user)) return json(await trainingRecords(db, user, 'WHERE user_id=?', [user.id]));
    return json(who ? await trainingRecords(db, user, 'WHERE user_id=?', [Number(who)]) : await trainingRecords(db, user));
  }
  if (a === 'training' && b === 'modules' && parts[3] === 'attempt' && m === 'POST') {
    const mod = decodeRow('training_modules', await one(db, `SELECT * FROM training_modules WHERE id=?`, Number(c)));
    need(mod && mod.active, 404, 'That training module is not available.');
    const d = await body();
    const quiz = mod.quiz || [];
    const answers = Array.isArray(d.answers) ? d.answers : [];
    const wrong = [];
    quiz.forEach((q, i) => { if (Number(answers[i]) !== Number(q.answer) || answers[i] === null || answers[i] === undefined) wrong.push(i); });
    const score = quiz.length ? Math.round(((quiz.length - wrong.length) / quiz.length) * 100) : 100;
    const passed = score >= (mod.pass_mark ?? 100);
    const now = nowIso();
    await db.prepare(`INSERT INTO training_attempts (user_id, module_id, module_version, score, passed, at) VALUES (?,?,?,?,?,?)`)
      .bind(user.id, mod.id, mod.version || 1, score, passed ? 1 : 0, now).run();
    if (!passed) return json({ passed: false, score, wrong, pass_mark: mod.pass_mark ?? 100 });
    need(d.declared === true, 400, 'You need to tick the declaration to finish this module.');
    const existing = (await trainingRecords(db, user, 'WHERE user_id=? AND module_id=?', [user.id, mod.id]))
      .find((r) => r.state === 'Competent' || (r.state === 'Awaiting sign-off' && r.module_version === (mod.version || 1)));
    if (existing && existing.state === 'Competent') return json({ passed: true, score, already: true, record_id: existing.id });
    let id = existing?.id;
    if (existing) {
      await db.prepare(`UPDATE training_records SET quiz_score=?, quiz_passed_at=?, declared_at=? WHERE id=?`).bind(score, now, now, id).run();
    } else {
      const r = await db.prepare(`INSERT INTO training_records (user_id, module_id, module_version, quiz_score, quiz_passed_at, declared_at, status) VALUES (?,?,?,?,?,?, 'Awaiting sign-off')`)
        .bind(user.id, mod.id, mod.version || 1, score, now, now).run();
      id = r.meta.last_row_id;
    }
    await audit(db, user, 'quiz-passed', 'training_records', id, `${mod.title} ${score}%`);
    return json({ passed: true, score, record_id: id });
  }
  if (a === 'training' && b === 'records' && c && m === 'POST') {
    need(isManager(user));
    const rec = await one(db, `SELECT * FROM training_records WHERE id=?`, Number(c));
    need(rec, 404, 'Record not found');
    const d = await body();
    const now = nowIso();
    if (parts[3] === 'signoff') {
      need(rec.user_id !== user.id, 403, 'You cannot sign off your own training. Another manager has to observe you.');
      need(rec.status === 'Awaiting sign-off' || rec.status === 'Not yet competent', 409, 'This record has already been signed off.');
      const mod = decodeRow('training_modules', await one(db, `SELECT * FROM training_modules WHERE id=?`, rec.module_id));
      const outcome = d.outcome === 'Competent' ? 'Competent' : 'Not yet competent';
      const items = mod?.practical_items || [];
      const observed = (Array.isArray(d.observed) ? d.observed : []).filter((x) => items.includes(x));
      if (outcome === 'Competent') {
        need(observed.length === items.length, 400, 'Every practical check has to be observed and ticked before you can sign someone off as competent.');
        need(d.confirm === true, 400, 'Tick the confirmation that you personally observed this person.');
      }
      const expires = outcome === 'Competent' && mod?.refresher_months ? addMonths(today(), mod.refresher_months) : null;
      await db.prepare(`UPDATE training_records SET status=?, signed_off_by=?, signed_off_at=?, observed=?, signoff_notes=?, expires_at=? WHERE id=?`)
        .bind(outcome, user.id, now, JSON.stringify(observed), d.notes || null, expires, rec.id).run();
      await audit(db, user, 'signoff', 'training_records', rec.id, `${outcome}: user ${rec.user_id}, module ${rec.module_id}`);
      return json({ ok: true });
    }
    if (parts[3] === 'revoke') {
      need(rec.status === 'Competent', 409, 'Only a competent record can be revoked.');
      need(d.reason, 400, 'Give a reason for revoking this sign-off.');
      await db.prepare(`UPDATE training_records SET status='Revoked', revoked_by=?, revoked_at=?, revoke_reason=? WHERE id=?`).bind(user.id, now, String(d.reason), rec.id).run();
      await audit(db, user, 'revoke', 'training_records', rec.id, d.reason);
      return json({ ok: true });
    }
  }

  // ---- Pre-start checks ---------------------------------------------------
  if (a === 'prestarts' && m === 'GET') {
    const mid = url.searchParams.get('machine_id');
    return json((await all(db, `SELECT * FROM prestart_checks ${mid ? 'WHERE machine_id=?' : ''} ORDER BY id DESC LIMIT 300`, ...(mid ? [Number(mid)] : [])))
      .map((r) => ({ ...r, results: parse(r.results, []) })));
  }
  if (a === 'prestarts' && m === 'POST') {
    const d = await body();
    const machine = decodeRow('machines', await one(db, `SELECT * FROM machines WHERE id=?`, Number(d.machine_id)));
    need(machine, 404, 'Machine not found');
    const items = machine.prestart_items || [];
    const results = items.map((item, i) => ({ item, result: ['ok', 'fail', 'na'].includes(d.results?.[i]) ? d.results[i] : null }));
    need(results.every((r) => r.result), 400, 'Answer every item on the checklist.');
    const failed = results.filter((r) => r.result === 'fail');
    need(!failed.length || d.notes, 400, 'Describe what is wrong so it can be fixed.');
    const now = nowIso();
    let hazardId = null;
    if (failed.length) {
      const r = await db.prepare(`INSERT INTO hazards (type, title, description, machine_id, location, occurred_at, status, reported_by, created_at, created_by, updated_at) VALUES ('Hazard',?,?,?,?,?,'Open',?,?,?,?)`)
        .bind(`Pre-start check failed: ${machine.name}`, `Failed items:\n- ${failed.map((x) => x.item).join('\n- ')}\n\n${d.notes}`, machine.id, machine.location || null, now, user.id, now, user.id, now).run();
      hazardId = r.meta.last_row_id;
    }
    const r = await db.prepare(`INSERT INTO prestart_checks (machine_id, user_id, results, all_ok, notes, hazard_id, created_at) VALUES (?,?,?,?,?,?,?)`)
      .bind(machine.id, user.id, JSON.stringify(results), failed.length ? 0 : 1, d.notes || null, hazardId, now).run();
    return json({ id: r.meta.last_row_id, all_ok: !failed.length, hazard_id: hazardId }, 201);
  }

  // ---- Toolbox talk attendance -------------------------------------------
  if (a === 'toolbox' && b === 'attendance' && m === 'GET') return json(await all(db, `SELECT * FROM toolbox_attendance`));
  if (a === 'toolbox' && c === 'attend' && m === 'POST') {
    need(await one(db, `SELECT id FROM toolbox_talks WHERE id=?`, Number(b)), 404, 'Not found');
    await db.prepare(`INSERT INTO toolbox_attendance (talk_id, user_id, signed_at) VALUES (?,?,?) ON CONFLICT(talk_id, user_id) DO UPDATE SET signed_at=COALESCE(toolbox_attendance.signed_at, excluded.signed_at)`)
      .bind(Number(b), user.id, nowIso()).run();
    return json({ ok: true });
  }
  if (a === 'toolbox' && c === 'attendance' && m === 'PUT') {
    need(isManager(user));
    const ids = ((await body()).user_ids || []).map(Number).filter(Boolean);
    const cur = await all(db, `SELECT * FROM toolbox_attendance WHERE talk_id=?`, Number(b));
    for (const r of cur) if (!ids.includes(r.user_id) && !r.signed_at) await db.prepare(`DELETE FROM toolbox_attendance WHERE talk_id=? AND user_id=?`).bind(Number(b), r.user_id).run();
    for (const id of ids) if (!cur.find((r) => r.user_id === id)) await db.prepare(`INSERT INTO toolbox_attendance (talk_id, user_id, marked_by) VALUES (?,?,?)`).bind(Number(b), id, user.id).run();
    return json({ ok: true });
  }

  // ---- Policy acknowledgements -------------------------------------------
  if (a === 'policies' && b === 'acks' && m === 'GET') {
    return json(isManager(user) ? await all(db, `SELECT * FROM policy_acks`) : await all(db, `SELECT * FROM policy_acks WHERE user_id=?`, user.id));
  }
  if (a === 'policies' && c === 'ack' && m === 'POST') {
    const p = await one(db, `SELECT * FROM policies WHERE id=?`, Number(b));
    need(p, 404, 'Not found');
    if (!(await one(db, `SELECT id FROM policy_acks WHERE policy_id=? AND user_id=? AND version=?`, p.id, user.id, p.version || 1))) {
      await db.prepare(`INSERT INTO policy_acks (policy_id, user_id, version, acked_at) VALUES (?,?,?,?)`).bind(p.id, user.id, p.version || 1, nowIso()).run();
      await audit(db, user, 'acknowledge', 'policies', p.id, `${p.title} v${p.version || 1}`);
    }
    return json({ ok: true });
  }

  // ---- Uniform orders -----------------------------------------------------
  if (a === 'uniform-orders' && m === 'GET') {
    const rows = isManager(user) ? await all(db, `SELECT * FROM uniform_orders ORDER BY id DESC LIMIT 500`) : await all(db, `SELECT * FROM uniform_orders WHERE user_id=? ORDER BY id DESC`, user.id);
    return json(rows.map((r) => ({ ...r, lines: parse(r.lines, []) })));
  }
  if (a === 'uniform-orders' && !b && m === 'POST') {
    const d = await body();
    const lines = [];
    for (const l of Array.isArray(d.lines) ? d.lines : []) {
      const qty = Math.floor(Number(l.qty));
      if (!(qty > 0)) continue;
      const item = decodeRow('uniform_items', await one(db, `SELECT * FROM uniform_items WHERE id=? AND active=1`, Number(l.item_id)));
      need(item, 400, 'One of those items is no longer available.');
      need(!(item.sizes || []).length || item.sizes.includes(l.size), 400, `Choose a size for ${item.name}.`);
      need(qty <= 20, 400, 'That quantity looks too high.');
      lines.push({ item_id: item.id, name: item.name, size: l.size || null, qty, price: item.price || 0 });
    }
    need(lines.length, 400, 'Add at least one item.');
    const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
    const now = nowIso();
    const r = await db.prepare(`INSERT INTO uniform_orders (user_id, status, notes, lines, total, created_at, updated_at) VALUES (?, 'Pending', ?,?,?,?,?)`)
      .bind(user.id, d.notes || null, JSON.stringify(lines), total, now, now).run();
    await audit(db, user, 'create', 'uniform_orders', r.meta.last_row_id);
    return json({ id: r.meta.last_row_id }, 201);
  }
  if (a === 'uniform-orders' && c === 'status' && m === 'POST') {
    const o = await one(db, `SELECT * FROM uniform_orders WHERE id=?`, Number(b));
    need(o, 404, 'Not found');
    const d = await body();
    const now = nowIso();
    if (d.status === 'Cancelled') {
      need(o.user_id === user.id || isManager(user));
      need(o.status === 'Pending', 409, 'Only a pending order can be cancelled.');
    } else {
      need(isManager(user));
      need(['Approved', 'Declined', 'Ordered', 'Received'].includes(d.status), 400, 'Bad status');
      if (['Approved', 'Declined'].includes(d.status)) {
        need(o.status === 'Pending', 409, 'This order has already been decided.');
        need(o.user_id !== user.id || isAdmin(user), 403, 'You cannot approve your own order.');
      } else need(['Approved', 'Ordered'].includes(o.status), 409, 'The order has to be approved first.');
    }
    const decided = ['Approved', 'Declined'].includes(d.status);
    await db.prepare(`UPDATE uniform_orders SET status=?, decided_by=COALESCE(?, decided_by), decided_at=COALESCE(?, decided_at), decision_note=COALESCE(?, decision_note), updated_at=? WHERE id=?`)
      .bind(d.status, decided ? user.id : null, decided ? now : null, d.note || null, now, o.id).run();
    await audit(db, user, d.status.toLowerCase(), 'uniform_orders', o.id);
    return json({ ok: true });
  }

  // ---- Leave calendar (everyone can see who is away, not why) ------------
  if (a === 'leave-calendar' && m === 'GET') {
    const rows = await all(db, `SELECT id, user_id, type, start_date, end_date, status FROM leave WHERE status != 'Declined' AND end_date >= date(?, '-2 months') ORDER BY start_date`, today());
    return json(rows.map((r) => (isManager(user) || r.user_id === user.id ? r : { ...r, type: null })));
  }

  // ---- Audit log ----------------------------------------------------------
  if (a === 'audit' && m === 'GET') {
    need(isAdmin(user));
    return json(await all(db, `SELECT * FROM audit_log ORDER BY id DESC LIMIT 500`));
  }

  // ---- Dashboard ----------------------------------------------------------
  if (a === 'dashboard' && m === 'GET') {
    const day = today();
    const soon = addMonths(day, 1), soon2 = addMonths(day, 2);
    const mgr = isManager(user);
    const out = { today: day };
    out.notices = (await all(db, `SELECT * FROM notices WHERE expires IS NULL OR expires >= ? ORDER BY pinned DESC, created_at DESC LIMIT 5`, day));
    out.openHazards = await all(db, `SELECT id, type, title, status, likelihood, consequence, created_at, machine_id FROM hazards WHERE status != 'Closed' ORDER BY created_at DESC`);
    out.actions = await all(db, `SELECT id, title, assigned_to, due_date, status FROM actions WHERE status != 'Done' ${mgr ? '' : 'AND assigned_to = ?'} ORDER BY due_date`, ...(mgr ? [] : [user.id]));
    out.licences = await all(db, `SELECT id, user_id, type, expires FROM licences WHERE expires IS NOT NULL AND expires <= ? ${mgr ? '' : 'AND user_id = ?'} ORDER BY expires`, soon2, ...(mgr ? [] : [user.id]));
    out.testtag = await all(db, `SELECT id, name, asset_no, location, next_due FROM testtag_items WHERE status = 'In service' AND (next_due IS NULL OR next_due <= ?) ORDER BY next_due`, soon);
    const mods = await all(db, `SELECT id, title, machine_id, version, active FROM training_modules WHERE active = 1`);
    const recs = await trainingRecords(db, user, mgr ? '' : 'WHERE user_id=?', mgr ? [] : [user.id]);
    out.awaitingSignoff = mgr ? recs.filter((r) => r.state === 'Awaiting sign-off') : [];
    const mine = recs.filter((r) => r.user_id === user.id);
    out.myTraining = mods.map((mo) => {
      const r = mine.find((x) => x.module_id === mo.id && x.state === 'Competent') || mine.find((x) => x.module_id === mo.id);
      return { module_id: mo.id, title: mo.title, machine_id: mo.machine_id, state: r ? r.state : 'Not started', expires_at: r?.expires_at || null };
    });
    // Latest record per person per module, to find sign-offs that have lapsed or are about to.
    const latest = new Map();
    for (const r of recs) { const k = r.user_id + ':' + r.module_id; if (!latest.has(k) && r.status === 'Competent') latest.set(k, r); }
    out.trainingLapsing = [...latest.values()].filter((r) => mods.find((mo) => mo.id === r.module_id) && (r.state !== 'Competent' || (r.expires_at && r.expires_at <= soon2)))
      .map((r) => ({ id: r.id, user_id: r.user_id, module_id: r.module_id, state: r.state, expires_at: r.expires_at }));
    const acks = await all(db, `SELECT policy_id, version FROM policy_acks WHERE user_id=?`, user.id);
    out.policiesToRead = (await all(db, `SELECT id, title, version FROM policies WHERE active=1 AND requires_ack=1`))
      .filter((p) => !acks.find((k) => k.policy_id === p.id && k.version === (p.version || 1)));
    out.sdsOld = mgr ? await all(db, `SELECT id, name, sds_date FROM chemicals WHERE sds_date IS NULL OR sds_date <= date(?, '-5 years', '+2 months')`, day) : [];
    out.machinesDown = await all(db, `SELECT id, name, status FROM machines WHERE status != 'Operational'`);
    if (mgr) {
      out.pendingUniforms = await all(db, `SELECT id, user_id, total, created_at FROM uniform_orders WHERE status='Pending'`);
      out.pendingLeave = await all(db, `SELECT id, user_id, start_date, end_date, type FROM leave WHERE status='Pending'`);
      out.openIncidents = await all(db, `SELECT id, title, occurred_at, status, notifiable, regulator_notified_at FROM incidents WHERE status != 'Closed' ORDER BY occurred_at DESC`);
      out.policyReview = await all(db, `SELECT id, title, review_date FROM policies WHERE active=1 AND review_date IS NOT NULL AND review_date <= ?`, soon2);
    }
    const lastInjury = await one(db, `SELECT MAX(occurred_at) d FROM incidents WHERE type IN ('Injury','Illness')`);
    out.lastInjury = lastInjury?.d || null;
    out.awayToday = await all(db, `SELECT user_id FROM leave WHERE status='Approved' AND start_date <= ? AND end_date >= ?`, day, day);
    return json(out);
  }
  return null;
}
