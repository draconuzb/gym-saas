const { Pool } = require('pg');

let pool;
let useMemory = false;

try {
  pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'gym_admin',
    password: process.env.DB_PASSWORD || undefined,
    database: process.env.DB_NAME || 'gym_system',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('connect', () => {
    console.log('[DB] Connected to PostgreSQL');
  });

  pool.on('error', (err) => {
    console.error('[DB] Pool error:', err.message);
  });
} catch (err) {
  console.warn('[DB] Pool creation failed, using in-memory mode');
  useMemory = true;
}

// ─── In-Memory Fallback ───────────────────────────────────────
// Allows the bot to run without PostgreSQL for testing/development
const memDb = {
  members: {},       // keyed by id
  subscriptions: {}, // keyed by id
  checkins: [],
  payments: {},      // keyed by id
  plans: {
    1: { id: 1, name: 'Oddiy', emoji: '🥉', price: 200000, days: 12, description: 'Zal kirish', is_active: true, sort_order: 1, created_at: new Date() },
    2: { id: 2, name: 'Premium', emoji: '🥈', price: 350000, days: 12, description: 'Zal + trener', is_active: true, sort_order: 2, created_at: new Date() },
    3: { id: 3, name: 'VIP', emoji: '🥇', price: 550000, days: 12, description: 'Zal + trener + jadval', is_active: true, sort_order: 3, created_at: new Date() },
  },
  settings: {
    gym_name: 'GymSystem',
    support_username: '@gym_support_uz',
    support_phone: '+998 90 000 00 00',
  },
  bot_admins: {},
  trainers: {},
  classes: {},
  class_enrollments: {},
  entry_codes: [],
  daily_visits: [],
  users: {
    1: { id: 1, phone: '+998901234567', password_hash: '$2b$10$J6tKe/bHK7qIRLfIMNF79.Rqyd1NlQx6PHdL/4EAIpMG6gWqRRd1a', role: 'admin', first_name: 'Admin', last_name: null, created_at: new Date() },
  },
  _nextId: { members: 1, subscriptions: 1, checkins: 1, payments: 1, trainers: 1, classes: 1, class_enrollments: 1, entry_codes: 1, daily_visits: 1, users: 2, plans: 4 },
};

function nextId(table) {
  return memDb._nextId[table]++;
}

