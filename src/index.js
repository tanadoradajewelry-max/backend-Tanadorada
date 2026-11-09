// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { pool, testConnection } from "./lib/db.js";
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

// ✅ Un error suelto (por ejemplo, un correo que falla) ya no tumba la app.
process.on("unhandledRejection", (err) => {
  console.error("Promesa rechazada sin manejar:", err);
});
process.on("uncaughtException", (err) => {
  console.error("Excepción no capturada:", err);
});

const app = express();

// Hostinger pone un proxy delante de tu app. Con esta línea los límites de
// intentos leen la IP real de cada visitante.
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

// Cuando todas las fotos nuevas estén subidas como URL, baja esto a "1mb".
app.use(express.json({ limit: "15mb" }));

// Límite para consultar/confirmar pedidos desde la página pública.
const orderLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos." },
});

// --- Caché corta en memoria para datos que casi no cambian ---
// Así la portada y los catálogos no consultan MySQL en cada visita.
// Cuando guardas algo desde el panel (PUT/POST/DELETE) la caché se limpia sola.
const responseCache = new Map();

function cacheGet(seconds) {
  return (req, res, next) => {
    if (req.method !== "GET") {
      responseCache.clear();
      return next();
    }

    const key = req.originalUrl;
    const hit = responseCache.get(key);

    if (hit && hit.expires > Date.now()) {
      res.set("Cache-Control", `public, max-age=${seconds}`);
      return res.json(hit.body);
    }

    const send = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200) {
        res.set("Cache-Control", `public, max-age=${seconds}`);
        responseCache.set(key, { body, expires: Date.now() + seconds * 1000 });
        // Evita que el mapa crezca sin fin.
        if (responseCache.size > 200) responseCache.clear();
      }
      return send(body);
    };
    next();
  };
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/admin/verify", adminLimiter, requireAdmin, (req, res) => {
  res.json({ ok: true });
});
// Resumen de números para el panel de inicio (solo admin).
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

// --- Rutas de Pedidos ---
app.get("/api/orders", adminLimiter); // listado de pedidos (solo admin)
app.post("/api/orders", orderLimiter); // crear pedido (público, con tope)
app.put("/api/orders/:id/status", adminLimiter); // cambiar estado (solo admin)
app.post("/api/orders/:id/capture", orderLookupLimiter); // confirmar pago
app.get("/api/orders/:id", orderLookupLimiter); // ver un pedido

// --- Rutas de Charm Bar ---
app.post("/api/charm-bar", charmBarLimiter);
app.get("/api/charm-bar", adminLimiter);
app.put("/api/charm-bar/:id/status", adminLimiter);

// --- Certificados de Regalo ---
app.post("/api/gift-certificates", giftCertificateLimiter); // solicitud pública
app.get("/api/gift-certificates", adminLimiter); // ver lista (solo admin)
app.put("/api/gift-certificates/:id/status", adminLimiter); // cambiar estado (solo admin)
app.get("/api/products/search", searchLimiter); // buscador de la tienda (público, con tope)

// --- Caché (30 s) para colecciones y contenido ---
app.use("/api/collections", cacheGet(30));
app.use("/api/content", cacheGet(30));

// --- Enrutadores (Routers) ---
app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/upload", uploadRouter);
app.use("/api/images", imagesRouter);
app.use("/api/content", contentRouter);
app.use("/api/collections", collectionsRouter);
app.use("/api/charm-bar", charmBarRouter);
app.use("/api/gift-certificates", giftCertificatesRouter);

// --- Manejo de Errores Global ---
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
  testConnection();
});
