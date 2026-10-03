// src/routes/content.js
import { Router } from "express";
import { pool, query, queryOne } from "../lib/db.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

export const contentRouter = Router();

// Helper: convierte el valor guardado (longtext) en objeto JS.
// Si por alguna razón ya viniera como objeto, lo devuelve tal cual.
function parseValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

// GET /api/content — devuelve TODOS los bloques en una sola petición.
contentRouter.get("/", async (req, res) => {
  try {
    const rows = await query("SELECT `key`, value FROM SiteContent");
    const content = {};
    for (const row of rows) {
      content[row.key] = parseValue(row.value);
    }
    res.json(content);
  } catch (error) {
    console.error("Error obteniendo contenido:", error);
    res.status(500).json({ error: "Error al obtener el contenido" });
  }
});

// PUT /api/content/:key — crea o actualiza un bloque (admin).
contentRouter.put("/:key", requireAdmin, async (req, res) => {
  try {
    const { key } = req.params;
    const value = req.body;

    await pool.query(
      `INSERT INTO SiteContent (\`key\`, value)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value)`,
      [key, JSON.stringify(value)]
    );

    const updated = await queryOne(
      "SELECT value FROM SiteContent WHERE `key` = ?",
      [key]
    );

    res.json(parseValue(updated.value));
  } catch (error) {
    console.error("Error guardando contenido:", error);
    res.status(500).json({ error: "No se pudo guardar el contenido" });
  }
});
