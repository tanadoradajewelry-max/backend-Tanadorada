// src/routes/products.js
import { Router } from "express";
import { query, queryOne } from "../lib/db.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { slugify } from "../lib/slugify.js";
import { cleanSizes, parseSizes, minSizePrice } from "../lib/sizes.js";
import { parseStock } from "../lib/stock.js";

export const productsRouter = Router();

const MAX_IMAGES = 5;
const STOCK_ERROR = "El stock debe ser un número entero, 0 o mayor";

// El listado NO incluye "images" (la galería): las páginas de catálogo solo
// muestran la foto principal, y así no cargan 3 fotos por producto.
// Sí incluye "sizes" y "stock" (son cortos) para mostrar "Desde" y "Agotado".
const LIST_COLUMNS =
  "id, title, price, image, badge, category, collection, sizes, stock, createdAt";

function cleanImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((src) => typeof src === "string" && src.length > 0)
    .slice(0, MAX_IMAGES);
}

// La galería se guarda como texto JSON; aquí vuelve a ser una lista.
// Los productos viejos (sin galería) devuelven [image], así el frontend
// siempre recibe una lista.
function withGallery(row) {
  if (!row) return row;
  let images = [];
  if (row.images) {
    try {
      images = cleanImages(JSON.parse(row.images));
    } catch {
      images = [];
    }
  }
  if (images.length === 0 && row.image) images = [row.image];
  return { ...row, images };
}

// Las tallas también vuelven a ser una lista (vacía si no tiene).
function withSizes(row) {
  if (!row) return row;
  return { ...row, sizes: parseSizes(row.sizes) };
}

// --- Lectura pública ---
productsRouter.get("/", async (req, res) => {
  try {
    const { category, collection } = req.query;

    const conditions = [];
    const params = [];

    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }
    if (collection) {
      conditions.push("collection = ?");
      params.push(collection);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const products = await query(
      `SELECT ${LIST_COLUMNS} FROM Product ${where} ORDER BY createdAt ASC`,
      params
    );

    res.json(products.map(withSizes));
  } catch (error) {
    console.error("Error listando productos:", error);
    res.status(500).json({ error: "Error al listar productos" });
  }
});

productsRouter.get("/:id", async (req, res) => {
  try {
    const product = await queryOne("SELECT * FROM Product WHERE id = ?", [
      req.params.id,
    ]);

    if (!product) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    res.json(withSizes(withGallery(product)));
  } catch (error) {
    console.error("Error obteniendo producto:", error);
    res.status(500).json({ error: "Error al obtener producto" });
  }
});

// --- Escritura, protegida con contraseña de admin ---

productsRouter.post("/", requireAdmin, async (req, res) => {
  try {
    const {
      title,
      price,
      image,
      images,
      sizes,
      stock,
      badge,
      category,
      collection,
    } = req.body;

    const gallery = cleanImages(images);
    const mainImage = gallery[0] || image;

    // Con tallas, el precio del producto es el de la talla más barata.
    const sizeList = cleanSizes(sizes);
    const finalPrice = sizeList.length ? minSizePrice(sizeList) : Number(price);

    // Sin stock en la petición = el producto no controla stock.
    const stockValue = stock === undefined ? null : parseStock(stock);
    if (stockValue === undefined) {
      return res.status(400).json({ error: STOCK_ERROR });
    }

    if (!title || !mainImage || !(finalPrice > 0)) {
      return res.status(400).json({
        error: "Faltan campos: title, price e image son obligatorios",
      });
    }

    const baseId = slugify(title);
    let id = baseId;
    let suffix = 1;

    while (await queryOne("SELECT id FROM Product WHERE id = ?", [id])) {
      suffix += 1;
      id = `${baseId}-${suffix}`;
    }

    await query(
      "INSERT INTO Product (id, title, price, image, images, sizes, stock, badge, category, collection) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id,
        title,
        finalPrice,
        mainImage,
        gallery.length ? JSON.stringify(gallery) : null,
        sizeList.length ? JSON.stringify(sizeList) : null,
        stockValue,
        badge || null,
        category || null,
        collection || null,
      ]
    );

    const product = await queryOne("SELECT * FROM Product WHERE id = ?", [id]);
    res.status(201).json(withSizes(withGallery(product)));
  } catch (error) {
    console.error("Error creando producto:", error);
    res.status(500).json({ error: "No se pudo crear el producto" });
  }
});

productsRouter.put("/:id", requireAdmin, async (req, res) => {
  try {
    const {
      title,
      price,
      image,
      images,
      sizes,
      stock,
      badge,
      category,
      collection,
    } = req.body;

    const existing = await queryOne("SELECT id FROM Product WHERE id = ?", [
      req.params.id,
    ]);
    if (!existing) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }

    // Stock: si viene en la petición se reemplaza (vacío = dejar de
    // controlarlo); si no viene, no se toca.
    let stockValue;
    if (stock !== undefined) {
      stockValue = parseStock(stock);
      if (stockValue === undefined) {
        return res.status(400).json({ error: STOCK_ERROR });
      }
    }

    const fields = [];
    const values = [];

    if (title !== undefined) { fields.push("title = ?"); values.push(title); }

    // Tallas: si vienen en la petición se reemplazan por completo
    // (una lista vacía las quita todas).
    const sizeList = sizes !== undefined ? cleanSizes(sizes) : undefined;

    if (sizeList !== undefined) {
      fields.push("sizes = ?");
      values.push(sizeList.length ? JSON.stringify(sizeList) : null);
    }

    if (sizeList?.length) {
      // Con tallas, el precio del producto es el de la talla más barata.
      fields.push("price = ?");
      values.push(minSizePrice(sizeList));
    } else if (price !== undefined) {
      fields.push("price = ?");
      values.push(Number(price));
    }

    if (stock !== undefined) {
      fields.push("stock = ?");
      values.push(stockValue);
    }

    if (images !== undefined) {
      // Con galería: la primera foto es siempre la principal (image).
      const gallery = cleanImages(images);
      fields.push("images = ?");
      values.push(gallery.length ? JSON.stringify(gallery) : null);
      if (gallery.length) {
        fields.push("image = ?");
        values.push(gallery[0]);
      }
    } else if (image !== undefined) {
      fields.push("image = ?");
      values.push(image);
    }

    if (badge !== undefined) { fields.push("badge = ?"); values.push(badge || null); }
    if (category !== undefined) { fields.push("category = ?"); values.push(category || null); }
    if (collection !== undefined) { fields.push("collection = ?"); values.push(collection || null); }

    if (fields.length > 0) {
      values.push(req.params.id);
      await query(`UPDATE Product SET ${fields.join(", ")} WHERE id = ?`, values);
    }

    const product = await queryOne("SELECT * FROM Product WHERE id = ?", [
      req.params.id,
    ]);
    res.json(withSizes(withGallery(product)));
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
