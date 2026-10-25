import { pool, query } from "./db.js";

// Si después de una venta a un producto le quedan MENOS de este número,
// le llega un correo a la dueña de la tienda.
export const LOW_STOCK_THRESHOLD = 10;

export const MAX_STOCK = 100000;

// Interpreta el stock que llega del panel:
//   vacío o null          -> null (el producto no controla stock)
//   entero de 0 al máximo -> ese número
//   cualquier otra cosa   -> undefined (no es válido)
export function parseStock(value) {
  if (typeof value === "string") value = value.trim();
  if (value === null || value === "") return null;
  if (typeof value !== "number" && typeof value !== "string") return undefined;

  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > MAX_STOCK) {
    return undefined;
  }
  return number;
}

// Descuenta del stock lo que se vendió en una orden ya pagada.
// Devuelve la lista de productos que quedaron por debajo del límite:
//   [{ id, title, remaining, oversold }]
// Todo ocurre en una transacción: o se descuentan todos, o ninguno.
export async function decreaseStockForOrder(orderId) {
  const items = await query(
    "SELECT productId, quantity FROM OrderItem WHERE orderId = ?",
    [orderId]
  );

  // Un mismo producto puede venir en varias tallas: se suma todo.
  const totals = new Map();
  for (const item of items) {
    totals.set(
      item.productId,
      (totals.get(item.productId) || 0) + Number(item.quantity)
    );
  }

  const alerts = [];
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    // En orden alfabético, para que dos ventas al mismo tiempo no se
    // traben entre sí.
    for (const productId of [...totals.keys()].sort()) {
      const quantity = totals.get(productId);

      // FOR UPDATE bloquea la fila mientras se descuenta: así dos pagos
      // simultáneos no se pisan.
      const [rows] = await conn.query(
        "SELECT id, title, stock FROM Product WHERE id = ? FOR UPDATE",
        [productId]
      );
      const product = rows[0];

      // Producto borrado o sin control de stock: no hay nada que descontar.
      if (!product || product.stock === null) continue;

      const before = Number(product.stock);
      const remaining = Math.max(before - quantity, 0);
      const oversold = Math.max(quantity - before, 0);

      await conn.query("UPDATE Product SET stock = ? WHERE id = ?", [
        remaining,
        productId,
      ]);

      if (remaining < LOW_STOCK_THRESHOLD) {
        alerts.push({
          id: product.id,
          title: product.title,
          remaining,
          oversold,
        });
      }
    }

    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    conn.release();
  }

  return alerts;
}