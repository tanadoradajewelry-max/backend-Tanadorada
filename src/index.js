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

app.use(cors({ origin: process.env.FRONTEND_URL || "https://forestgreen-alligator-342469.hostingersite.com/" }));
app.use(express.json());

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/products", productsRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/upload", uploadRouter);

const PORT = process.env.PORT || 4000;

// Verifica la conexión antes de levantar el servidor
await testConnection();

app.listen(PORT, () => {
  console.log(`Tanadorada API corriendo en http://localhost:${PORT}`);
});
