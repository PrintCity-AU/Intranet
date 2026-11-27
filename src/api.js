import { RESOURCES, JSON_TYPES, TESTTAG_ENV, rank } from '../public/js/schema.js';
import { ensureSchema } from './migrations.js';
import { currentUser, HttpError } from './auth.js';
import { custom } from './custom.js';

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const isManager = (u) => rank(u.role) >= 1;
export const isAdmin = (u) => u.role === 'admin';
export const need = (cond, status = 403, msg = 'You do not have permission to do that.') => { if (!cond) throw new HttpError(status, msg); };
export const nowIso = () => new Date().toISOString();
// "Today" for due dates is the date in Adelaide, not UTC.
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Adelaide' }).format(new Date());
export function addMonths(dateStr, months) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + Number(months), d));
  if (dt.getUTCDate() !== d) dt.setUTCDate(0); // e.g. 31 Aug + 6 months lands on the last day of Feb
  return dt.toISOString().slice(0, 10);
}
export async function audit(db, user, action, entity, id, detail) {
  await db.prepare(`INSERT INTO audit_log (user_id, action, entity, entity_id, detail, at) VALUES (?,?,?,?,?,?)`)
    .bind(user.id, action, entity, id ?? null, detail ? String(detail).slice(0, 500) : null, nowIso()).run();
}

export function decodeRow(resName, row) {
  if (!row) return row;
  for (const f of RESOURCES[resName].fields) {
    if (JSON_TYPES.includes(f.type) && typeof row[f.k] === 'string') {
      try { row[f.k] = JSON.parse(row[f.k]); } catch { row[f.k] = null; }
    }
  }
  return row;
}

function clean(f, v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (JSON_TYPES.includes(f.type)) return JSON.stringify(v);
  if (f.type === 'bool') return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
  if (['number', 'user', 'machine'].includes(f.type)) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (f.type === 'select') return f.options.includes(v) ? v : null;
  return String(v).slice(0, 100000);
}

function canDo(level, user, res, row) {
  if (level === 'staff') return true;
  if (level === 'owner') return isManager(user) || (row && row[res.owner] === user.id);
  return rank(user.role) >= rank(level);
}

// Extra rules that run before a record is saved.
async function beforeWrite(name, data, existing, user, db) {
  const merged = { ...(existing || {}), ...data };
  if (name === 'hazards' && data.status === 'Closed' && !existing?.closed_at) data.closed_at = nowIso();
  if (name === 'hazards' && data.status && data.status !== 'Closed') data.closed_at = null;
  if (name === 'actions' && data.status) data.completed_at = data.status === 'Done' ? (existing?.completed_at || nowIso()) : null;
  if (name === 'testtag_items') {
    const preset = TESTTAG_ENV[merged.environment];
    if (preset) data.interval_months = preset;
    const interval = data.interval_months ?? merged.interval_months;
    const lastChanged = data.last_tested && data.last_tested !== existing?.last_tested;
    if (merged.last_tested && interval && (!merged.next_due || (lastChanged && data.next_due === existing?.next_due))) {
      data.next_due = addMonths(merged.last_tested, interval);
    }
  }
  if (name === 'leave') {
    if (merged.end_date < merged.start_date) throw new HttpError(400, 'The last day off is before the first day off.');
    if (existing && !isManager(user) && existing.status !== 'Pending') throw new HttpError(403, 'This request has already been decided. Ask a manager to change it.');
    if (isManager(user) && data.status && data.status !== (existing?.status || 'Pending')) data.decided_by = user.id;
  }
  if (name === 'training_modules' && data.quiz) {
    const quiz = JSON.parse(data.quiz);
    for (const q of quiz) {
      if (!q.q || !Array.isArray(q.options) || q.options.length < 2 || !(q.answer >= 0 && q.answer < q.options.length)) {
        throw new HttpError(400, 'Each quiz question needs a question, at least two answers and a correct answer selected.');
      }
    }
  }
}

async function afterWrite(name, id, data, existing, user, db) {
  if (name === 'testtag_tests' && !existing) {
    const item = await db.prepare(`SELECT * FROM testtag_items WHERE id=?`).bind(data.item_id).first();
    if (item) {
      const next = item.interval_months ? addMonths(data.tested_on, item.interval_months) : null;
      await db.prepare(`UPDATE testtag_items SET last_tested=?, last_result=?, tested_by=?, next_due=?, status=?, updated_at=? WHERE id=?`)
        .bind(data.tested_on, data.result, data.tested_by, next, data.result === 'Fail' ? 'Failed - removed from service' : 'In service', nowIso(), item.id).run();
    }
  }
}

function hideQuizAnswers(row, user) {
  if (!isManager(user) && Array.isArray(row.quiz)) row.quiz = row.quiz.map(({ q, options }) => ({ q, options }));
  return row;
}

