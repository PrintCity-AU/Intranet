// End-to-end check of the API rules that matter most (permissions and the training sign-off chain).
// Run "npm run dev" in one terminal with a fresh local database, then "npm test" in another.
const BASE = process.env.BASE || 'http://localhost:8788';
let failures = 0;
const ok = (cond, name) => { if (cond) console.log('  ok  ' + name); else { failures++; console.log('FAIL  ' + name); } };

async function call(who, method, path, body) {
  const res = await fetch(`${BASE}/api/${path}`, { method, headers: { 'X-Dev-User': who, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const run = Date.now().toString(36);
const ADMIN = 'admin@example.com', MGR = `mgr-${run}@example.com`, STAFF = `staff-${run}@example.com`;

const me = await call(ADMIN, 'GET', 'me');
ok(me.data.role === 'admin', 'admin from ADMIN_EMAILS');
ok((await call(ADMIN, 'POST', 'users', { email: MGR, name: 'Mia Manager', role: 'manager' })).status === 201, 'admin adds a manager');
const staff = await call(STAFF, 'GET', 'me');
const mgr = await call(MGR, 'GET', 'me');
ok(staff.data.role === 'staff', 'new sign-in defaults to staff');
ok((await call(STAFF, 'POST', 'users', { email: 'x@example.com' })).status === 403, 'staff cannot add users');
ok((await call(MGR, 'PUT', `users/${staff.data.id}`, { role: 'admin' })).status === 403, 'manager cannot change roles');

// Machines
ok((await call(STAFF, 'POST', 'r/machines', { name: 'Nope' })).status === 403, 'staff cannot add machines');
const machine = (await call(MGR, 'POST', 'r/machines', { name: `Guillotine ${run}`, ppe: ['glasses', 'boots'], hazards: ['Blade'], prestart_items: ['Guards in place', 'E-stop works'], sop: '1. Step one' })).data;
ok(machine.id && machine.ppe.length === 2 && machine.status === 'Operational', 'manager adds a machine with defaults');

// Training
const quiz = [{ q: 'Where do hands go?', options: ['On the buttons', 'Under the blade'], answer: 0 }, { q: 'Guard missing?', options: ['Carry on', 'Stop and report'], answer: 1 }];
ok((await call(MGR, 'POST', 'r/training_modules', { title: 'Bad', quiz: [{ q: 'x', options: ['a'], answer: 0 }] })).status === 400, 'invalid quiz rejected');
const mod = (await call(MGR, 'POST', 'r/training_modules', { title: `Guillotine induction ${run}`, machine_id: machine.id, quiz, practical_items: ['Did a pre-start', 'Shut down correctly'], refresher_months: 12 })).data;
const seen = (await call(STAFF, 'GET', `r/training_modules/${mod.id}`)).data;
ok(seen.quiz.length === 2 && seen.quiz[0].answer === undefined, 'staff cannot see quiz answers');
const fail = await call(STAFF, 'POST', `training/modules/${mod.id}/attempt`, { answers: [1, 1], declared: true });
ok(fail.data.passed === false && fail.data.score === 50 && fail.data.wrong[0] === 0, 'wrong answers fail the quiz');
ok((await call(STAFF, 'POST', `training/modules/${mod.id}/attempt`, { answers: [0, 1] })).status === 400, 'declaration is required');
const pass = await call(STAFF, 'POST', `training/modules/${mod.id}/attempt`, { answers: [0, 1], declared: true });
ok(pass.data.passed && pass.data.record_id, 'correct answers pass');
let recs = (await call(STAFF, 'GET', 'training/records')).data;
ok(recs.length === 1 && recs[0].state === 'Awaiting sign-off', 'quiz pass alone is NOT competent');
const rid = pass.data.record_id;
ok((await call(STAFF, 'POST', `training/records/${rid}/signoff`, { outcome: 'Competent', confirm: true })).status === 403, 'staff cannot sign off');
ok((await call(MGR, 'POST', `training/records/${rid}/signoff`, { outcome: 'Competent', observed: ['Did a pre-start'], confirm: true })).status === 400, 'every practical check must be observed');
ok((await call(MGR, 'POST', `training/records/${rid}/signoff`, { outcome: 'Competent', observed: ['Did a pre-start', 'Shut down correctly'] })).status === 400, 'observer confirmation required');
ok((await call(MGR, 'POST', `training/records/${rid}/signoff`, { outcome: 'Competent', observed: ['Did a pre-start', 'Shut down correctly'], confirm: true, notes: 'Good' })).status === 200, 'manager signs off');
recs = (await call(STAFF, 'GET', 'training/records')).data;
ok(recs[0].state === 'Competent' && recs[0].signed_off_by === mgr.data.id && recs[0].expires_at, 'record is competent with assessor and refresher date');
ok((await call(MGR, 'POST', `training/records/${rid}/signoff`, { outcome: 'Competent', confirm: true })).status === 409, 'cannot sign off twice');
const own = await call(MGR, 'POST', `training/modules/${mod.id}/attempt`, { answers: [0, 1], declared: true });
ok((await call(MGR, 'POST', `training/records/${own.data.record_id}/signoff`, { outcome: 'Competent', observed: ['Did a pre-start', 'Shut down correctly'], confirm: true })).status === 403, 'manager cannot sign off their own training');
await call(MGR, 'PUT', `r/training_modules/${mod.id}`, { version: 2 });
recs = (await call(STAFF, 'GET', 'training/records')).data;
ok(recs[0].state === 'Retraining required', 'raising the module version forces retraining');
ok((await call(MGR, 'DELETE', `r/training_modules/${mod.id}`)).status === 403 && (await call(ADMIN, 'DELETE', `r/training_modules/${mod.id}`)).status === 409, 'modules with records cannot be deleted');

// Hazards and actions
const hz = (await call(STAFF, 'POST', 'r/hazards', { type: 'Near miss', title: 'Pallet nearly fell', description: 'x', status: 'Closed', likelihood: '3 - Possible', consequence: '4 - Major (serious injury)' })).data;
ok(hz.status === 'Open' && hz.reported_by === staff.data.id, 'staff report is open and owned by reporter');
ok((await call(STAFF, 'PUT', `r/hazards/${hz.id}`, { status: 'Closed' })).status === 403, 'staff cannot close hazards');
const act = (await call(MGR, 'POST', 'r/actions', { title: 'Fix racking', assigned_to: staff.data.id, due_date: '2020-01-01', source_type: 'Hazard', source_id: hz.id })).data;
ok(act.id, 'manager raises an action');
const done = (await call(STAFF, 'PUT', `r/actions/${act.id}`, { status: 'Done', completion_notes: 'Fixed', due_date: '2099-01-01', assigned_to: mgr.data.id })).data;
ok(done.status === 'Done' && done.completed_at && done.due_date === '2020-01-01' && done.assigned_to === staff.data.id, 'assignee can complete but not reassign or move the date');
const closed = (await call(MGR, 'PUT', `r/hazards/${hz.id}`, { status: 'Closed' })).data;
ok(closed.closed_at, 'closing a hazard stamps the time');

// Pre-start
ok((await call(STAFF, 'POST', 'prestarts', { machine_id: machine.id, results: ['ok'] })).status === 400, 'pre-start needs every item answered');
ok((await call(STAFF, 'POST', 'prestarts', { machine_id: machine.id, results: ['ok', 'fail'] })).status === 400, 'failed pre-start needs notes');
const ps = (await call(STAFF, 'POST', 'prestarts', { machine_id: machine.id, results: ['ok', 'fail'], notes: 'E-stop sticks' })).data;
ok(ps.all_ok === false && ps.hazard_id, 'failed pre-start raises a hazard');

// Test and tag
const tag = (await call(MGR, 'POST', 'r/testtag_items', { name: 'Heat gun', environment: 'Workshop / production floor (6 months)' })).data;
await call(MGR, 'POST', 'r/testtag_tests', { item_id: tag.id, tested_on: '2026-08-31', result: 'Pass', tested_by: 'Sparky' });
ok((await call(MGR, 'GET', `r/testtag_items/${tag.id}`)).data.next_due === '2027-02-28', 'recording a test sets the next due date');

// Privacy
await call(STAFF, 'POST', 'r/incidents', { title: 'Cut finger', occurred_at: '2026-11-01T10:00', type: 'Injury', description: 'x' });
await call(STAFF, 'POST', 'r/licences', { type: 'First aid', expires: '2026-12-01', user_id: mgr.data.id });
const other = `other-${run}@example.com`;
ok((await call(other, 'GET', 'r/incidents')).data.length === 0 && (await call(other, 'GET', 'r/licences')).data.length === 0, 'staff only see their own incidents and licences');
ok((await call(MGR, 'GET', 'r/licences')).data.some((l) => l.user_id === staff.data.id), 'a staff licence is always recorded against themselves');

// Uniforms
const itemU = (await call(MGR, 'POST', 'r/uniform_items', { name: 'Polo', sizes: ['M', 'L'], price: 30 })).data;
ok((await call(STAFF, 'POST', 'uniform-orders', { lines: [{ item_id: itemU.id, qty: 2 }] })).status === 400, 'size required');
const order = (await call(STAFF, 'POST', 'uniform-orders', { lines: [{ item_id: itemU.id, qty: 2, size: 'L' }] })).data;
ok((await call(STAFF, 'POST', `uniform-orders/${order.id}/status`, { status: 'Approved' })).status === 403, 'staff cannot approve orders');
ok((await call(MGR, 'POST', `uniform-orders/${order.id}/status`, { status: 'Approved' })).status === 200, 'manager approves');
ok((await call(MGR, 'GET', 'uniform-orders')).data.find((o) => o.id === order.id).total === 60, 'order total is calculated on the server');

// Leave and policies
const lv = (await call(STAFF, 'POST', 'r/leave', { type: 'Annual leave', start_date: '2026-12-21', end_date: '2026-12-24', status: 'Approved' })).data;
ok(lv.status === 'Pending', 'staff cannot approve their own leave');
ok((await call(STAFF, 'POST', 'r/leave', { type: 'Annual leave', start_date: '2026-12-21', end_date: '2026-12-01' })).status === 400, 'leave dates validated');
await call(MGR, 'PUT', `r/leave/${lv.id}`, { status: 'Approved' });
ok((await call(STAFF, 'PUT', `r/leave/${lv.id}`, { end_date: '2027-01-30' })).status === 403, 'decided leave cannot be edited by staff');
ok((await call(other, 'GET', 'leave-calendar')).data.find((l) => l.id === lv.id).type === null, 'calendar hides the leave type from other staff');
const pol = (await call(MGR, 'POST', 'r/policies', { title: `WHS policy ${run}`, content: 'Be safe' })).data;
ok((await call(STAFF, 'GET', 'dashboard')).data.policiesToRead.some((p) => p.id === pol.id), 'unread policy shows on the dashboard');
await call(STAFF, 'POST', `policies/${pol.id}/ack`);
ok(!(await call(STAFF, 'GET', 'dashboard')).data.policiesToRead.some((p) => p.id === pol.id), 'acknowledging clears it');

// Files and request safety
const fd = new FormData();
fd.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'evil.html');
const up = await (await fetch(`${BASE}/api/files`, { method: 'POST', headers: { 'X-Dev-User': STAFF }, body: fd })).json();
const dl = await fetch(`${BASE}/api/files/${up.id}`, { headers: { 'X-Dev-User': STAFF } });
ok(dl.headers.get('Content-Disposition').startsWith('attachment') && dl.headers.get('Content-Type') === 'application/octet-stream', 'uploaded web pages download instead of running');
const xs = await fetch(`${BASE}/api/r/notices`, { method: 'POST', headers: { 'X-Dev-User': MGR, Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{"title":"x"}' });
ok(xs.status === 403, 'cross-site posts are blocked');
ok((await call(STAFF, 'GET', 'audit')).status === 403 && (await call(ADMIN, 'GET', 'audit')).data.length > 0, 'activity log is admin only');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
