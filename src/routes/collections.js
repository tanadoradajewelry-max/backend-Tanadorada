import { Router } from "express";
import { query, queryOne } from "../lib/db.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { slugify } from "../lib/slugify.js";

export const collectionsRouter = Router();

// GET /api/collections                    -> todas
// GET /api/collections?category=anillos   -> solo las de esa categoría
collectionsRouter.get("/", async (req, res) => {
  try {
    // Solo se acepta texto (no objetos ni listas).
    const category =
      typeof req.query.category === "string" ? req.query.category : "";

    const collections = category
      ? await query(
          "SELECT * FROM Collection WHERE category = ? ORDER BY createdAt ASC",
          [category]
        )
      : await query("SELECT * FROM Collection ORDER BY createdAt ASC");

    res.json(collections);
  } catch (error) {
    console.error("Error listando colecciones:", error);
    res.status(500).json({ error: "Error al listar colecciones" });
  }
});

// POST /api/collections — crea una colección, siempre ligada a una categoría.
collectionsRouter.post("/", requireAdmin, async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const category =
      typeof req.body?.category === "string" ? req.body.category.trim() : "";

    if (!name || name.length > 120) {
      return res
        .status(400)
        .json({ error: "El nombre es obligatorio (máximo 120 caracteres)" });
    }
    if (!category) {
      return res.status(400).json({ error: "Debes elegir una categoría" });
    }

    const baseId = slugify(name) || "coleccion";
    let id = baseId;
    let suffix = 1;

    while (await queryOne("SELECT id FROM Collection WHERE id = ?", [id])) {
      suffix += 1;
      id = `${baseId}-${suffix}`;
    }

    await query("INSERT INTO Collection (id, name, category) VALUES (?, ?, ?)", [
      id,
      name,
      category,
    ]);

    const collection = await queryOne("SELECT * FROM Collection WHERE id = ?", [
      id,
    ]);
    res.status(201).json(collection);
  } catch (error) {
    console.error("Error creando colección:", error);
    res.status(500).json({ error: "No se pudo crear la colección" });
  }
});

// DELETE /api/collections/:id — borra la colección y limpia la etiqueta
// de los productos que la tenían (no borra los productos).
collectionsRouter.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const id = String(req.params.id);

    await query("UPDATE Product SET collection = NULL WHERE collection = ?", [
      id,
    ]);

    const result = await query("DELETE FROM Collection WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Colección no encontrada" });
    }

    res.status(204).end();
  } catch (error) {
    console.error("Error eliminando colección:", error);
    res.status(500).json({ error: "No se pudo eliminar la colección" });
  }
});
