// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pool } from "./lib/db.js";
import { productsRouter } from "./routes/products.js";
import { ordersRouter } from "./routes/orders.js";
import { uploadRouter, imagesRouter } from "./routes/upload.js";
import { contentRouter } from "./routes/content.js";
import { collectionsRouter } from "./routes/collections.js";
import { charmBarRouter } from "./routes/charmbar.js";
import { giftCertificatesRouter } from "./routes/giftcertificates.js";
import { adminRouter } from "./routes/admin.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import {
  adminLimiter,
  orderLimiter,
  charmBarLimiter,
  giftCertificateLimiter,
  searchLimiter,
} from "./middleware/rateLimiters.js";

// Un error suelto (por ejemplo, un correo que falla) no tumba la app.
process.on("unhandledRejection", (err) => {
  console.error("Promesa rechazada sin manejar:", err);
});
process.on("uncaughtException", (err) => {
  console.error("Excepción no capturada:", err);
});

const app = express();

// Hostinger pone un proxy delante de tu app.
app.set("trust proxy", 1);

const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

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

app.use(express.json({ limit: "15mb" }));

// Health check público: solo confirma que el servidor responde.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Verificación de la contraseña de admin.
app.get("/api/admin/verify", adminLimiter, requireAdmin, (req, res) => {
  res.json({ ok: true });
});

// Números para las tarjetas del panel de inicio (solo admin).
app.use("/api/admin", adminLimiter, requireAdmin, adminRouter);

// Health check detallado: protegido con la contraseña de admin.
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
    info.db = { connected: false, error: err.message, code: err.code };
  }
  res.json(info);
});

// --- Límites de intentos ---
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
app.get("/api/products/search", searchLimiter); // buscador público, con tope
app.get("/api/orders", adminLimiter);
app.post("/api/orders", orderLimiter);
app.put("/api/orders/:id/status", adminLimiter);
app.post("/api/charm-bar", charmBarLimiter);
app.get("/api/charm-bar", adminLimiter);
app.put("/api/charm-bar/:id/status", adminLimiter);
app.post("/api/gift-certificates", giftCertificateLimiter);
app.get("/api/gift-certificates", adminLimiter);
app.put("/api/gift-certificates/:id/status", adminLimiter);

app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/images", imagesRouter);
app.use("/api/content", contentRouter);
app.use("/api/collections", collectionsRouter);
app.use("/api/charm-bar", charmBarRouter);
app.use("/api/gift-certificates", giftCertificatesRouter);

app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "La imagen pesa más de 2 MB" });
  }
  if (err.type === "entity.too.large") {
    return res
      .status(413)
      .json({ error: "Los datos enviados son demasiado grandes" });
  }
  if (err.name === "MulterError") {
    return res.status(400).json({ error: "No se pudo procesar el archivo" });
  }
  console.error("Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ API corriendo en puerto ${PORT}`);
});
