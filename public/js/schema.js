// Shared definitions used by BOTH the browser app and the API (functions import this file).
// Adding a field here needs a matching column in src/migrations.js.

export const PPE = {
  glasses: { label: 'Safety glasses', sign: 'M004' },
  hearing: { label: 'Hearing protection', sign: 'M003' },
  boots: { label: 'Safety footwear', sign: 'M008' },
  gloves: { label: 'Gloves', sign: 'M009' },
  cut_gloves: { label: 'Cut-resistant gloves', sign: 'M009' },
  hivis: { label: 'Hi-vis clothing', sign: 'M015' },
  mask: { label: 'Dust mask / respirator', sign: 'M016' },
  face: { label: 'Face shield', sign: 'M013' },
  apron: { label: 'Apron', sign: 'M026' },
  hair: { label: 'Long hair tied back', sign: 'M001' },
  no_loose: { label: 'No loose clothing or jewellery', sign: 'M001' },
};

export const ROLES = ['staff', 'manager', 'admin'];
export const rank = (role) => ROLES.indexOf(role || 'staff');

export const RISK_LIKELIHOOD = ['1 - Rare', '2 - Unlikely', '3 - Possible', '4 - Likely', '5 - Almost certain'];
export const RISK_CONSEQUENCE = ['1 - Insignificant', '2 - Minor (first aid)', '3 - Moderate (medical treatment)', '4 - Major (serious injury)', '5 - Catastrophic (fatality)'];
export function riskRating(l, c) {
  const s = (parseInt(l) || 0) * (parseInt(c) || 0);
  if (!s) return null;
  if (s >= 15) return { score: s, label: 'Extreme', cls: 'bad' };
  if (s >= 10) return { score: s, label: 'High', cls: 'warn' };
  if (s >= 5) return { score: s, label: 'Medium', cls: 'mid' };
  return { score: s, label: 'Low', cls: 'ok' };
}

export const TESTTAG_ENV = {
  'Workshop / production floor (6 months)': 6,
  'Office / low risk (5 years)': 60,
  'Hostile environment, cords flexed or abused (12 months)': 12,
  'Hire or portable site equipment (3 months)': 3,
  'Custom': null,
};

// Field types: text, textarea, markdown, date, datetime, number, select, bool,
// user, machine, list, ppe, file, files, quiz.
// Flags: req (required), mgr (only managers can set), hide (not shown in forms), list (show in list rows)
const f = (k, label, type = 'text', extra = {}) => ({ k, label, type, ...extra });

