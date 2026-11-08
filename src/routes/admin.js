import { Router } from "express";
import { query } from "../lib/db.js";
import { LOW_STOCK_THRESHOLD } from "../lib/stock.js";

export const adminRouter = Router();

// Cuenta filas. Si una consulta falla (por ejemplo, una tabla que todavía no
// existe), ese número queda en null y el resto del resumen sigue funcionando.
async function count(sql, params = []) {
  try {
    const rows = await query(sql, params);
    return Number(rows[0]?.total ?? 0);
  } catch (error) {
    console.error("Resumen del panel, no se pudo contar:", error.message);
    return null;
  }
}

// GET /api/admin/summary — SOLO números, para las tarjetas del panel de inicio.
// (Protegida con la contraseña de admin desde index.js.)
adminRouter.get("/summary", async (req, res) => {
  const [
    products,
    soldOut,
    lowStock,
    collections,
    pendingOrders,
    newCharmBar,
    newCertificates,
  ] = await Promise.all([
    count("SELECT COUNT(*) AS total FROM Product"),
    count(
      "SELECT COUNT(*) AS total FROM Product WHERE stock IS NOT NULL AND stock <= 0"
    ),
    count(
      "SELECT COUNT(*) AS total FROM Product WHERE stock IS NOT NULL AND stock > 0 AND stock < ?",
      [LOW_STOCK_THRESHOLD]
    ),
    count("SELECT COUNT(*) AS total FROM Collection"),
    count("SELECT COUNT(*) AS total FROM `Order` WHERE status = 'pending'"),
    count("SELECT COUNT(*) AS total FROM CharmBarRequest WHERE status = 'new'"),
    count(
      "SELECT COUNT(*) AS total FROM GiftCertificateRequest WHERE status = 'new'"
    ),
  ]);

  res.json({
    products,
    soldOut,
    lowStock,
    collections,
    pendingOrders,
    newCharmBar,
    newCertificates,
  });
});