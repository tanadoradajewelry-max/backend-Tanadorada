// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pool } from "./lib/db.js";
import { productsRouter } from "./routes/products.js";
import { ordersRouter } from "./routes/orders.js";
import { uploadRouter } from "./routes/upload.js";
import { contentRouter } from "./routes/content.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import { collectionsRouter } from "./routes/collections.js";
import { adminLimiter, orderLimiter } from "./middleware/rateLimiters.js";

const app = express();

const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

// Headers de seguridad básicos (X-Content-Type-Options, X-Frame-Options,
// etc). crossOriginResourcePolicy en "cross-origin" porque servimos
// imágenes/datos para que el frontend (en otro dominio) los consuma.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const clean = origin.replace(/\/$/, "");
      if (allowedOrigins.includes(clean)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-password"],
  })
);

app.options("*", cors());

app.use(express.json({ limit: "15mb" }));

// Health check PÚBLICO: solo confirma que el servidor responde, sin
// revelar nada sensible.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Health check DETALLADO: mismo propósito que antes, pero ahora protegido
// con la contraseña de admin, para que solo tú puedas ver esos detalles.
app.get("/api/health/detailed", requireAdmin, async (req, res) => {
  const info = {
    status: "ok",
    env: {
      hasDatabaseUrl: !!process.env.DATABASE_URL,
      port: process.env.PORT,
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
    info.db = { connected: false, error: err.message, code: err.code };
  }
  res.json(info);
});

// Rate limit en todo lo que pida contraseña de admin (login, crear/editar/
// borrar productos, subir imágenes, editar contenido).
app.use("/api/products/:id?", (req, res, next) => {
  if (req.headers["x-admin-password"]) return adminLimiter(req, res, next);
  next();
});
app.use("/api/upload", adminLimiter);
app.use("/api/content/:key?", (req, res, next) => {
  if (req.method !== "GET") return adminLimiter(req, res, next);
  next();
});

app.use("/api/products", productsRouter);
app.use("/api/orders/", orderLimiter, (req, res, next) => {
  // El límite solo aplica a POST (crear orden) — GET de listado/detalle
  // de una orden se queda libre, no representan riesgo de abuso.
  if (req.method === "POST" && req.path === "/") return orderLimiter(req, res, next);
  next();
});
app.use("/api/orders", ordersRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/content", contentRouter);
app.use("/api/collections", collectionsRouter);

app.use((err, req, res, next) => {
  console.error("Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ API corriendo en puerto ${PORT}`);
});
