// src/lib/db.js
import mysql from "mysql2/promise";
import "dotenv/config";

// Puedes usar DATABASE_URL (recomendado) o variables separadas
export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Opciones útiles con Hostinger
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  timezone: "Z",
  dateStrings: false,
});

// Helper para consultas simples
export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// Helper para obtener una sola fila
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// Verificación de conexión al arrancar (opcional pero útil)
export async function testConnection() {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log("✅ Conectado a MySQL en Hostinger");
  } catch (err) {
    console.error("❌ Error conectando a MySQL:", err.message);
    process.exit(1);
  }
}