// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pool } from "./lib/db.js";
import { productsRouter } from "./routes/products.js";
import { ordersRouter } from "./routes/orders.js";
import { uploadRouter, imagesRouter } from "./routes/upload.js";
import { contentRouter } from "./routes/content.js";
import { collectionsRouter } from "./routes/collections.js";
import { charmBarRouter } from "./routes/charmbar.js";
import { giftCertificatesRouter } from "./routes/giftcertificates.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import {
  adminLimiter,
  orderLimiter,
  charmBarLimiter,
  giftCertificateLimiter,
  searchLimiter,
} from "./middleware/rateLimiters.js";
import { adminRouter } from "./routes/admin.js";

const app = express();

// Hostinger pone un proxy delante de tu app.
app.set("trust proxy", 1);

const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

console.log("✅ Orígenes permitidos (CORS):", allowedOrigins);

// 1. HELMET (Seguridad)
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// 2. CORS (Permisos)
app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir peticiones sin origen (Postman, health checks)
      if (!origin) return callback(null, true);
      
      const clean = origin.replace(/\/$/, "");
      if (allowedOrigins.includes(clean)) {
        return callback(null, true);
      }
      
      console.error(`🚨 CORS bloqueado para el origen: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-password"],
  })
);

// 🚨 3. RESPONDER A OPTIONS INMEDIATAMENTE (Esto arregla el error 504)
// Cualquier petición de verificación (Preflight) se responde aquí mismo sin pasar a los limitadores.
app.options("*", cors());

// 4. PARSEADOR DE JSON
app.use(express.json({ limit: "15mb" }));

// Límite para consultar/confirmar pedidos desde la página pública.
const orderLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos." },
});

// --- RUTAS BÁSICAS ---
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/admin/verify", adminLimiter, requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.use("/api/admin", adminLimiter, requireAdmin, adminRouter);

app.get("/api/health/detailed", adminLimiter, requireAdmin, async (req, res) => {
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
    info.db = { connected: false, code: err.code };
  }
  res.json(info);
});

app.get("/api/my-ip", (req, res) => res.json({ ip: req.ip }));

// --- LÍMITES DE INTENTOS ---
const isGet = (req) => req.method === "GET";

app.use("/api/upload", adminLimiter);
app.use("/api/content", (req, res, next) =>
  isGet(req) ? next() : adminLimiter(req, res, next)
);
app.use("/api/collections", (req, res, next) =>
  isGet(req) ? next() : adminLimiter(req, res, next)
);
app.use("/api/products", (req, res, next) =>
  req.headers["x-admin-password"] ? adminLimiter(req, res, next) : next()
);

// --- RUTAS DE PEDIDOS ---
app.get("/api/orders", adminLimiter);
app.post("/api/orders", orderLimiter);
app.put("/api/orders/:id/status", adminLimiter);
app.post("/api/orders/:id/capture", orderLookupLimiter);
app.get("/api/orders/:id", orderLookupLimiter);

// --- RUTAS DE CHARM BAR ---
app.post("/api/charm-bar", charmBarLimiter);
app.get("/api/charm-bar", adminLimiter);
app.put("/api/charm-bar/:id/status", adminLimiter);

// --- RUTAS DE CERTIFICADOS DE REGALO ---
app.post("/api/gift-certificates", giftCertificateLimiter);
app.get("/api/gift-certificates", adminLimiter);
app.put("/api/gift-certificates/:id/status", adminLimiter);

// --- RUTA DE BÚSQUEDA ---
app.get("/api/products/search", searchLimiter);

// --- ENRUTADORES (ROUTERS) ---
app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/images", imagesRouter);
app.use("/api/content", contentRouter);
app.use("/api/collections", collectionsRouter);
app.use("/api/charm-bar", charmBarRouter);
app.use("/api/gift-certificates", giftCertificatesRouter);

// --- MANEJO DE ERRORES GLOBAL ---
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "La imagen pesa más de 2 MB" });
  }
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Los datos enviados son demasiado grandes" });
  }
  if (err.name === "MulterError") {
    return res.status(400).json({ error: "No se pudo procesar el archivo" });
  }
  console.error("Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// --- ESCUCHAR EN EL PUERTO CORRECTO ---
const PORT = process.env.PORT || 4000;

// Escuchar en 0.0.0.0 es obligatorio en Hostinger para que el proxy enrute el tráfico
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ API corriendo en puerto ${PORT}`);
});

// Manejadores de errores para evitar que el proceso se apague en silencio
process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("🚨 Uncaught Exception:", error);
});
