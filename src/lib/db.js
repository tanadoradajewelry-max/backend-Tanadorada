// src/lib/db.js
import mysql from "mysql2/promise";
import "dotenv/config";

const SLOW_QUERY_MS = 1000;

export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  timezone: "Z",
  dateStrings: false,
  // Seguridad: si llega un objeto (por ejemplo ?category[a]=1) NO se expande
  // a SQL; se convierte en texto inofensivo.
  stringifyObjects: true,
});

// --- Eventos del pool (para ver si se atasca) ---
let totalConnections = 0;
pool.pool.on("connection", () => {
  totalConnections += 1;
  console.log(`[DB] conexión nueva abierta (total abiertas: ${totalConnections})`);
});
pool.pool.on("enqueue", () => {
  console.warn("[DB] ⚠️ consulta en COLA: no hay conexiones libres");
});

// Estado actual del pool (usa campos internos de mysql2, por eso el "?.").
export function poolStats() {
  const core = pool.pool;
  return {
    abiertas: core?._allConnections?.length ?? null,
    libres: core?._freeConnections?.length ?? null,
    enCola: core?._connectionQueue?.length ?? null,
  };
}

// Cada consulta tiene 10 s máximo y queda registrada si es lenta o falla.
export async function query(sql, params = []) {
  const start = Date.now();
  const short = String(sql).replace(/\s+/g, " ").slice(0, 90);

  try {
    const [rows] = await pool.query({ sql, values: params, timeout: 10000 });
    const ms = Date.now() - start;
    if (ms >= SLOW_QUERY_MS) {
      console.warn(`[DB] 🐢 consulta lenta ${ms} ms: ${short}`, poolStats());
    }
    return rows;
  } catch (err) {
    console.error(
      `[DB] ❌ falló tras ${Date.now() - start} ms: ${short} | code=${err.code} | ${err.message}`,
      poolStats()
    );
    throw err;
  }
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

export async function testConnection() {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log("✅ Conectado a MySQL en Hostinger");
  } catch (err) {
    console.error("❌ Error conectando a MySQL:", err.code, err.message);
  }
}
