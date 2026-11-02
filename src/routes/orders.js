// src/routes/orders.js
import { Router } from "express";
import { pool, query, queryOne } from "../lib/db.js";
import {
  sendOrderRequestEmail,
  sendPaymentConfirmedEmail,
  sendLowStockEmail,
} from "../lib/mailer.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { parseSizes } from "../lib/sizes.js";
import { decreaseStockForOrder } from "../lib/stock.js";
import { getWhatsappSettings, buildWhatsappUrl } from "../lib/whatsapp.js";
import { randomUUID } from "node:crypto";

export const ordersRouter = Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Estados de un pedido:
//   pending   = espera que la clienta pague con el link de WhatsApp
//   paid      = pagado (ya se descontó el stock)
//   cancelled = cancelado
//   failed    = pedidos viejos del sistema de pago anterior
// Para cada estado nuevo: desde cuáles se puede llegar. Un pedido pagado
// ya no se puede cambiar, porque su stock ya se descontó.
const ALLOWED_FROM = {
  paid: ["pending", "failed", "cancelled"],
  cancelled: ["pending", "failed"],
  pending: ["cancelled", "failed"],
};

// Helper: obtiene una orden con sus items
async function getOrderWithItems(orderId) {
  const order = await queryOne("SELECT * FROM `Order` WHERE id = ?", [orderId]);
  if (!order) return null;

  const items = await query("SELECT * FROM OrderItem WHERE orderId = ?", [
    orderId,
  ]);
  return { ...order, items };
}

ordersRouter.get("/", requireAdmin, async (req, res) => {
  try {
    const orders = await query("SELECT * FROM `Order` ORDER BY createdAt DESC");

    // Carga los items de todas las órdenes en una sola consulta
    if (orders.length > 0) {
      const ids = orders.map((o) => o.id);
      const placeholders = ids.map(() => "?").join(",");
      const items = await query(
        `SELECT * FROM OrderItem WHERE orderId IN (${placeholders})`,
        ids
      );

      const itemsByOrder = items.reduce((acc, item) => {
        (acc[item.orderId] ||= []).push(item);
        return acc;
      }, {});

      orders.forEach((o) => {
        o.items = itemsByOrder[o.id] || [];
      });
    }

    res.json(orders);
  } catch (error) {
    console.error("Error listando órdenes:", error);
    res.status(500).json({ error: "Error al listar órdenes" });
  }
});