// Simple SQL-to-memory query mapper for common patterns
function memQuery(text, params) {
  const sql = text.trim().replace(/\s+/g, ' ');

  // ── Settings ──
  if (sql.match(/SELECT value FROM settings WHERE key = \$1/i)) {
    const val = memDb.settings[params[0]];
    return { rows: val !== undefined ? [{ value: val }] : [], rowCount: val !== undefined ? 1 : 0 };
  }
  if (sql.match(/INSERT INTO settings.*ON CONFLICT/i)) {
    memDb.settings[params[0]] = params[1];
    return { rows: [], rowCount: 1 };
  }

  // ── Plans ──
  if (sql.match(/SELECT \* FROM plans WHERE is_active.*ORDER BY sort_order/i) || sql.match(/SELECT \* FROM plans.*ORDER BY sort_order/i)) {
    const rows = Object.values(memDb.plans).filter(p => p.is_active).sort((a, b) => a.sort_order - b.sort_order);
    return { rows, rowCount: rows.length };
  }
  if (sql.match(/SELECT .* FROM plans WHERE id = \$1/i)) {
    const p = memDb.plans[params[0]];
    return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
  }
  if (sql.match(/INSERT INTO plans/i)) {
    const id = nextId('plans');
    const maxSort = Math.max(0, ...Object.values(memDb.plans).map(p => p.sort_order));
    const plan = { id, name: params[0], emoji: params[1] || '', price: params[2] || 0, days: params[3] || 12, description: params[4] || '', is_active: true, sort_order: maxSort + 1, created_at: new Date() };
    memDb.plans[id] = plan;
    return { rows: [plan], rowCount: 1 };
  }
  if (sql.match(/UPDATE plans SET.*WHERE id/i)) {
    const p = memDb.plans[params[params.length - 1]]; // id is always last param
    if (p) {
      if (sql.match(/name\s*=/)) p.name = params[0];
      if (sql.match(/emoji\s*=/)) p.emoji = params[1] !== undefined ? params[1] : p.emoji;
      if (sql.match(/price\s*=/)) p.price = params[2] !== undefined ? params[2] : p.price;
      if (sql.match(/days\s*=/)) p.days = params[3] !== undefined ? params[3] : p.days;
      if (sql.match(/description\s*=/)) p.description = params[4] !== undefined ? params[4] : p.description;
      if (sql.match(/is_active\s*=\s*false/)) p.is_active = false;
      if (sql.match(/is_active\s*=\s*\$/)) {
        // Dynamic param
        for (let i = 0; i < params.length - 1; i++) {
          if (typeof params[i] === 'boolean') p.is_active = params[i];
        }
      }
    }
    return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
  }
  if (sql.match(/DELETE FROM plans WHERE id = \$1/i)) {
    const existed = !!memDb.plans[params[0]];
    delete memDb.plans[params[0]];
    return { rows: [], rowCount: existed ? 1 : 0 };
  }
  if (sql.match(/SELECT COUNT\(\*\).*FROM plans/i)) {
    const count = Object.values(memDb.plans).filter(p => p.is_active).length;
    return { rows: [{ count: String(count) }], rowCount: 1 };
  }

  // ── Users (staff login) ──
  if (sql.match(/SELECT .* FROM users WHERE phone = \$1/i)) {
    const u = Object.values(memDb.users).find(u => u.phone === params[0]);
    return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
  }
  if (sql.match(/SELECT .* FROM users WHERE id = \$1/i)) {
    const u = memDb.users[params[0]];
    return { rows: u ? [u] : [], rowCount: u ? 1 : 0 };
  }
  if (sql.match(/UPDATE users SET password_hash = \$1 WHERE id = \$2/i)) {
    const u = memDb.users[params[1]];
    if (u) u.password_hash = params[0];
    return { rows: [], rowCount: u ? 1 : 0 };
  }

  // ── Bot admins ──
  if (sql.match(/SELECT telegram_id FROM bot_admins WHERE telegram_id = \$1/i)) {
    const found = memDb.bot_admins[params[0]];
    return { rows: found ? [{ telegram_id: params[0] }] : [], rowCount: found ? 1 : 0 };
  }
  if (sql.match(/SELECT telegram_id FROM bot_admins/i)) {
    return { rows: Object.keys(memDb.bot_admins).map(id => ({ telegram_id: parseInt(id) })), rowCount: Object.keys(memDb.bot_admins).length };
  }

  // ── Members ──
  if (sql.match(/SELECT \* FROM members WHERE telegram_id = \$1/i)) {
    const m = Object.values(memDb.members).find(m => m.telegram_id == params[0]);
    return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
  }
  if (sql.match(/SELECT \* FROM members WHERE id = \$1/i)) {
    const m = memDb.members[params[0]];
    return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
  }
  if (sql.match(/INSERT INTO members/i)) {
    const id = nextId('members');
    const member = {
      id, telegram_id: params[0], first_name: params[1], phone: params[2],
      plan_id: null, plan: 'none', last_name: null, is_active: true, created_at: new Date(),
    };
    memDb.members[id] = member;
    return { rows: [member], rowCount: 1 };
  }
  if (sql.match(/UPDATE members SET first_name.*is_active.*WHERE id/i)) {
    const m = memDb.members[params[4]]; // id is $5
    if (m) { m.first_name = params[0]; m.last_name = params[1]; m.phone = params[2]; m.is_active = params[3]; }
    return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
  }
  if (sql.match(/UPDATE members SET first_name.*WHERE id/i) && !sql.match(/is_active/i)) {
    const m = memDb.members[params[3]]; // id is $4
    if (m) { m.first_name = params[0]; m.last_name = params[1]; m.phone = params[2]; }
    return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
  }
  if (sql.match(/UPDATE members SET plan_id = \$1 WHERE id = \$2/i)) {
    if (memDb.members[params[1]]) {
      memDb.members[params[1]].plan_id = params[0];
      const plan = memDb.plans[params[0]];
      if (plan) memDb.members[params[1]].plan = plan.name;
    }
    return { rows: [], rowCount: 1 };
  }
  if (sql.match(/UPDATE members SET is_active = \$1 WHERE id = \$2/i)) {
    if (memDb.members[params[1]]) memDb.members[params[1]].is_active = params[0];
    return { rows: [memDb.members[params[1]]].filter(Boolean), rowCount: 1 };
  }
  if (sql.match(/SELECT .* FROM members WHERE id = \$1/i) && !sql.match(/JOIN/i)) {
    const m = memDb.members[params[0]];
    return { rows: m ? [m] : [], rowCount: m ? 1 : 0 };
  }
  if (sql.match(/SELECT COUNT\(\*\) AS n FROM members/i)) {
    return { rows: [{ n: String(Object.keys(memDb.members).length) }], rowCount: 1 };
  }
  // Members list with subscriptions (admin member management)
  if (sql.match(/SELECT m\.id.*FROM members m/i) && sql.match(/LEFT JOIN LATERAL/i)) {
    const rows = Object.values(memDb.members).map(m => {
      const subs = Object.values(memDb.subscriptions).filter(s => s.member_id === m.id && s.status === 'active');
      const activeSub = subs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      return {
        ...m,
        total_days: activeSub ? activeSub.total_days : null,
        days_used: activeSub ? activeSub.days_used : null,
        sub_status: activeSub ? activeSub.status : null,
      };
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20);
    return { rows, rowCount: rows.length };
  }

  // ── Subscriptions ──
  // SELECT id, total_days, days_used (for remove-days — no days_used filter)
  if (sql.match(/SELECT id, total_days, days_used FROM subscriptions WHERE member_id = \$1 AND status = 'active'/i) && !sql.match(/total_days - days_used/i)) {
    const subs = Object.values(memDb.subscriptions)
      .filter(s => s.member_id == params[0] && s.status === 'active')
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows: subs.length > 0 ? [subs[0]] : [], rowCount: subs.length > 0 ? 1 : 0 };
  }
  // SELECT id (for add-days — with days_used filter)
  if (sql.match(/SELECT id FROM subscriptions WHERE member_id = \$1 AND status = 'active' AND \(total_days - days_used\) > 0/i)) {
    const subs = Object.values(memDb.subscriptions)
      .filter(s => s.member_id == params[0] && s.status === 'active' && (s.total_days - s.days_used) > 0)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows: subs.length > 0 ? [subs[0]] : [], rowCount: subs.length > 0 ? 1 : 0 };
  }
  if (sql.match(/SELECT \* FROM subscriptions WHERE.*member_id = \$1.*status = 'active'/i) ||
      sql.match(/SELECT \* FROM subscriptions WHERE member_id = \$1/i)) {
    const subs = Object.values(memDb.subscriptions)
      .filter(s => s.member_id == params[0] && s.status === 'active' && (s.total_days - s.days_used) > 0)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows: subs.length > 0 ? [subs[0]] : [], rowCount: subs.length > 0 ? 1 : 0 };
  }
  if (sql.match(/SELECT \* FROM subscriptions WHERE id = \$1/i)) {
    const s = memDb.subscriptions[params[0]];
    return { rows: s ? [s] : [], rowCount: s ? 1 : 0 };
  }
  if (sql.match(/SELECT.*FROM subscriptions WHERE id = \$1/i)) {
    const s = memDb.subscriptions[params[0]];
    return { rows: s ? [s] : [], rowCount: s ? 1 : 0 };
  }
  if (sql.match(/INSERT INTO subscriptions/i)) {
    const id = nextId('subscriptions');
    const sub = {
      id, member_id: params[0], days_used: 0,
      created_at: new Date(), activated_at: null, approved_by: null,
    };
    // Manual add-days format: (member_id, total_days) with hardcoded plan_name='Manual', price=0, status='active'
    if (sql.match(/plan_name.*'Manual'/i) && params.length === 2) {
      sub.plan = 'Manual'; sub.plan_name = 'Manual';
      sub.total_days = params[1]; sub.price = 0;
      sub.status = 'active'; sub.activated_at = new Date();
    }
    // New format: (member_id, plan_id, plan_name, total_days, price, status)
    else if (sql.match(/plan_id.*plan_name/i)) {
      sub.plan_id = params[1]; sub.plan_name = params[2]; sub.plan = params[2];
      sub.total_days = params[3]; sub.price = params[4];
      sub.status = params[5] || 'pending';
    }
    // Old format: (member_id, plan, total_days, days_used, price, status, activated_at)
    else if (params.length >= 6 && sql.match(/days_used/i)) {
      sub.plan = params[1]; sub.plan_name = params[1];
      sub.total_days = params[2]; sub.days_used = params[3];
      sub.price = params[4]; sub.status = params[5] || 'active';
      if (sub.status === 'active') sub.activated_at = new Date();
    }
    // Fallback
    else {
      sub.plan = params[1]; sub.plan_name = params[1];
      sub.total_days = params[2]; sub.price = params[3];
      sub.status = params[4] || 'pending';
    }
    memDb.subscriptions[id] = sub;
    return { rows: [{ id }], rowCount: 1 };
  }
  if (sql.match(/UPDATE subscriptions SET status = 'active'/i)) {
    const s = memDb.subscriptions[params[0]];
    if (s) { s.status = 'active'; s.activated_at = new Date(); }
    return { rows: [], rowCount: s ? 1 : 0 };
  }
  if (sql.match(/UPDATE subscriptions SET status = 'cancelled' WHERE member_id/i)) {
    let count = 0;
    Object.values(memDb.subscriptions).forEach(s => {
      if (s.member_id == params[0] && (s.status === 'active' || s.status === 'pending')) {
        s.status = 'cancelled';
        count++;
      }
    });
    return { rows: [], rowCount: count };
  }
  if (sql.match(/UPDATE subscriptions SET status = 'cancelled'/i)) {
    const s = memDb.subscriptions[params[0]];
    if (s) s.status = 'cancelled';
    return { rows: [], rowCount: s ? 1 : 0 };
  }
  if (sql.match(/UPDATE subscriptions SET days_used = days_used \+ \$1/i)) {
    const s = memDb.subscriptions[params[1]];
    if (s) s.days_used += params[0];
    return { rows: [], rowCount: s ? 1 : 0 };
  }
  if (sql.match(/UPDATE subscriptions SET total_days = total_days \+ \$1/i)) {
    const s = memDb.subscriptions[params[1]];
    if (s) s.total_days += params[0];
    return { rows: [], rowCount: s ? 1 : 0 };
  }
  if (sql.match(/UPDATE subscriptions SET total_days = total_days - \$1/i)) {
    const s = memDb.subscriptions[params[1]];
    if (s) s.total_days = Math.max(s.days_used, s.total_days - params[0]);
    return { rows: [], rowCount: s ? 1 : 0 };
  }
  if (sql.match(/SELECT COUNT\(\*\) AS n FROM subscriptions WHERE status = 'active'/i)) {
    const count = Object.values(memDb.subscriptions).filter(s => s.status === 'active' && (s.total_days - s.days_used) > 0).length;
    return { rows: [{ n: String(count) }], rowCount: 1 };
  }
  if (sql.match(/UPDATE subscriptions SET status = 'expired'/i)) {
    let count = 0;
    Object.values(memDb.subscriptions).forEach(s => {
      if (s.status === 'active' && (s.total_days - s.days_used) <= 0) { s.status = 'expired'; count++; }
    });
    return { rows: [], rowCount: count };
  }

  // ── Checkins ──
  if (sql.match(/SELECT checked_in_at FROM checkins WHERE member_id = \$1/i)) {
    const rows = memDb.checkins.filter(c => c.member_id == params[0])
      .sort((a, b) => new Date(b.checked_in_at) - new Date(a.checked_in_at)).slice(0, 10);
    return { rows, rowCount: rows.length };
  }
  if (sql.match(/SELECT COUNT\(\*\) AS n FROM checkins WHERE member_id/i)) {
    const count = memDb.checkins.filter(c => c.member_id == params[0]).length;
    return { rows: [{ n: String(count) }], rowCount: 1 };
  }
  if (sql.match(/SELECT COUNT\(\*\) AS n FROM checkins/i)) {
    return { rows: [{ n: String(memDb.checkins.length) }], rowCount: 1 };
  }
  if (sql.match(/SELECT id FROM checkins WHERE member_id = \$1.*CURRENT_DATE/i)) {
    const today = new Date().toDateString();
    const found = memDb.checkins.find(c => c.member_id == params[0] && new Date(c.checked_in_at).toDateString() === today);
    return { rows: found ? [{ id: found.id }] : [], rowCount: found ? 1 : 0 };
  }
  if (sql.match(/INSERT INTO checkins/i)) {
    const id = nextId('checkins');
    memDb.checkins.push({ id, member_id: params[0], subscription_id: params[1], checked_in_at: new Date(), approved_by_staff: true });
    return { rows: [{ id }], rowCount: 1 };
  }

  // ── Payments ──
  if (sql.match(/INSERT INTO payments/i)) {
    const id = nextId('payments');
    const payment = { id, member_id: params[0], subscription_id: params[1], amount: params[2], gateway: 'cash', status: 'pending', receipt_url: null, created_at: new Date() };
    // Check if receipt_url is in the insert
    if (sql.match(/receipt_url/i) && params.length > 3) {
      payment.gateway = params[3] || 'cash';
      payment.status = params[4] || 'pending';
      payment.receipt_url = params[5] || null;
    }
    memDb.payments[id] = payment;
    return { rows: [{ id, amount: payment.amount, gateway: payment.gateway, status: payment.status, created_at: payment.created_at }], rowCount: 1 };
  }
  // Pending payments with JOINs (for approval dashboard)
  if (sql.match(/FROM payments p.*JOIN members m.*JOIN subscriptions s.*WHERE p\.status = 'pending'/i)) {
    const rows = Object.values(memDb.payments)
      .filter(p => p.status === 'pending')
      .map(p => {
        const m = memDb.members[p.member_id] || {};
        const s = memDb.subscriptions[p.subscription_id] || {};
        return {
          id: p.id, amount: p.amount, gateway: p.gateway, status: p.status, receipt_url: p.receipt_url, created_at: p.created_at,
          subscription_id: p.subscription_id,
          member_id: m.id, first_name: m.first_name, last_name: m.last_name, phone: m.phone, telegram_id: m.telegram_id,
          plan_name: s.plan_name, total_days: s.total_days,
        };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return { rows, rowCount: rows.length };
  }
  // Select single payment by id
  if (sql.match(/SELECT \* FROM payments WHERE id = \$1/i)) {
    const p = memDb.payments[params[0]];
    return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
  }
  // Update payment status to completed by payment id
  if (sql.match(/UPDATE payments SET status = 'completed'.*WHERE id = \$1/i)) {
    const p = memDb.payments[params[0]];
    if (p) { p.status = 'completed'; p.processed_at = new Date(); }
    return { rows: [], rowCount: p ? 1 : 0 };
  }
  // Update payment status to failed by payment id
  if (sql.match(/UPDATE payments SET status = 'failed'.*WHERE id = \$1/i)) {
    const p = memDb.payments[params[0]];
    if (p) { p.status = 'failed'; p.processed_at = new Date(); }
    return { rows: [], rowCount: p ? 1 : 0 };
  }
  // Legacy: update payments by subscription_id
  if (sql.match(/UPDATE payments SET status = 'completed'/i)) {
    Object.values(memDb.payments).forEach(p => {
      if (p.subscription_id == params[0] && p.status === 'pending') { p.status = 'completed'; p.processed_at = new Date(); }
    });
    return { rows: [], rowCount: 1 };
  }
  if (sql.match(/UPDATE payments SET status = 'failed'/i)) {
    Object.values(memDb.payments).forEach(p => {
      if (p.subscription_id == params[0]) { p.status = 'failed'; p.processed_at = new Date(); }
    });
    return { rows: [], rowCount: 1 };
  }

  // ── Entry Codes ──
  if (sql.match(/SELECT.*FROM entry_codes.*WHERE.*code = \$1 AND.*valid_date = CURRENT_DATE/i)) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = memDb.entry_codes.filter(e => e.code === params[0] && e.valid_date === today);
    return { rows, rowCount: rows.length };
  }
  if (sql.match(/SELECT code FROM entry_codes WHERE member_id = \$1 AND valid_date = CURRENT_DATE AND used = false/i)) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = memDb.entry_codes.filter(e => e.member_id == params[0] && e.valid_date === today && !e.used);
    return { rows, rowCount: rows.length };
  }
  if (sql.match(/INSERT INTO entry_codes/i)) {
    const id = nextId('entry_codes');
    const today = new Date().toISOString().slice(0, 10);
    // Check unique constraint: (code, valid_date) only — matches PostgreSQL schema
    const dupCode = memDb.entry_codes.find(e => e.code === params[1] && e.valid_date === today);
    if (dupCode) {
      throw new Error('duplicate key value violates unique constraint');
    }
    const entry = { id, member_id: params[0], code: params[1], valid_date: today, used: false, created_at: new Date() };
    memDb.entry_codes.push(entry);
    return { rows: [entry], rowCount: 1 };
  }
  if (sql.match(/UPDATE entry_codes SET used = true WHERE member_id = \$1 AND valid_date = CURRENT_DATE/i)) {
    const today = new Date().toISOString().slice(0, 10);
    let count = 0;
    memDb.entry_codes.forEach(e => {
      if (e.member_id == params[0] && e.valid_date === today && !e.used) { e.used = true; count++; }
    });
    return { rows: [], rowCount: count };
  }

  // ── Daily Visits ──
  if (sql.match(/SELECT \* FROM daily_visits WHERE visited_at::date = CURRENT_DATE/i)) {
    const today = new Date().toDateString();
    const rows = memDb.daily_visits.filter(v => new Date(v.visited_at).toDateString() === today);
    return { rows, rowCount: rows.length };
  }
  if (sql.match(/SELECT COUNT\(\*\) AS count.*FROM daily_visits.*CURRENT_DATE/i) || sql.match(/SELECT COUNT\(\*\) AS n FROM daily_visits WHERE visited_at::date = CURRENT_DATE/i)) {
    const today = new Date().toDateString();
    const filtered = memDb.daily_visits.filter(v => new Date(v.visited_at).toDateString() === today);
    const count = filtered.length;
    const total = filtered.reduce((sum, v) => sum + (v.amount || 0), 0);
    return { rows: [{ count: String(count), n: String(count), total: String(total) }], rowCount: 1 };
  }
  if (sql.match(/SELECT COALESCE\(SUM\(amount\), 0\) AS n FROM daily_visits/i)) {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const total = memDb.daily_visits.filter(v => new Date(v.visited_at) >= monthStart).reduce((sum, v) => sum + (v.amount || 0), 0);
    return { rows: [{ n: String(total) }], rowCount: 1 };
  }
  if (sql.match(/SELECT COUNT\(\*\) AS n FROM daily_visits/i)) {
    const today = new Date().toDateString();
    const count = memDb.daily_visits.filter(v => new Date(v.visited_at).toDateString() === today).length;
    return { rows: [{ n: String(count) }], rowCount: 1 };
  }
  if (sql.match(/INSERT INTO daily_visits/i)) {
    const id = nextId('daily_visits');
    const visit = { id, visitor_name: params[0] || null, phone: params[1] || null, amount: params[2] || 0, payment_method: params[3] || 'cash', notes: params[4] || '', visited_at: new Date(), registered_by: params[5] || null };
    memDb.daily_visits.push(visit);
    return { rows: [visit], rowCount: 1 };
  }
  if (sql.match(/DELETE FROM daily_visits WHERE id = \$1/i)) {
    const idx = memDb.daily_visits.findIndex(v => v.id == params[0]);
    if (idx >= 0) { memDb.daily_visits.splice(idx, 1); return { rows: [], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  }

  // ── SELECT NOW (health check) ──
  if (sql.match(/SELECT NOW\(\)/i)) {
    return { rows: [{ now: new Date() }], rowCount: 1 };
  }

  // ── Generic COUNT(*) for any table ──
  const countMatch = sql.match(/SELECT COUNT\(\*\) AS count FROM (\w+)/i);
  if (countMatch) {
    const table = countMatch[1];
    const data = memDb[table];
    if (data) {
      const count = Array.isArray(data) ? data.length : Object.values(data).length;
      return { rows: [{ count: String(count) }], rowCount: 1 };
    }
    return { rows: [{ count: '0' }], rowCount: 1 };
  }

  // ── Generic SELECT * FROM <table> (for backup export) ──
  const selectAllMatch = sql.match(/^SELECT \* FROM (\w+)$/i);
  if (selectAllMatch) {
    const table = selectAllMatch[1];
    const data = memDb[table];
    if (data) {
      const rows = Array.isArray(data) ? data : Object.values(data);
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  }

  // ── Generic DELETE FROM <table> (for reset) ──
  const deleteMatch = sql.match(/^DELETE FROM (\w+)$/i);
  if (deleteMatch) {
    const table = deleteMatch[1];
    const data = memDb[table];
    if (data) {
      const count = Array.isArray(data) ? data.length : Object.keys(data).length;
      if (Array.isArray(data)) { memDb[table] = []; } else { Object.keys(data).forEach(k => delete data[k]); }
      return { rows: [], rowCount: count };
    }
    return { rows: [], rowCount: 0 };
  }

  // ── Default: return empty ──
  console.warn('[MemDB] Unhandled query:', sql.substring(0, 80), '| params:', params);
  return { rows: [], rowCount: 0 };
}

/**
 * Execute a parameterized SQL query (PostgreSQL or in-memory fallback)
 */
const query = async (text, params) => {
  if (useMemory) return memQuery(text, params);
  return pool.query(text, params);
};

const getClient = () => {
  if (useMemory) {
    const memClient = {
      query: (text, params) => {
        const cmd = text.trim().toUpperCase();
        if (cmd === 'BEGIN' || cmd === 'COMMIT' || cmd === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        return memQuery(text, params);
      },
      release: () => {},
    };
    return memClient;
  }
  return pool.connect();
};

const testConnection = async () => {
  if (useMemory) {
    console.log('[DB] Running in-memory mode (no PostgreSQL)');
    return true;
  }
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('[DB] Connection verified at', res.rows[0].now);
    return true;
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    if (process.env.NODE_ENV === 'production') {
      console.error('[DB] FATAL: Cannot connect to PostgreSQL in production mode');
      process.exit(1);
    }
    console.log('[DB] Falling back to in-memory mode');
    useMemory = true;
    return false;
  }
};

module.exports = { query, getClient, testConnection, pool };
