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
import { collectionsRouter } from "./routes/collections.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import { adminLimiter, orderLimiter } from "./middleware/rateLimiters.js";

const app = express();

// Hostinger pone un proxy delante de tu app. Sin esta línea, los límites de
// intentos ven a TODAS las personas con la misma IP (la del proxy) y las
// cuentan juntas. Con "1" lee la IP real de cada visitante.
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

app.options("*", cors());

app.use(express.json({ limit: "15mb" }));

// Health check público: solo confirma que el servidor responde.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

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
app.get("/api/orders", adminLimiter); // listado de pedidos (solo admin)
app.post("/api/orders", orderLimiter); // crear pedido (público, con tope)

app.use("/api/products", productsRouter);
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