export const RESOURCES = {
  machines: {
    label: 'Machine', plural: 'Machinery', create: 'manager', update: 'manager', del: 'admin', order: 'name',
    fields: [
      f('name', 'Machine name', 'text', { req: true }),
      f('asset_no', 'Asset number'),
      f('category', 'Category', 'select', { options: ['Printing', 'Cutting', 'Finishing', 'Laminating', 'Wide format', 'Forklift / vehicle', 'Workshop', 'Other'] }),
      f('make_model', 'Make and model'),
      f('serial_no', 'Serial number'),
      f('location', 'Location'),
      f('status', 'Status', 'select', { options: ['Operational', 'Restricted use', 'Out of service'], def: 'Operational' }),
      f('risk_level', 'Risk level', 'select', { options: ['Low', 'Medium', 'High'] }),
      f('authorised_only', 'Trained and signed-off operators only', 'bool', { def: 1 }),
      f('photo', 'Photo', 'file'),
      f('description', 'What it does', 'textarea'),
      f('hazards', 'Key hazards (one per line)', 'list'),
      f('ppe', 'PPE required', 'ppe'),
      f('sop', 'Standard operating procedure', 'markdown'),
      f('safe_work', 'Safe working procedure', 'markdown'),
      f('shutdown', 'Shutdown procedure', 'markdown'),
      f('emergency', 'Emergency stop and isolation', 'markdown'),
      f('maintenance', 'Cleaning and maintenance', 'markdown'),
      f('prestart_items', 'Pre-start checklist items (one per line)', 'list'),
      f('documents', 'Documents (manuals, risk assessments, SOP PDFs)', 'files'),
    ],
  },
  training_modules: {
    label: 'Training module', plural: 'Training modules', create: 'manager', update: 'manager', del: 'admin', order: 'title',
    fields: [
      f('title', 'Module title', 'text', { req: true }),
      f('machine_id', 'Machine (leave blank for general training)', 'machine'),
      f('summary', 'Short summary'),
      f('content', 'Training content', 'markdown'),
      f('quiz', 'Quiz questions', 'quiz'),
      f('pass_mark', 'Pass mark (%)', 'number', { def: 100 }),
      f('practical_items', 'Practical checks the supervisor must observe (one per line)', 'list'),
      f('refresher_months', 'Refresher due after (months, blank for never)', 'number'),
      f('version', 'Version (increase to make everyone retrain)', 'number', { def: 1 }),
      f('active', 'Active', 'bool', { def: 1 }),
    ],
  },
  hazards: {
    label: 'Hazard / near miss', plural: 'Hazards and near misses', create: 'staff', update: 'manager', del: 'admin',
    owner: 'reported_by', order: 'created_at DESC',
    fields: [
      f('type', 'Type', 'select', { options: ['Hazard', 'Near miss'], req: true, def: 'Hazard' }),
      f('title', 'What is it?', 'text', { req: true }),
      f('description', 'Describe what you saw or what happened', 'textarea', { req: true }),
      f('location', 'Where'),
      f('machine_id', 'Machine involved', 'machine'),
      f('occurred_at', 'When', 'datetime', { now: true }),
      f('likelihood', 'How likely is someone to get hurt?', 'select', { options: RISK_LIKELIHOOD }),
      f('consequence', 'How bad could it be?', 'select', { options: RISK_CONSEQUENCE }),
      f('immediate_action', 'What did you do about it straight away?', 'textarea'),
      f('photos', 'Photos', 'files'),
      f('status', 'Status', 'select', { options: ['Open', 'In progress', 'Closed'], def: 'Open', mgr: true }),
      f('manager_notes', 'Manager notes / outcome', 'textarea', { mgr: true }),
      f('reported_by', 'Reported by', 'user', { hide: true }),
      f('closed_at', 'Closed', 'datetime', { hide: true }),
    ],
  },
  incidents: {
    label: 'Incident', plural: 'Incident and injury register', create: 'staff', update: 'manager', del: 'admin',
    owner: 'reported_by', readScope: 'own', order: 'occurred_at DESC',
    fields: [
      f('title', 'Short description', 'text', { req: true }),
      f('occurred_at', 'When did it happen?', 'datetime', { req: true }),
      f('type', 'Type', 'select', { options: ['Injury', 'Illness', 'Property damage', 'Environmental', 'Dangerous incident', 'Other'], req: true }),
      f('description', 'What happened?', 'textarea', { req: true }),
      f('location', 'Where'),
      f('machine_id', 'Machine involved', 'machine'),
      f('person_involved', 'Person involved'),
      f('injury_details', 'Injury details (nature and body part)', 'textarea'),
      f('treatment', 'Treatment', 'select', { options: ['None', 'First aid on site', 'Doctor / medical centre', 'Hospital'] }),
      f('first_aider', 'First aid given by'),
      f('witnesses', 'Witnesses'),
      f('photos', 'Photos', 'files'),
      f('notifiable', 'Notifiable incident (SafeWork SA must be told immediately)', 'bool', { mgr: true }),
      f('regulator_notified_at', 'SafeWork SA notified at', 'datetime', { mgr: true }),
      f('regulator_ref', 'SafeWork SA reference', 'text', { mgr: true }),
      f('lost_time_days', 'Lost time (days)', 'number', { mgr: true }),
      f('investigation', 'Investigation findings', 'textarea', { mgr: true }),
      f('root_cause', 'Root cause', 'textarea', { mgr: true }),
      f('status', 'Status', 'select', { options: ['Open', 'Investigating', 'Closed'], def: 'Open', mgr: true }),
      f('reported_by', 'Reported by', 'user', { hide: true }),
    ],
  },
  actions: {
    label: 'Corrective action', plural: 'Corrective actions', create: 'manager', update: 'owner', del: 'admin',
    owner: 'assigned_to', order: "CASE status WHEN 'Done' THEN 1 ELSE 0 END, due_date",
    fields: [
      f('title', 'What needs to be done', 'text', { req: true, mgr: true }),
      f('details', 'Details', 'textarea', { mgr: true }),
      f('source_type', 'Raised from', 'select', { options: ['Hazard', 'Incident', 'Pre-start', 'Toolbox talk', 'Inspection', 'Other'], def: 'Other', mgr: true }),
      f('source_id', 'Source record', 'number', { hide: true, mgr: true }),
      f('control_type', 'Type of control', 'select', { options: ['Elimination', 'Substitution', 'Isolation', 'Engineering', 'Administrative', 'PPE'], mgr: true }),
      f('assigned_to', 'Assigned to', 'user', { req: true, mgr: true }),
      f('due_date', 'Due date', 'date', { req: true, mgr: true }),
      f('status', 'Status', 'select', { options: ['Open', 'In progress', 'Done'], def: 'Open' }),
      f('completion_notes', 'What was done', 'textarea'),
      f('completed_at', 'Completed', 'datetime', { hide: true }),
    ],
  },
  licences: {
    label: 'Licence / ticket', plural: 'Licences and tickets', create: 'staff', update: 'owner', del: 'manager',
    owner: 'user_id', readScope: 'own', order: 'expires',
    fields: [
      f('user_id', 'Person', 'user', { req: true, mgrPick: true }),
      f('type', 'Type', 'select', { options: ['Forklift (LF)', 'First aid', 'CPR', 'Fire warden', 'Health and safety rep', 'Driver licence', 'Test and tag competency', 'White card', 'Other'], req: true }),
      f('description', 'Description'),
      f('licence_no', 'Licence / certificate number'),
      f('issuer', 'Issued by'),
      f('issued', 'Issue date', 'date'),
      f('expires', 'Expiry date', 'date'),
      f('document', 'Copy of licence / certificate', 'file'),
      f('verified', 'Original sighted by a manager', 'bool', { mgr: true }),
    ],
  },
  testtag_items: {
    label: 'Item', plural: 'Test and tag / inspections', create: 'manager', update: 'manager', del: 'admin', order: 'next_due',
    fields: [
      f('name', 'Item', 'text', { req: true }),
      f('kind', 'Kind', 'select', { options: ['Electrical appliance', 'Extension lead / power board', 'RCD (safety switch)', 'Fire extinguisher', 'First aid kit', 'Emergency lighting', 'Ladder', 'Other'], def: 'Electrical appliance' }),
      f('asset_no', 'Tag / asset number'),
      f('location', 'Location'),
      f('machine_id', 'Machine it belongs to', 'machine'),
      f('environment', 'Test frequency', 'select', { options: Object.keys(TESTTAG_ENV), def: Object.keys(TESTTAG_ENV)[0] }),
      f('interval_months', 'Months between tests', 'number', { def: 6 }),
      f('last_tested', 'Last tested', 'date'),
      f('next_due', 'Next due', 'date'),
      f('last_result', 'Last result', 'select', { options: ['Pass', 'Fail'] }),
      f('tested_by', 'Tested by'),
      f('status', 'Status', 'select', { options: ['In service', 'Failed - removed from service', 'Disposed'], def: 'In service' }),
      f('notes', 'Notes', 'textarea'),
    ],
  },
  testtag_tests: {
    label: 'Test', plural: 'Tests', create: 'manager', update: 'admin', del: 'admin', order: 'tested_on DESC',
    fields: [
      f('item_id', 'Item', 'number', { hide: true, req: true }),
      f('tested_on', 'Date tested', 'date', { req: true }),
      f('result', 'Result', 'select', { options: ['Pass', 'Fail'], req: true, def: 'Pass' }),
      f('tested_by', 'Tested by (name and company)', 'text', { req: true }),
      f('notes', 'Notes', 'textarea'),
    ],
  },
  chemicals: {
    label: 'Chemical', plural: 'Chemical register and SDS', create: 'manager', update: 'manager', del: 'admin', order: 'name',
    fields: [
      f('name', 'Product name', 'text', { req: true }),
      f('manufacturer', 'Manufacturer / supplier'),
      f('used_for', 'Used for'),
      f('location', 'Where it is stored'),
      f('quantity', 'Typical quantity held'),
      f('hazardous', 'Hazardous chemical', 'bool'),
      f('hazard_class', 'Hazard classes / GHS pictograms'),
      f('dg_class', 'Dangerous goods class'),
      f('ppe', 'PPE required', 'ppe'),
      f('first_aid', 'First aid', 'textarea'),
      f('storage', 'Storage and handling', 'textarea'),
      f('sds', 'Safety data sheet (SDS)', 'file'),
      f('sds_date', 'SDS issue date', 'date'),
      f('notes', 'Notes', 'textarea'),
    ],
  },
  contacts: {
    label: 'Contact', plural: 'Emergency contacts', create: 'manager', update: 'manager', del: 'manager', order: 'sort, name',
    fields: [
      f('name', 'Name', 'text', { req: true }),
      f('role', 'Role', 'select', { options: ['Emergency service', 'First aider', 'Chief warden', 'Fire warden', 'Health and safety rep', 'Management', 'Utility / contractor', 'Other'], req: true }),
      f('phone', 'Phone'),
      f('notes', 'Notes'),
      f('sort', 'Sort order', 'number', { def: 50 }),
    ],
  },
  pages: {
    label: 'Page', plural: 'Handbook', create: 'manager', update: 'manager', del: 'admin', order: 'category, title',
    fields: [
      f('title', 'Title', 'text', { req: true }),
      f('category', 'Category', 'text', { def: 'General' }),
      f('slug', 'System name (leave alone)', 'text', { hide: true }),
      f('content', 'Content', 'markdown'),
      f('files', 'Attachments', 'files'),
    ],
  },
  toolbox_talks: {
    label: 'Toolbox talk', plural: 'Toolbox talks and safety meetings', create: 'manager', update: 'manager', del: 'admin', order: 'held_on DESC',
    fields: [
      f('title', 'Title', 'text', { req: true }),
      f('held_on', 'Date held', 'date', { req: true }),
      f('presenter_id', 'Presented by', 'user'),
      f('topics', 'Topics covered', 'markdown'),
      f('notes', 'Discussion, issues raised and outcomes', 'markdown'),
      f('files', 'Attachments', 'files'),
    ],
  },
  policies: {
    label: 'Policy', plural: 'Policies', create: 'manager', update: 'manager', del: 'admin', order: 'category, title',
    fields: [
      f('title', 'Title', 'text', { req: true }),
      f('category', 'Category', 'text', { def: 'Health and safety' }),
      f('content', 'Policy text', 'markdown'),
      f('document', 'Policy document', 'file'),
      f('version', 'Version (increase to make everyone re-acknowledge)', 'number', { def: 1 }),
      f('requires_ack', 'Staff must read and acknowledge', 'bool', { def: 1 }),
      f('review_date', 'Next review date', 'date'),
      f('active', 'Active', 'bool', { def: 1 }),
    ],
  },
  uniform_items: {
    label: 'Uniform item', plural: 'Uniform catalogue', create: 'manager', update: 'manager', del: 'admin', order: 'name',
    fields: [
      f('name', 'Item', 'text', { req: true }),
      f('description', 'Description'),
      f('sizes', 'Sizes (one per line)', 'list'),
      f('price', 'Cost each ($)', 'number'),
      f('photo', 'Photo', 'file'),
      f('active', 'Available to order', 'bool', { def: 1 }),
    ],
  },
  leave: {
    label: 'Leave request', plural: 'Leave', create: 'staff', update: 'owner', del: 'owner',
    owner: 'user_id', readScope: 'own', order: 'start_date DESC',
    fields: [
      f('user_id', 'Person', 'user', { req: true, mgrPick: true }),
      f('type', 'Type', 'select', { options: ['Annual leave', 'Personal / sick leave', 'Unpaid leave', 'Other'], req: true, def: 'Annual leave' }),
      f('start_date', 'First day off', 'date', { req: true }),
      f('end_date', 'Last day off', 'date', { req: true }),
      f('notes', 'Notes', 'textarea'),
      f('status', 'Status', 'select', { options: ['Pending', 'Approved', 'Declined'], def: 'Pending', mgr: true }),
      f('decided_by', 'Decided by', 'user', { hide: true }),
    ],
  },
  notices: {
    label: 'Notice', plural: 'Noticeboard', create: 'manager', update: 'manager', del: 'manager', order: 'pinned DESC, created_at DESC',
    fields: [
      f('title', 'Title', 'text', { req: true }),
      f('body', 'Message', 'markdown'),
      f('pinned', 'Pin to the top', 'bool'),
      f('expires', 'Take down after', 'date'),
    ],
  },
};

export const JSON_TYPES = ['list', 'ppe', 'file', 'files', 'quiz'];
