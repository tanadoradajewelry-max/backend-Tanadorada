import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { createHostedPayment, verifyPaymentHash } from "../lib/pixelpay.js";
import { sendOrderEmails } from "../lib/mailer.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

export const ordersRouter = Router();

ordersRouter.get("/", requireAdmin, async (req, res) => {
  const orders = await prisma.order.findMany({
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });
  res.json(orders);
});

// POST /api/orders — crea la orden y el link de pago hospedado de PixelPay.
ordersRouter.post("/", async (req, res) => {
  try {
    const { customer, items } = req.body;

    if (!customer?.name || !customer?.email || !items?.length) {
      return res.status(400).json({ error: "Faltan datos del pedido" });
    }

    const productIds = items.map((item) => item.productId);
    const dbProducts = await prisma.product.findMany({
      where: { id: { in: productIds } },
    });

    if (dbProducts.length !== productIds.length) {
      return res.status(400).json({ error: "Algún producto ya no existe" });
    }

    const orderItems = items.map((item) => {
      const product = dbProducts.find((p) => p.id === item.productId);
      return {
        productId: product.id,
        title: product.title,
        price: product.price,
        quantity: item.quantity,
      };
    });

    const subtotal = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const order = await prisma.order.create({
      data: {
        customerName: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        city: customer.city,
        subtotal,
        status: "pending",
        items: { create: orderItems },
      },
      include: { items: true },
    });

    const approveUrl = await createHostedPayment({
      orderId: order.id,
      amount: subtotal,
      customer,
    });

    res.status(201).json({ orderId: order.id, approveUrl });
  } catch (error) {
    console.error("Error creando la orden:", error);
    res.status(500).json({ error: "No se pudo crear la orden" });
  }
});

// POST /api/orders/:id/capture — con PixelPay no hay un paso de "captura"
// separado como en PayPal: el pago ya ocurrió cuando el cliente vuelve a
// _complete. Aquí solo VERIFICAMOS el paymentHash contra nuestro Secret Key
// para confirmar que de verdad viene de PixelPay y no fue falsificado.
ordersRouter.post("/:id/capture", async (req, res) => {
  try {
    const { paymentHash } = req.body;

    const order = await prisma.order.findUnique({
      where: { id: req.params.id },
    });

    if (!order) {
      return res.status(404).json({ error: "Orden no encontrada" });
    }

    if (order.status === "paid") {
      return res.json({ status: "paid", orderId: order.id });
    }

    const isValid = verifyPaymentHash(order.id, paymentHash);

    // updateMany con status != "paid" evita que, si esta ruta se llama
    // dos veces casi al mismo tiempo, se manden correos duplicados.
    const updateResult = await prisma.order.updateMany({
      where: { id: order.id, status: { not: "paid" } },
      data: { status: isValid ? "paid" : "failed" },
    });

    if (isValid && updateResult.count > 0) {
      const fullOrder = await prisma.order.findUnique({
        where: { id: order.id },
        include: { items: true },
      });
      sendOrderEmails(fullOrder);
    }

    res.json({ status: isValid ? "paid" : "failed", orderId: order.id });
  } catch (error) {
    console.error("Error verificando el pago:", error);
    res.status(500).json({ error: "No se pudo confirmar el pago" });
  }
});

ordersRouter.get("/:id", async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });

  if (!order) {
    return res.status(404).json({ error: "Orden no encontrada" });
  }

  res.json(order);
});