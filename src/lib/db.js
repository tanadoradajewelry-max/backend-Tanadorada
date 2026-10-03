// src/lib/db.js
import mysql from "mysql2/promise";
import "dotenv/config";

export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "Z",
  dateStrings: false,
  // Si Hostinger te pide SSL, descomenta:
  // ssl: { rejectUnauthorized: false },
});

export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// ⚠️ Ya NO llama a process.exit. Si falla, lanza el error
// y el que lo llame decide qué hacer.
export async function testConnection() {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  console.log("✅ Conectado a MySQL");
}
