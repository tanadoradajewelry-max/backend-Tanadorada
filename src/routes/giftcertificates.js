import { Router } from "express";
import { randomUUID } from "node:crypto";
import { query } from "../lib/db.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { sendGiftCertificateEmail } from "../lib/mailer.js";
import {
  getWhatsappSettings,
  buildGiftCertificateWhatsappUrl,
} from "../lib/whatsapp.js";

export const giftCertificatesRouter = Router();

// Mismos límites que usa la página (frontend/src/data/giftCertificateOptions.js).
// Si los cambias, cámbialos en los dos lugares.
const MIN_AMOUNT = 600;
const MAX_AMOUNT = 50000;
const MAX_MESSAGE = 500; // la página muestra 300; aquí queda más holgado

const STATUSES = ["new", "link_sent", "paid", "delivered", "cancelled"];
const RECEIVE_VIA = ["whatsapp", "email"];
const DELIVERY = ["personal", "direct"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Texto de una línea: sin saltos ni espacios de más.
const oneLineText = (value, max) =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Texto de varias líneas (el mensaje): se conservan los saltos de línea.
const multiLineText = (value, max) =>
  String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

// POST /api/gift-certificates — PÚBLICO: cualquier persona puede solicitar.
giftCertificatesRouter.post("/", async (req, res) => {
  try {
    const body = req.body || {};

    // Campo trampa: las personas no lo ven, los bots sí lo llenan.
    // Se responde "ok" sin guardar nada para no darles pistas.
    if (body.website) {
      return res.status(201).json({ ok: true });
    }

    const amount = Number(body.amount);
    const recipientName = oneLineText(body.recipientName, 120);
    const senderName = oneLineText(body.senderName, 120);
    const message = multiLineText(body.message, MAX_MESSAGE);
    const receiveVia = String(body.receiveVia ?? "");
    const delivery = String(body.delivery ?? "");
    const contact = oneLineText(body.contact, 160);

    if (!Number.isInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      return res.status(400).json({
        error: `El monto debe ser un número entero entre L ${MIN_AMOUNT.toLocaleString("en-US")} y L ${MAX_AMOUNT.toLocaleString("en-US")}`,
      });
    }

    if (!recipientName || !senderName) {
      return res.status(400).json({ error: "Faltan los nombres del regalo" });
    }

    if (!RECEIVE_VIA.includes(receiveVia)) {
      return res
        .status(400)
        .json({ error: "Elige cómo quieres recibir tu certificado" });
    }

    if (!DELIVERY.includes(delivery)) {
      return res.status(400).json({ error: "Elige la modalidad de entrega" });
    }

    if (receiveVia === "email") {
      if (!EMAIL_PATTERN.test(contact)) {
        return res.status(400).json({ error: "El correo no es válido" });
      }
    } else {
      const digits = contact.replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) {
        return res
          .status(400)
          .json({ error: "El número de WhatsApp no es válido" });
      }
    }

    const id = randomUUID();

    await query(
      `INSERT INTO GiftCertificateRequest
        (id, amount, recipientName, senderName, message, receiveVia, contact, delivery)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        amount,
        recipientName,
        senderName,
        message || null,
        receiveVia,
        contact,
        delivery,
      ]
    );

    // No se espera: si el correo falla, la solicitud ya quedó guardada.
    sendGiftCertificateEmail({
      id,
      amount,
      recipientName,
      senderName,
      message,
      receiveVia,
      contact,
      delivery,
    });

    // El mensaje de WhatsApp es un extra: si todavía no guardas tu número en
    // el panel, la solicitud igual se registra y te llega por correo.
    let whatsappUrl = null;
    try {
      const settings = await getWhatsappSettings();
      if (settings) {
        whatsappUrl = buildGiftCertificateWhatsappUrl({
          settings,
          requestId: id,
          amount,
          recipientName,
          senderName,
          delivery,
        });
      }
    } catch (whatsappError) {
      console.error("No se pudo armar el link de WhatsApp:", whatsappError);
    }

    res.status(201).json({
      ok: true,
      reference: id.slice(-8).toUpperCase(),
      whatsappUrl,
    });
  } catch (error) {
    console.error("Error guardando la solicitud de certificado:", error);
    res.status(500).json({ error: "No se pudo enviar la solicitud" });
  }
});

// GET /api/gift-certificates — SOLO ADMIN: las nuevas primero.
giftCertificatesRouter.get("/", requireAdmin, async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, amount, recipientName, senderName, message, receiveVia,
              contact, delivery, status, createdAt
       FROM GiftCertificateRequest
       ORDER BY createdAt DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error("Error listando certificados:", error);
    res.status(500).json({ error: "Error al listar las solicitudes" });
  }
});

// PUT /api/gift-certificates/:id/status — SOLO ADMIN.
giftCertificatesRouter.put("/:id/status", requireAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};

    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: "Estado no válido" });
    }

    const result = await query(
      "UPDATE GiftCertificateRequest SET status = ? WHERE id = ?",
      [status, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Solicitud no encontrada" });
    }

    res.json({ ok: true, status });
  } catch (error) {
    console.error("Error actualizando el estado:", error);
    res.status(500).json({ error: "No se pudo actualizar el estado" });
  }
});