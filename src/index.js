// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pool, poolStats } from "./lib/db.js";
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
} from "./middleware/rateLimiters.js";

console.log(`[APP] 🚀 ARRANCANDO ${new Date().toISOString()} (node ${process.version})`);

// --- Errores sueltos: se registran en vez de tumbar la app ---
process.on("unhandledRejection", (err) => {
  console.error("[APP] ❌ Promesa rechazada sin manejar:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[APP] ❌ Excepción no capturada:", err);
});
// Si Hostinger reinicia o apaga la app, queda escrito.
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[APP] 🛑 Recibí ${signal}, la app se está cerrando`);
    process.exit(0);
  });
}

const app = express();

// Hostinger pone un proxy delante de tu app.
app.set("trust proxy", 1);

// --- Registro de peticiones ---
let inFlight = 0;
const SLOW_REQUEST_MS = 1500;

app.use((req, res, next) => {
  const start = Date.now();
  inFlight += 1;
  let done = false;

  const finish = (aborted) => {
    if (done) return;
    done = true;
    inFlight -= 1;
    const ms = Date.now() - start;
    const line = `${req.method} ${req.originalUrl} -> ${aborted ? "CORTADA" : res.statusCode} en ${ms} ms (en curso: ${inFlight})`;

    if (aborted) console.warn(`[REQ] ⚠️ el cliente se fue antes de recibir respuesta: ${line}`);
    else if (res.statusCode >= 500) console.error(`[REQ] ❌ ${line}`);
    else if (ms >= SLOW_REQUEST_MS) console.warn(`[REQ] 🐢 lenta: ${line}`);
  };

  res.on("finish", () => finish(false));
  res.on("close", () => finish(!res.writableFinished));
  next();
});

// --- Latido cada 30 s: memoria, peticiones en curso, pool y bloqueo de Node ---
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const lag = Math.max(0, now - lastTick - 1000);
  lastTick = now;
  if (lag > 200) {
    console.warn(`[APP] ⚠️ Node se bloqueó ~${lag} ms (event loop atrasado)`);
  }
}, 1000).unref();

setInterval(() => {
  const mem = process.memoryUsage();
  const mb = (n) => Math.round(n / 1024 / 1024);
  console.log(
    `[APP] ❤️ latido | ram=${mb(mem.rss)}MB heap=${mb(mem.heapUsed)}MB | en curso=${inFlight} | pool=${JSON.stringify(poolStats())} | uptime=${Math.round(process.uptime())}s`
  );
}, 30000).unref();

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
      console.warn(`[CORS] origen no permitido: ${origin}`);
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

// Health check de la base de datos + estado interno (temporal, para diagnosticar).
app.get("/api/health/db", async (req, res) => {
  const t = Date.now();
  try {
    await pool.query({ sql: "SELECT 1", timeout: 8000 });
    res.json({
      db: "ok",
      ms: Date.now() - t,
      pool: poolStats(),
      enCurso: inFlight,
      ramMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
      uptimeS: Math.round(process.uptime()),
    });
  } catch (err) {
    res.status(500).json({
      db: "error",
      ms: Date.now() - t,
      code: err.code,
      message: err.message,
      pool: poolStats(),
      enCurso: inFlight,
    });
  }
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
