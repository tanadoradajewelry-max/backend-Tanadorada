import { Router } from "express";
import { randomUUID } from "node:crypto";
import { query } from "../lib/db.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { sendCharmBarEmail } from "../lib/mailer.js";

export const charmBarRouter = Router();

// En la página se muestra un límite de 200 caracteres para el texto libre;
// aquí se deja más holgado por si algún día subes ese número en el frontend.
const MAX_DETAILS = 500;

const STATUSES = ["new", "contacted", "closed"];

// Texto sin espacios de más y con un largo máximo.
const clean = (value, max) => String(value ?? "").trim().slice(0, max);
const orNull = (value) => value || null;

function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

// Desde ayer (así "hoy" en Honduras nunca se rechaza por la zona horaria del
// servidor) hasta 3 años adelante.
function isDateInRange(value) {
  const day = 24 * 60 * 60 * 1000;
  const min = new Date(Date.now() - day).toISOString().slice(0, 10);
  const max = new Date(Date.now() + 3 * 365 * day).toISOString().slice(0, 10);
  return value >= min && value <= max;
}

// POST /api/charm-bar — PÚBLICO: cualquier persona puede enviar el formulario.
charmBarRouter.post("/", async (req, res) => {
  try {
    const body = req.body || {};

    // Campo trampa: las personas no lo ven, los bots sí lo llenan.
    // Se responde "ok" sin guardar nada para no darles pistas.
    if (body.website) {
      return res.status(201).json({ ok: true });
    }

    const data = {
      occasion: clean(body.occasion, 120),
      guests: clean(body.guests, 120),
      venueType: clean(body.venueType, 160),
      location: clean(body.location, 200),
      experienceType: clean(body.experienceType, 255),
      customize: clean(body.customize, 160),
      eventDate: clean(body.eventDate, 10),
      duration: clean(body.duration, 120),
      budget: clean(body.budget, 100),
      details: clean(body.details, MAX_DETAILS),
      fullName: clean(body.fullName, 120),
      company: clean(body.company, 120),
      phone: clean(body.phone, 25),
      email: clean(body.email, 160),
      source: clean(body.source, 120),
    };

    const required = [
      "occasion",
      "guests",
      "venueType",
      "experienceType",
      "eventDate",
      "fullName",
      "phone",
      "email",
    ];
    if (required.some((key) => !data[key])) {
      return res
        .status(400)
        .json({ error: "Faltan campos obligatorios. Revisa el formulario." });
    }

    if (!isRealDate(data.eventDate) || !isDateInRange(data.eventDate)) {
      return res.status(400).json({ error: "La fecha del evento no es válida" });
    }

    if (data.phone.replace(/\D/g, "").length < 7) {
      return res.status(400).json({ error: "El teléfono no es válido" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return res.status(400).json({ error: "El correo no es válido" });
    }

    const id = randomUUID();

    await query(
      `INSERT INTO CharmBarRequest
        (id, occasion, guests, venueType, location, experienceType, customize,
         eventDate, duration, budget, details, fullName, company, phone, email, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.occasion,
        data.guests,
        data.venueType,
        orNull(data.location),
        data.experienceType,
        orNull(data.customize),
        data.eventDate,
        orNull(data.duration),
        orNull(data.budget),
        orNull(data.details),
        data.fullName,
        orNull(data.company),
        data.phone,
        data.email,
        orNull(data.source),
      ]
    );

    // No se espera: si el correo falla, la solicitud ya quedó guardada.
    sendCharmBarEmail({ id, ...data });

    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("Error guardando solicitud de Charm Bar:", error);
    res.status(500).json({ error: "No se pudo enviar la solicitud" });
  }
});

// GET /api/charm-bar — SOLO ADMIN: lista de solicitudes, las nuevas primero.
charmBarRouter.get("/", requireAdmin, async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, occasion, guests, venueType, location, experienceType,
              customize, DATE_FORMAT(eventDate, '%Y-%m-%d') AS eventDate,
              duration, budget, details, fullName, company, phone, email,
              source, status, createdAt
       FROM CharmBarRequest
       ORDER BY createdAt DESC`
    );
    res.json(rows);
  } catch (error) {
    console.error("Error listando solicitudes de Charm Bar:", error);
    res.status(500).json({ error: "Error al listar las solicitudes" });
  }
});

// PUT /api/charm-bar/:id/status — SOLO ADMIN: marcar como contactada o cerrada.
charmBarRouter.put("/:id/status", requireAdmin, async (req, res) => {
  try {
    const { status } = req.body || {};

    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: "Estado no válido" });
    }

    const result = await query(
      "UPDATE CharmBarRequest SET status = ? WHERE id = ?",
      [status, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Solicitud no encontrada" });
    }

    res.json({ ok: true, status });
  } catch (error) {
    console.error("Error actualizando estado:", error);
    res.status(500).json({ error: "No se pudo actualizar el estado" });
  }
});