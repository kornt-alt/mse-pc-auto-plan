const env = require('../config/env');

// DB_AUTH=windows → msnodesqlv8 (Trusted Connection ผ่าน ODBC)
// DB_AUTH=sql     → tedious (SQL Login ด้วย DB_USER/DB_PASSWORD)
const useWindowsAuth = env.DB_AUTH === 'windows';
const sql = useWindowsAuth ? require('mssql/msnodesqlv8') : require('mssql');

const config = useWindowsAuth
  ? {
      connectionString:
        `Driver={${env.DB_ODBC_DRIVER}};` +
        `Server=${env.DB_SERVER};` +
        `Database=${env.DB_NAME};` +
        'Trusted_Connection=yes;' +
        'TrustServerCertificate=yes;',
      pool: { max: env.DB_POOL_MAX, min: 0, idleTimeoutMillis: 30000 },
    }
  : {
      server: env.DB_SERVER.split('\\')[0],
      database: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      pool: { max: env.DB_POOL_MAX, min: 0, idleTimeoutMillis: 30000 },
      options: {
        trustServerCertificate: true,
        instanceName: env.DB_SERVER.includes('\\') ? env.DB_SERVER.split('\\')[1] : undefined,
      },
    };

let poolPromise = null;

const getPool = () => {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        console.log(`Connected to SQL Server (${env.DB_SERVER}/${env.DB_NAME}, auth=${env.DB_AUTH})`);
        return pool;
      })
      .catch((err) => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
};

// query('SELECT * FROM orders WHERE batch = @batch', { batch: 'B001' }) → recordset (array)
const query = async (text, params = {}) => {
  const pool = await getPool();
  const request = pool.request();
  for (const [name, value] of Object.entries(params)) {
    request.input(name, value);
  }
  const result = await request.query(text);
  return result.recordset || [];
};

// execute — เหมือน query แต่คืน rowsAffected สำหรับ INSERT/UPDATE/DELETE
const execute = async (text, params = {}) => {
  const pool = await getPool();
  const request = pool.request();
  for (const [name, value] of Object.entries(params)) {
    request.input(name, value);
  }
  const result = await request.query(text);
  return result.rowsAffected[0] || 0;
};

// transaction(async (t) => { await t.query(...); }) — commit อัตโนมัติ, rollback เมื่อ throw
const transaction = async (fn) => {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  const helpers = {
    query: async (text, params = {}) => {
      const request = new sql.Request(tx);
      for (const [name, value] of Object.entries(params)) {
        request.input(name, value);
      }
      const result = await request.query(text);
      return result.recordset || [];
    },
  };
  try {
    const out = await fn(helpers);
    await tx.commit();
    return out;
  } catch (err) {
    await tx.rollback();
    throw err;
  }
};

module.exports = { sql, getPool, query, execute, transaction };
