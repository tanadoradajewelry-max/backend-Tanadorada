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

app.set("trust proxy", 1);

const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

console.log("✅ Orígenes permitidos (CORS):", allowedOrigins);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const clean = origin.replace(/\/$/, "");
      if (allowedOrigins.includes(clean)) return callback(null, true);
      console.error(`🚨 CORS bloqueado para el origen: ${origin}`);
      return callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-password"],
  })
);

app.options(/.*/, cors());
app.use(express.json({ limit: "15mb" }));

const orderLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos." },
});

app.get("/api/health", async (req, res) => {
  // Health check mejorado: Verifica si la base de datos responde
  try {
    const conn = await pool.getConnection();
    conn.release();
    res.json({ status: "ok", db: "connected" });
  } catch (error) {
    console.error("Error en health check (Base de datos):", error);
    res.status(503).json({ status: "error", db: "disconnected", message: error.message });
  }
});

app.get("/api/admin/verify", adminLimiter, requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.use("/api/admin", adminLimiter, requireAdmin, adminRouter);

// ... (El resto de tus rutas de products, orders, charm-bar, etc., se mantienen igual) ...
// Para no hacer el mensaje infinito, asumo que mantienes las rutas que ya tenías aquí.
// Solo asegúrate de que todo lo que estaba entre el health check y el error handler siga ahí.

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
    return res.status(413).json({ error: "Los datos enviados son demasiado grandes" });
  }
  if (err.name === "MulterError") {
    return res.status(400).json({ error: "No se pudo procesar el archivo" });
  }
  console.error("Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

// 🚨 MANEJADORES GLOBALES DE ERRORES (Para ver por qué se apaga)
process.on("unhandledRejection", (reason, promise) => {
  console.error("🚨 Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("🚨 Uncaught Exception:", error);
});

const PORT = process.env.PORT || 4000;
// 🚨 IMPORTANTE: Escuchar en 0.0.0.0 para que Hostinger enrute el tráfico
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ API corriendo en puerto ${PORT} y escuchando en 0.0.0.0`);
});
