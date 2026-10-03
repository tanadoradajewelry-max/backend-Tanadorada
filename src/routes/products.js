// src/routes/products.js
import { Router } from "express";
import { query, queryOne } from "../lib/db.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { slugify } from "../lib/slugify.js";

export const productsRouter = Router();

// --- Lectura pública ---

productsRouter.get("/", async (req, res) => {
  try {
    const products = await query(
      "SELECT * FROM Product ORDER BY createdAt ASC"
    );
    res.json(products);
  } catch (error) {
    console.error("Error listando productos:", error);
    res.status(500).json({ error: "Error al listar productos" });
  }
});

productsRouter.get("/:id", async (req, res) => {
  try {
    const product = await queryOne(
      "SELECT * FROM Product WHERE id = ?",
      [req.params.id]
    );

    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    res.json(product);
  } catch (error) {
    console.error("Error obteniendo producto:", error);
    res.status(500).json({ error: "Error al obtener producto" });
  }
});

// --- Escritura, protegida con contraseña de admin ---

productsRouter.post("/", requireAdmin, async (req, res) => {
  try {
    const { title, price, image, badge } = req.body;

    if (!title || !price || !image) {
      return res.status(400).json({
        error: "Faltan campos: title, price e image son obligatorios",
      });
    }

    const baseId = slugify(title);
    let id = baseId;
    let suffix = 1;

    // Verifica si ya existe el slug, y agrega -2, -3, etc.
    while (await queryOne("SELECT id FROM Product WHERE id = ?", [id])) {
      suffix += 1;
      id = `${baseId}-${suffix}`;
    }

    await query(
      "INSERT INTO Product (id, title, price, image, badge) VALUES (?, ?, ?, ?, ?)",
      [id, title, Number(price), image, badge || null]
    );

    const product = await queryOne("SELECT * FROM Product WHERE id = ?", [id]);
    res.status(201).json(product);
  } catch (error) {
    console.error("Error creando producto:", error);
    res.status(500).json({ error: "No se pudo crear el producto" });
  }
});

productsRouter.put("/:id", requireAdmin, async (req, res) => {
  try {
    const { title, price, image, badge } = req.body;

    // Verifica que exista
    const existing = await queryOne(
      "SELECT id FROM Product WHERE id = ?",
      [req.params.id]
    );
    if (!existing) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // Construye el UPDATE dinámicamente solo con los campos enviados
    const fields = [];
    const values = [];

    if (title !== undefined) { fields.push("title = ?"); values.push(title); }
    if (price !== undefined) { fields.push("price = ?"); values.push(Number(price)); }
    if (image !== undefined) { fields.push("image = ?"); values.push(image); }
    if (badge !== undefined) { fields.push("badge = ?"); values.push(badge || null); }

    if (fields.length > 0) {
      values.push(req.params.id);
      await query(
        `UPDATE Product SET ${fields.join(", ")} WHERE id = ?`,
        values
      );
    }

    const product = await queryOne(
      "SELECT * FROM Product WHERE id = ?",
      [req.params.id]
    );
    res.json(product);
  } catch (error) {
    console.error("Error actualizando producto:", error);
    res.status(500).json({ error: "No se pudo actualizar el producto" });
  }
});

productsRouter.delete("/:id", requireAdmin, async (req, res) => {
  try {
    const result = await query("DELETE FROM Product WHERE id = ?", [
      req.params.id,
    ]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    res.status(204).end();
  } catch (error) {
    console.error("Error eliminando producto:", error);
    res.status(500).json({ error: "No se pudo eliminar el producto" });
  }
});