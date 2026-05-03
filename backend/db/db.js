const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'gym_admin',
  password: process.env.DB_PASSWORD,
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

/**
 * Plain query — used for queries that DON'T need tenant scoping
 * (gyms table, super-admin views, login lookup before gym is known).
 * For tenant-scoped queries, use withGym().
 */
const query = (text, params) => pool.query(text, params);

const getClient = () => pool.connect();

/**
 * Run a callback with a Postgres client that has tenant context set.
 * All queries inside the callback are auto-filtered by gym_id via RLS.
 *
 *   await withGym(req.user.gym_id, async (db) => {
 *     const r = await db.query('SELECT * FROM members'); // only this gym's members
 *   });
 *
 * @param {number} gymId  the tenant id (must be a positive integer)
 * @param {function} fn   async callback that receives a `db` object with .query()
 */
async function withGym(gymId, fn) {
  if (!Number.isInteger(gymId) || gymId <= 0) {
    throw new Error(`withGym requires a positive integer gymId, got: ${gymId}`);
  }
  const client = await pool.connect();
  try {
    // SET LOCAL is scoped to the current transaction; wrap in BEGIN/COMMIT.
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'app.current_gym_id',
      String(gymId),
    ]);
    const db = {
      query: (text, params) => client.query(text, params),
      raw: client,
    };
    const result = await fn(db);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw err;
  } finally {
    client.release();
  }
}

const testConnection = async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('[DB] Connection verified at', res.rows[0].now);
    return true;
  } catch (err) {
    console.error('[DB] Connection failed:', err.message);
    if (process.env.NODE_ENV === 'production') {
      console.error('[DB] FATAL: Cannot connect to PostgreSQL in production');
      process.exit(1);
    }
    return false;
  }
};

module.exports = { query, getClient, withGym, testConnection, pool };
