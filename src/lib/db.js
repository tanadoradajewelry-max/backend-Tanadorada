// src/lib/db.js
import mysql from "mysql2/promise";
import "dotenv/config";

export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  waitForConnections: true,
  connectionLimit: 3, // deja margen: los planes compartidos limitan conexiones por usuario
  queueLimit: 30, // si hay más de 50 esperando, falla rápido en vez de colgarse 55 s
  connectTimeout: 10000, // 10 s máximo para abrir una conexión
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  maxIdle: 2, // conexiones inactivas que se conservan
  idleTimeout: 60000, // cierra las inactivas después de 60 s
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  timezone: "Z",
  dateStrings: false,
  // Seguridad: si llega un objeto (por ejemplo ?category[a]=1) NO se expande
  // a SQL; se convierte en texto inofensivo.
  stringifyObjects: true,
});

export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// Solo avisa en el log si la base de datos no responde al arrancar.
// Ya no cierra la app (process.exit), para que se recupere sola.
export async function testConnection() {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    console.log("✅ Conectado a MySQL en Hostinger");
  } catch (err) {
    console.error("❌ Error conectando a MySQL:", err.message);
  }
}
