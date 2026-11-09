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

// ---------------------------------------------------------------------------
// Índice de búsqueda en memoria: la consulta pesada corre 1 vez por minuto
// (o cuando guardas/borras un producto), no en cada tecla.
// ---------------------------------------------------------------------------
const SEARCH_MAX_RESULTS = 8;
const SEARCH_CACHE_MS = 60 * 1000;
let searchIndex = { data: null, expires: 0, loading: null };

// Se llama al crear, editar o borrar un producto para que el buscador
// muestre los cambios enseguida.
export function invalidateSearchIndex() {
  searchIndex.expires = 0;
}

const normalizeSearch = (text) =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function parseJsonValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function loadSearchIndex() {
  // "plainImage" es la foto solo cuando es una dirección corta (como
  // /img/3.jpg); si está guardada como base64 se deja vacía.
  const [rows, collectionRows, categoriesRow] = await Promise.all([
    query(
      `SELECT id, title, price, category, collection, sizes, stock,
              IF(LEFT(image, 5) = 'data:', NULL, image) AS plainImage
       FROM Product`
    ),
    query("SELECT id, name FROM Collection"),
    queryOne("SELECT value FROM SiteContent WHERE `key` = ?", ["categories"]),
  ]);

  const savedCategories = parseJsonValue(categoriesRow?.value);
  const categoryLabels = new Map(
    (Array.isArray(savedCategories) ? savedCategories : [])
      .filter((c) => c && typeof c.slug === "string")
      .map((c) => [c.slug, String(c.label ?? c.slug)])
  );
  const collectionNames = new Map(collectionRows.map((c) => [c.id, c.name]));

  // Todo se prepara una sola vez (texto normalizado, tallas ya convertidas).
  return rows.map((row) => {
    const categoryLabel =
      categoryLabels.get(row.category) ?? row.category ?? "";
    const collectionName = collectionNames.get(row.collection) ?? "";
    const title = normalizeSearch(row.title);

    return {
      row: { ...row, sizes: parseSizes(row.sizes) },
      title,
      categoryLabel,
      collectionName,
      haystack: [
        title,
        normalizeSearch(categoryLabel),
        normalizeSearch(row.category),
        normalizeSearch(collectionName),
      ].join(" "),
    };
  });
}

async function getSearchIndex() {
  if (searchIndex.data && searchIndex.expires > Date.now()) {
    return searchIndex.data;
  }

  // Si ya se está cargando, todos esperan la misma consulta.
  if (!searchIndex.loading) {
    searchIndex.loading = loadSearchIndex()
      .then((data) => {
        searchIndex = {
          data,
          expires: Date.now() + SEARCH_CACHE_MS,
          loading: null,
        };
        return data;
      })
      .catch((err) => {
        searchIndex.loading = null;
        throw err;
      });
  }

  return searchIndex.loading;
}

// --- Lectura pública ---
productsRouter.get("/", async (req, res) => {
  try {
    const { category, collection } = req.query;

    const conditions = [];
    const params = [];

    if (typeof category === "string" && category) {
      conditions.push("category = ?");
      params.push(category);
    }
    if (typeof collection === "string" && collection) {
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

// --- Buscador de la tienda (público) ---
// GET /api/products/search?q=anillo
// IMPORTANTE: debe ir ANTES de "/:id", si no Express toma "search" como un id.
productsRouter.get("/search", async (req, res) => {
  try {
    const term = normalizeSearch(String(req.query.q ?? "").slice(0, 60));

    if (term.length < 2) {
      return res.json({ results: [], total: 0 });
    }

    const index = await getSearchIndex();
    const tokens = term.split(" ");
    const matches = [];

    for (const entry of index) {
      // Cada palabra que escribió la persona tiene que aparecer en algún lado.
      if (!tokens.every((token) => entry.haystack.includes(token))) continue;

      // Primero los que empiezan igual, luego los que lo contienen, y al
      // final los que coinciden solo por categoría o colección.
      let rank = 3;
      if (entry.title.startsWith(term)) rank = 0;
      else if (entry.title.includes(term)) rank = 1;
      else if (tokens.every((token) => entry.title.includes(token))) rank = 2;

      matches.push({ rank, entry });
    }

    matches.sort(
      (a, b) =>
        a.rank - b.rank ||
        a.entry.row.title.localeCompare(b.entry.row.title, "es")
    );

    const results = matches.slice(0, SEARCH_MAX_RESULTS).map(({ entry }) => ({
      id: entry.row.id,
      title: entry.row.title,
      price: entry.row.price,
      sizes: entry.row.sizes,
      stock: entry.row.stock,
      plainImage: entry.row.plainImage,
      categoryLabel: entry.categoryLabel,
      collectionName: entry.collectionName,
    }));

    res.set("Cache-Control", "public, max-age=30");
    res.json({ results, total: matches.length });
  } catch (error) {
    console.error("Error en la búsqueda:", error);
    res.status(500).json({ error: "No se pudo buscar" });
  }
});

// --- Foto de un producto, servida como imagen real ---
// GET /api/products/:id/image/0  (0 = principal, 1 = segunda...)
// Lee solo las columnas necesarias y le dice al navegador que la guarde un
// día, así cada foto se pide una sola vez por visitante.
// IMPORTANTE: debe ir ANTES de "/:id".
productsRouter.get("/:id/image/:index", async (req, res) => {
  try {
    const index = Number.parseInt(req.params.index, 10);
    if (!Number.isInteger(index) || index < 0 || index >= MAX_IMAGES) {
      return res.status(404).end();
    }

    const row = await queryOne(
      "SELECT image, images FROM Product WHERE id = ?",
      [req.params.id]
    );
    if (!row) return res.status(404).end();

    let src = null;
    if (index === 0) {
      src = row.image;
    } else {
      const gallery = withGallery(row).images;
      src = gallery[index] || null;
    }
    if (!src) return res.status(404).end();

    // Foto guardada como base64: se convierte a imagen real.
    const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(src);
    if (match) {
      res.set({
        "Content-Type": match[1],
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      });
      return res.send(Buffer.from(match[2], "base64"));
    }

    // Foto guardada como dirección (por ejemplo /api/images/<id>).
    if (/^https?:\/\//i.test(src)) {
      res.set("Cache-Control", "public, max-age=3600");
      return res.redirect(302, src);
    }

    return res.status(404).end();
  } catch (error) {
    console.error("Error sirviendo foto del producto:", error);
    res.status(500).end();
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
    invalidateSearchIndex();
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

    if (title !== undefined) {
      fields.push("title = ?");
      values.push(title);
    }

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

    if (badge !== undefined) {
      fields.push("badge = ?");
      values.push(badge || null);
    }
    if (category !== undefined) {
      fields.push("category = ?");
      values.push(category || null);
    }
    if (collection !== undefined) {
      fields.push("collection = ?");
      values.push(collection || null);
    }

    if (fields.length > 0) {
      values.push(req.params.id);
      await query(
        `UPDATE Product SET ${fields.join(", ")} WHERE id = ?`,
        values
      );
    }

    const product = await queryOne("SELECT * FROM Product WHERE id = ?", [
      req.params.id,
    ]);
    invalidateSearchIndex();
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

    invalidateSearchIndex();
    res.status(204).end();
  } catch (error) {
    console.error("Error eliminando producto:", error);
    res.status(500).json({ error: "No se pudo eliminar el producto" });
  }
});
