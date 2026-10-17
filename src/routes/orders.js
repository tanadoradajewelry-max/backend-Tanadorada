// src/routes/orders.js
import { Router } from "express";
import { pool, query, queryOne } from "../lib/db.js";
import { createHostedPayment, verifyPaymentHash } from "../lib/pixelpay.js";
import { sendOrderEmails } from "../lib/mailer.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { parseSizes } from "../lib/sizes.js";
import { randomUUID } from "node:crypto";

export const ordersRouter = Router();

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

// POST /api/orders — crea la orden y el link de pago hospedado.
// El navegador solo manda "qué producto, qué talla y cuántos": el PRECIO se
// busca aquí en el servidor, nunca se acepta el que venga del navegador.
ordersRouter.post("/", async (req, res) => {
  try {
    const { customer, items } = req.body || {};

    if (
      !customer?.name ||
      !customer?.email ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({ error: "Faltan datos del pedido" });
    }

    if (items.length > 50) {
      return res
        .status(400)
        .json({ error: "El pedido tiene demasiados productos" });
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
          String(customer.name),
          String(customer.email),
          String(customer.phone ?? ""),
          String(customer.address ?? ""),
          String(customer.city ?? ""),
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

    // Crear link de pago (fuera de la transacción, usa red externa)
    const approveUrl = await createHostedPayment({
      orderId,
      amount: subtotal,
      customer,
    });

    res.status(201).json({ orderId, approveUrl });
  } catch (error) {
    console.error("Error creando la orden:", error);
    res.status(500).json({ error: "No se pudo crear la orden" });
  }
});

// POST /api/orders/:id/capture — verifica el paymentHash de PixelPay
ordersRouter.post("/:id/capture", async (req, res) => {
  try {
    const { paymentHash } = req.body;

    const order = await queryOne("SELECT * FROM `Order` WHERE id = ?", [
      req.params.id,
    ]);

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    if (order.status === "paid") {
      return res.json({ status: "paid", orderId: order.id });
    }

    const isValid = verifyPaymentHash(order.id, paymentHash);

    // UPDATE condicional: solo si no está "paid" todavía
    const [updateResult] = await pool.query(
      "UPDATE `Order` SET status = ? WHERE id = ? AND status != 'paid'",
      [isValid ? "paid" : "failed", order.id]
    );

    if (isValid && updateResult.affectedRows > 0) {
      const fullOrder = await getOrderWithItems(order.id);
      sendOrderEmails(fullOrder);
    }

    res.json({ status: isValid ? "paid" : "failed", orderId: order.id });
  } catch (error) {
    console.error("Error verificando el pago:", error);
    res.status(500).json({ error: "No se pudo confirmar el pago" });
  }
});

ordersRouter.get("/:id", async (req, res) => {
  try {
    const order = await getOrderWithItems(req.params.id);
    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }
    res.json(order);
  } catch (error) {
    console.error("Error obteniendo orden:", error);
    res.status(500).json({ error: "Error al obtener la orden" });
  }
});