// POST /api/orders — guarda el pedido y devuelve el link de WhatsApp con el
// mensaje ya escrito. El navegador solo manda "qué producto, qué talla y
// cuántos": el PRECIO se busca aquí en el servidor, nunca el que venga del
// navegador.
ordersRouter.post("/", async (req, res) => {
  try {
    const { customer, items } = req.body || {};

    const buyer = {
      name: String(customer?.name ?? "").trim().slice(0, 120),
      email: String(customer?.email ?? "").trim().slice(0, 160),
      phone: String(customer?.phone ?? "").trim().slice(0, 40),
      address: String(customer?.address ?? "").trim().slice(0, 190),
      city: String(customer?.city ?? "").trim().slice(0, 120),
    };

    if (
      !buyer.name ||
      !buyer.email ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({ error: "Faltan datos del pedido" });
    }

    if (!EMAIL_PATTERN.test(buyer.email)) {
      return res.status(400).json({ error: "El correo no es válido" });
    }

    if (items.length > 50) {
      return res
        .status(400)
        .json({ error: "El pedido tiene demasiados productos" });
    }

    // Sin número de WhatsApp guardado en el panel no se crea ningún pedido:
    // nadie podría atenderlo.
    const whatsapp = await getWhatsappSettings();
    if (!whatsapp) {
      return res.status(503).json({
        error:
          "Los pedidos todavía no están disponibles. Intenta de nuevo más tarde.",
      });
    }

    // Cantidades: enteros de 1 a 99 (una cantidad negativa bajaría el total).
    const requested = items.map((item) => ({
      productId: String(item?.productId ?? ""),
      quantity: Number(item?.quantity),
      size: item?.size == null ? null : String(item.size),
    }));

    for (const item of requested) {
      if (
        !item.productId ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99
      ) {
        return res
          .status(400)
          .json({ error: "Hay una cantidad no válida en el pedido" });
      }
    }

    // Un mismo producto puede venir en varias tallas: se busca una sola vez.
    const productIds = [...new Set(requested.map((item) => item.productId))];
    const placeholders = productIds.map(() => "?").join(",");
    const dbProducts = await query(
      `SELECT * FROM Product WHERE id IN (${placeholders})`,
      productIds
    );

    if (dbProducts.length !== productIds.length) {
      return res.status(400).json({ error: "Algún producto ya no existe" });
    }

    // Stock: se revisa por producto (todas las tallas suman) antes de guardar.
    // Los productos sin stock cargado (null) no se revisan.
    const wanted = new Map();
    for (const item of requested) {
      wanted.set(
        item.productId,
        (wanted.get(item.productId) || 0) + item.quantity
      );
    }

    for (const [productId, quantity] of wanted) {
      const product = dbProducts.find((p) => p.id === productId);
      if (product.stock === null || product.stock === undefined) continue;

      const available = Number(product.stock);

      if (available <= 0) {
        return res.status(400).json({
          error: `${product.title} está agotado. Quítalo de tu bolsa para continuar.`,
        });
      }

      if (quantity > available) {
        return res.status(400).json({
          error: `Solo quedan ${available} de ${product.title}. Ajusta la cantidad en tu bolsa.`,
        });
      }
    }

    const orderItems = [];

    for (const item of requested) {
      const product = dbProducts.find((p) => p.id === item.productId);
      const sizes = parseSizes(product.sizes);

      let price = product.price;
      let title = product.title;

      if (sizes.length > 0) {
        // El producto tiene tallas: la talla es obligatoria y manda el precio.
        const chosen = sizes.find((s) => s.label === item.size);

        if (!chosen) {
          return res.status(400).json({
            error: `Elige una talla válida para ${product.title}`,
          });
        }

        price = chosen.price;
        // La talla queda en el nombre, así se ve en tu panel y en los correos.
        title = `${product.title} · Talla ${chosen.label}`;
      }

      orderItems.push({
        productId: product.id,
        title,
        price,
        quantity: item.quantity,
      });
    }

    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const orderId = randomUUID();

    // 🔒 Transacción: crea orden + items juntos, o nada.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      await conn.query(
        `INSERT INTO \`Order\`
          (id, customerName, email, phone, address, city, subtotal, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          buyer.name,
          buyer.email,
          buyer.phone,
          buyer.address,
          buyer.city,
          subtotal,
          "pending",
        ]
      );

      for (const item of orderItems) {
        await conn.query(
          `INSERT INTO OrderItem
            (id, orderId, productId, title, price, quantity)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            randomUUID(),
            orderId,
            item.productId,
            item.title,
            item.price,
            item.quantity,
          ]
        );
      }

      await conn.commit();
    } catch (error) {
      await conn.rollback().catch(() => {});
      throw error;
    } finally {
      // Se libera UNA sola vez, pase lo que pase.
      conn.release();
    }

    const whatsappUrl = buildWhatsappUrl({
      settings: whatsapp,
      orderId,
      customerName: buyer.name,
      items: orderItems,
      subtotal,
    });

    // Aviso por correo a la dueña. No se espera: el pedido ya quedó guardado.
    sendOrderRequestEmail({
      id: orderId,
      customerName: buyer.name,
      email: buyer.email,
      phone: buyer.phone,
      address: buyer.address,
      city: buyer.city,
      subtotal,
      items: orderItems,
    });

    res.status(201).json({ orderId, whatsappUrl });
  } catch (error) {
    console.error("Error creando la orden:", error);
    res.status(500).json({ error: "No se pudo crear el pedido" });
  }
});

// PUT /api/orders/:id/status — SOLO ADMIN: cambia el estado de un pedido.
// Al marcarlo como "paid": se descuenta el stock, la clienta recibe su
// confirmación y, si queda poco stock, te llega el aviso.
ordersRouter.put("/:id/status", requireAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};

    if (typeof status !== "string" || !Object.hasOwn(ALLOWED_FROM, status)) {
      return res.status(400).json({ error: "Estado no válido" });
    }

    const order = await queryOne("SELECT id, status FROM `Order` WHERE id = ?", [
      req.params.id,
    ]);

    if (!order) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    if (order.status === status) {
      return res.json({ status });
    }

    // UPDATE condicional: si dos clics llegan al mismo tiempo, solo UNO gana
    // (affectedRows > 0). Así el stock y los correos se procesan una sola vez.
    const allowedFrom = ALLOWED_FROM[status];
    const [result] = await pool.query(
      `UPDATE \`Order\` SET status = ? WHERE id = ? AND status IN (${allowedFrom
        .map(() => "?")
        .join(",")})`,
      [status, order.id, ...allowedFrom]
    );

    if (result.affectedRows === 0) {
      return res.status(409).json({
        error:
          "Este pedido ya no se puede cambiar a ese estado. Los pedidos pagados no se pueden revertir desde el panel.",
      });
    }

    if (status === "paid") {
      // El estado ya quedó guardado: si falla el descuento de stock, se
      // registra en el log pero nunca se deshace el cambio.
      let stockAlerts = [];
      try {
        stockAlerts = await decreaseStockForOrder(order.id);
      } catch (stockError) {
        console.error(
          "No se pudo descontar el stock de la orden",
          order.id,
          stockError
        );
      }

      const fullOrder = await getOrderWithItems(order.id);
      sendPaymentConfirmedEmail(fullOrder);

      if (stockAlerts.length > 0) {
        sendLowStockEmail(stockAlerts);
      }
    }

    res.json({ status });
  } catch (error) {
    console.error("Error actualizando el estado del pedido:", error);
    res.status(500).json({ error: "No se pudo actualizar el pedido" });
  }
});
