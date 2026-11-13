import { Router } from "express";
import { pool, query, queryOne } from "../lib/db.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

export const contentRouter = Router();

// Bloques pesados (traen fotos) que NO se mandan en el listado general:
// la portada los descargaría sin usarlos. Cada uno se pide aparte,
// con GET /api/content/:key, solo donde se necesita.
const LIST_EXCLUDED_KEYS = new Set(["nav_previews", "charm_bar_media"]);

// MySQL/MariaDB a veces devuelve las columnas JSON como texto. Esto lo
// convierte siempre en objeto, sin importar cómo llegue.
function parseValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// GET /api/content — todos los bloques livianos de una vez (la portada).
contentRouter.get("/", async (req, res) => {
  try {
    const rows = await query("SELECT `key`, value FROM SiteContent");
    const content = {};
    rows.forEach((row) => {
      if (LIST_EXCLUDED_KEYS.has(row.key)) return;
      content[row.key] = parseValue(row.value);
    });
    res.json(content);
  } catch (error) {
    console.error("Error obteniendo contenido:", error);
    res.status(500).json({ error: "Error al obtener el contenido" });
  }
});

// GET /api/content/:key — UN solo bloque. Si todavía no existe devuelve
// null con status 200, así no sale error en la consola.
contentRouter.get("/:key", async (req, res) => {
  try {
    const row = await queryOne(
      "SELECT value FROM SiteContent WHERE `key` = ?",
      [req.params.key]
    );
    res.json(row ? parseValue(row.value) : null);
  } catch (error) {
    console.error("Error obteniendo bloque de contenido:", error);
    res.status(500).json({ error: "Error al obtener el contenido" });
  }
});

// PUT /api/content/:key — crea o actualiza un bloque completo (admin).
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
