import { Router } from "express";
import { pool, query, queryOne } from "../lib/db.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

export const contentRouter = Router();

// GET /api/content — devuelve TODOS los bloques de una vez, como un
// objeto { hero: {...}, category_strip: [...], ... }. Así el frontend
// hace una sola petición al cargar la portada.
contentRouter.get("/", async (req, res) => {
  try {
    const rows = await query("SELECT `key`, value FROM SiteContent");
    const content = {};
    rows.forEach((row) => {
      content[row.key] = row.value;
    });
    res.json(content);
  } catch (error) {
    console.error("Error obteniendo contenido:", error);
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
    res.json(updated.value);
  } catch (error) {
    console.error("Error guardando contenido:", error);
    res.status(500).json({ error: "No se pudo guardar el contenido" });
  }
});