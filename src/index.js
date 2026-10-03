// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { pool, testConnection } from "./lib/db.js";
import { productsRouter } from "./routes/products.js";
import { ordersRouter } from "./routes/orders.js";
import { uploadRouter } from "./routes/upload.js";

const app = express();

// --- CORS ---
const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

console.log("🌐 Orígenes permitidos:", allowedOrigins);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const clean = origin.replace(/\/$/, "");
      if (allowedOrigins.includes(clean)) return callback(null, true);
      console.warn(`❌ CORS bloqueado para: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());

app.use(express.json());
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// --- HEALTH CHECK con diagnóstico completo ---
app.get("/api/health", async (req, res) => {
  const info = {
    status: "ok",
    env: {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      databaseUrlPrefix: process.env.DATABASE_URL?.slice(0, 30) + "...",
      port: process.env.PORT,
      frontendUrl: process.env.FRONTEND_URL,
      nodeEnv: process.env.NODE_ENV,
    },
    cors: allowedOrigins,
    db: null,
  };

  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query("SELECT 1 AS ok");
    conn.release();
    info.db = { connected: true, result: rows };
  } catch (err) {
    info.status = "degraded";
    info.db = {
      connected: false,
      error: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
    };
  }

  res.json(info);
});

app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/upload", uploadRouter);

app.use((err, req, res, next) => {
  console.error("Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 4000;

// ⚠️ NO mata el proceso si la BD falla — solo loguea.
// Así el servidor sigue vivo y /api/health puede mostrar el error real.
try {
  await testConnection();
} catch (err) {
  console.error("⚠️  Error de conexión a MySQL al arrancar:", err.message);
  console.error("   La API arrancará igual; revisa /api/health para más detalles.");
}

app.listen(PORT, () => {
  console.log(`✅ Tanadorada API corriendo en el puerto ${PORT}`);
});
