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

const ALLOWED_FROM = {
  paid: ["pending", "failed", "cancelled"],
  cancelled: ["pending", "failed"],
  pending: ["cancelled", "failed"],
};

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

    const whatsapp = await getWhatsappSettings();
    if (!whatsapp) {
      return res.status(503).json({
        error:
          "Los pedidos todavía no están disponibles. Intenta de nuevo más tarde.",
      });
    }

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

    const productIds = [...new Set(requested.map((item) => item.productId))];
    const placeholders = productIds.map(() => "?").join(",");
    const dbProducts = await query(
      `SELECT * FROM Product WHERE id IN (${placeholders})`,
      productIds
    );

    if (dbProducts.length !== productIds.length) {
      return res.status(400).json({ error: "Algún producto ya no existe" });
    }

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
        const chosen = sizes.find((s) => s.label === item.size);

        if (!chosen) {
          return res.status(400).json({
            error: `Elige una talla válida para ${product.title}`,
          });
        }

        price = chosen.price;
        title = `${product.title} · Talla ${chosen.label}`;
      }

      orderItems.push({
        productId: product.id,
        title,
        price,
        quantity: item.quantity,
      });
    }

    const subtotalOriginal = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // =====================================================================
    // 👇 LÓGICA DEL DESCUENTO DEL 10% EN LA PRIMERA COMPRA 👇
    // =====================================================================
    
    // Revisa si ya existe un pedido previo con este correo O este teléfono
    const previousOrders = await query(
      "SELECT id FROM `Order` WHERE email = ? OR phone = ? LIMIT 1",
      [buyer.email, buyer.phone]
    );
    
    const isFirstPurchase = previousOrders.length === 0;
    let descuento = 0;

    if (isFirstPurchase) {
      descuento = subtotalOriginal * 0.10;
    }

    const subtotalFinal = subtotalOriginal - descuento;

    // =====================================================================

    const orderId = randomUUID();

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Se guarda en la base de datos el subtotalFinal (con descuento)
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
          subtotalFinal, // 👈 Total final
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
      conn.release();
    }

    // Se genera el mensaje de WhatsApp con el subtotal final (con descuento)
    const whatsappUrl = buildWhatsappUrl({
      settings: whatsapp,
      orderId,
      customerName: buyer.name,
      items: orderItems,
      subtotal: subtotalFinal, // 👈 Total final
    });

    // El correo que te llega a ti también muestra el total final
    sendOrderRequestEmail({
      id: orderId,
      customerName: buyer.name,
      email: buyer.email,
      phone: buyer.phone,
      address: buyer.address,
      city: buyer.city,
      subtotal: subtotalFinal, // 👈 Total final
      items: orderItems,
    });

    res.status(201).json({ orderId, whatsappUrl });
  } catch (error) {
    console.error("Error creando la orden:", error);
    res.status(500).json({ error: "No se pudo crear el pedido" });
  }
});

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
