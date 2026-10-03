// src/index.js
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { testConnection } from "./lib/db.js";
import { productsRouter } from "./routes/products.js";
import { ordersRouter } from "./routes/orders.js";
import { uploadRouter } from "./routes/upload.js";

const app = express();

// --- CORS ---
// Acepta varios orígenes separados por coma en FRONTEND_URL.
// Ej: FRONTEND_URL="http://localhost:5173,https://forestgreen-alligator-342469.hostingersite.com"
const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, "")) // quita barra final
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Permite peticiones sin Origin (Postman, curl, health checks, SSR)
      if (!origin) return callback(null, true);

      const cleanOrigin = origin.replace(/\/$/, "");

      if (allowedOrigins.includes(cleanOrigin)) {
        return callback(null, true);
      }

      console.warn(`❌ CORS bloqueado para origen: ${origin}`);
      return callback(new Error(`Origen no permitido por CORS: ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());

// Sirve las imágenes subidas desde el panel admin
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/upload", uploadRouter);

// Middleware de errores (incluye los de CORS)
app.use((err, req, res, next) => {
  if (err.message?.includes("CORS")) {
    return res.status(403).json({ error: err.message });
  }
  console.error("Error no manejado:", err);
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 4000;

// Verifica la conexión antes de levantar el servidor
await testConnection();

app.listen(PORT, () => {
  console.log(`Tanadorada API corriendo en el puerto ${PORT}`);
  console.log(`Orígenes permitidos: ${allowedOrigins.join(", ") || "(ninguno)"}`);
});