async function crud(name, id, request, env, user, url) {
  const res = RESOURCES[name];
  const db = env.DB;
  const method = request.method;
  const out = (row) => (name === 'training_modules' ? hideQuizAnswers(decodeRow(name, row), user) : decodeRow(name, row));
  const ownOnly = res.readScope === 'own' && !isManager(user);

  if (method === 'GET' && !id) {
    const where = [], args = [];
    if (ownOnly) { where.push(`${res.owner} = ?`); args.push(user.id); }
    for (const f of res.fields) {
      const v = url.searchParams.get(f.k);
      if (v !== null) { where.push(`${f.k} = ?`); args.push(v); }
    }
    const sql = `SELECT * FROM ${name}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${res.order || 'id DESC'} LIMIT 2000`;
    const { results } = await db.prepare(sql).bind(...args).all();
    return json(results.map(out));
  }

  let existing = null;
  if (id) {
    existing = await db.prepare(`SELECT * FROM ${name} WHERE id=?`).bind(id).first();
    need(existing, 404, 'That record no longer exists.');
    if (ownOnly) need(existing[res.owner] === user.id);
  }
  if (method === 'GET') return json(out(existing));

  if (method === 'DELETE') {
    need(existing, 404, 'Not found');
    need(canDo(res.del, user, res, existing));
    if (name === 'training_modules') {
      const used = await db.prepare(`SELECT COUNT(*) c FROM training_records WHERE module_id=?`).bind(id).first();
      need(!used.c, 409, 'This module has training records, so it cannot be deleted. Untick "Active" to retire it instead.');
    }
    if (name === 'leave') need(isManager(user) || existing.status === 'Pending', 403, 'This request has already been decided.');
    if (name === 'pages') need(!existing.slug, 409, 'This page is used by the app and cannot be deleted.');
    await db.prepare(`DELETE FROM ${name} WHERE id=?`).bind(id).run();
    await audit(db, user, 'delete', name, id, existing.title || existing.name);
    return json({ ok: true });
  }

  if (method !== 'POST' && method !== 'PUT') throw new HttpError(405, 'Method not allowed');
  need(method === 'POST' ? !id : !!id, 400, 'Bad request');
  need(canDo(existing ? res.update : res.create, user, res, existing));
  const body = await request.json();
  const data = {};
  for (const f of res.fields) {
    if (f.mgr && !isManager(user)) continue;
    const v = clean(f, body[f.k]);
    if (v !== undefined) data[f.k] = v;
  }
  if (res.owner) {
    const of = res.fields.find((f) => f.k === res.owner);
    if (!existing && (of.hide || (of.mgrPick && !isManager(user)) || (of.mgrPick && !data[res.owner]))) data[res.owner] = user.id;
    if (existing && !isManager(user)) delete data[res.owner];
  }
  if (!existing) for (const f of res.fields) if (data[f.k] == null && f.def !== undefined && !(f.mgr && false)) data[f.k] = f.def;
  for (const f of res.fields) {
    const val = f.k in data ? data[f.k] : existing?.[f.k];
    if (f.req && (val === null || val === undefined || val === '')) throw new HttpError(400, `"${f.label}" is required.`);
  }
  await beforeWrite(name, data, existing, user, db);
  const now = nowIso();
  let newId = id;
  if (existing) {
    const keys = Object.keys(data);
    if (keys.length) {
      await db.prepare(`UPDATE ${name} SET ${keys.map((k) => k + '=?').join(', ')}, updated_at=? WHERE id=?`)
        .bind(...keys.map((k) => data[k]), now, id).run();
    }
  } else {
    const keys = Object.keys(data);
    const r = await db.prepare(`INSERT INTO ${name} (${[...keys, 'created_at', 'created_by', 'updated_at'].join(', ')}) VALUES (${keys.map(() => '?').join(',')}${keys.length ? ',' : ''}?,?,?)`)
      .bind(...keys.map((k) => data[k]), now, user.id, now).run();
    newId = r.meta.last_row_id;
  }
  await afterWrite(name, newId, data, existing, user, db);
  await audit(db, user, existing ? 'update' : 'create', name, newId, data.title || data.name || existing?.title || existing?.name);
  return json(out(await db.prepare(`SELECT * FROM ${name} WHERE id=?`).bind(newId).first()), existing ? 200 : 201);
}

export async function handle(context) {
  const { request, env } = context;
  try {
    if (!env.DB) throw new HttpError(503, 'The database is not connected. Add a D1 binding called DB in the Cloudflare Pages settings.');
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      // Browsers only send this header from our own pages, which blocks cross-site form posts.
      const origin = request.headers.get('Origin');
      if (origin && new URL(origin).host !== url.host) throw new HttpError(403, 'Cross-site request blocked');
    }
    await ensureSchema(env.DB);
    const user = await currentUser(request, env);
    if (parts[0] === 'r' && RESOURCES[parts[1]]) {
      const id = parts[2] ? Number(parts[2]) : null;
      if (parts[2] && !Number.isInteger(id)) throw new HttpError(400, 'Bad id');
      return await crud(parts[1], id, request, env, user, url);
    }
    const res = await custom(parts, request, env, user, url);
    if (res) return res;
    throw new HttpError(404, 'Not found');
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Something went wrong on the server. ' + (e.message || '') }, 500);
  }
}
