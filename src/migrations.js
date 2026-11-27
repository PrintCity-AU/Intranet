// Database setup. The app creates and upgrades its own tables on first request,
// so there is no SQL to run by hand in the Cloudflare dashboard.
import { RESOURCES } from '../public/js/schema.js';

const INT_TYPES = ['bool', 'user', 'machine'];
const colType = (t) => (INT_TYPES.includes(t) ? 'INTEGER' : t === 'number' ? 'NUMERIC' : 'TEXT');

// Hand-written tables (records that need tighter control than the generic registers).
const CORE = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT, role TEXT NOT NULL DEFAULT 'staff',
     position TEXT, department TEXT, phone TEXT, manager_id INTEGER, start_date TEXT, active INTEGER NOT NULL DEFAULT 1,
     emergency_name TEXT, emergency_phone TEXT, created_at TEXT, last_seen TEXT)`,
  `CREATE TABLE IF NOT EXISTS files (
     id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, name TEXT, type TEXT, size INTEGER, uploaded_by INTEGER, created_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT, entity TEXT, entity_id INTEGER, detail TEXT, at TEXT)`,
  `CREATE TABLE IF NOT EXISTS training_attempts (
     id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, module_id INTEGER NOT NULL, module_version INTEGER,
     score INTEGER, passed INTEGER, at TEXT)`,
  `CREATE TABLE IF NOT EXISTS training_records (
     id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, module_id INTEGER NOT NULL, module_version INTEGER,
     quiz_score INTEGER, quiz_passed_at TEXT, declared_at TEXT, status TEXT NOT NULL,
     signed_off_by INTEGER, signed_off_at TEXT, observed TEXT, signoff_notes TEXT, expires_at TEXT,
     revoked_by INTEGER, revoked_at TEXT, revoke_reason TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_training_records_user ON training_records(user_id, module_id)`,
  `CREATE TABLE IF NOT EXISTS prestart_checks (
     id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id INTEGER NOT NULL, user_id INTEGER NOT NULL, results TEXT,
     all_ok INTEGER, notes TEXT, hazard_id INTEGER, created_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_prestart_machine ON prestart_checks(machine_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS toolbox_attendance (
     talk_id INTEGER NOT NULL, user_id INTEGER NOT NULL, signed_at TEXT, marked_by INTEGER, PRIMARY KEY (talk_id, user_id))`,
  `CREATE TABLE IF NOT EXISTS policy_acks (
     id INTEGER PRIMARY KEY AUTOINCREMENT, policy_id INTEGER NOT NULL, user_id INTEGER NOT NULL, version INTEGER, acked_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS uniform_orders (
     id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'Pending', notes TEXT,
     lines TEXT, total NUMERIC, decided_by INTEGER, decided_at TEXT, decision_note TEXT, created_at TEXT, updated_at TEXT)`,
];

const SEED = [
  [`INSERT INTO contacts (name, role, phone, notes, sort, created_at) VALUES (?,?,?,?,?,?)`,
    ['Police, fire, ambulance', 'Emergency service', '000', 'Life-threatening emergencies', 1]],
  [`INSERT INTO contacts (name, role, phone, notes, sort, created_at) VALUES (?,?,?,?,?,?)`,
    ['Poisons Information Centre', 'Emergency service', '13 11 26', '24 hours', 2]],
  [`INSERT INTO contacts (name, role, phone, notes, sort, created_at) VALUES (?,?,?,?,?,?)`,
    ['SafeWork SA - notifiable incidents', 'Emergency service', '1800 777 209', '24 hours. Check this number is current.', 3]],
  [`INSERT INTO pages (title, category, slug, content, created_at) VALUES (?,?,?,?,?)`,
    ['Emergency plan', 'Emergency', 'emergency',
      '## In an emergency\n\n1. Raise the alarm and warn people nearby.\n2. Call **000** if anyone is in danger.\n3. Leave by the nearest safe exit and go to the assembly point.\n4. Do not go back inside until a warden says it is safe.\n\n*Edit this page to add your assembly point, evacuation maps, first aid kit and fire extinguisher locations.*']],
];

async function ensureResourceTables(db) {
  for (const [name, res] of Object.entries(RESOURCES)) {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS ${name} (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, created_by INTEGER, updated_at TEXT)`
    ).run();
    const info = await db.prepare(`PRAGMA table_info(${name})`).all();
    const have = new Set(info.results.map((r) => r.name));
    for (const fld of res.fields) {
      if (!have.has(fld.k)) await db.prepare(`ALTER TABLE ${name} ADD COLUMN ${fld.k} ${colType(fld.type)}`).run();
    }
  }
}

const SCHEMA_SIG = (() => {
  const s = JSON.stringify(Object.entries(RESOURCES).map(([n, r]) => [n, r.fields.map((x) => x.k + ':' + x.type)])) + CORE.join('');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'v1-' + h.toString(36);
})();

let ready = null;
export function ensureSchema(db) {
  if (!ready) {
    ready = (async () => {
      let current = null;
      try {
        current = (await db.prepare(`SELECT value FROM meta WHERE key='schema'`).first())?.value;
      } catch (e) { /* first run: meta does not exist yet */ }
      if (current === SCHEMA_SIG) return;
      for (const sql of CORE) await db.prepare(sql).run();
      await ensureResourceTables(db);
      const seeded = await db.prepare(`SELECT value FROM meta WHERE key='seeded'`).first();
      if (!seeded) {
        const now = new Date().toISOString();
        for (const [sql, args] of SEED) await db.prepare(sql).bind(...args, now).run();
        await db.prepare(`INSERT INTO meta (key, value) VALUES ('seeded', ?)`).bind(now).run();
      }
      await db.prepare(`INSERT INTO meta (key, value) VALUES ('schema', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(SCHEMA_SIG).run();
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
