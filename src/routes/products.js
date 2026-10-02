import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { slugify } from "../lib/slugify.js";

export const productsRouter = Router();

// --- Lectura pública (la usa la tienda) ---

productsRouter.get("/", async (req, res) => {
  const products = await prisma.product.findMany({
    orderBy: { createdAt: "asc" },
  });
  res.json(products);
});

productsRouter.get("/:id", async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
  });

  if (!product) {
    return res.status(404).json({ error: "Producto no encontrado" });
  }

  res.json(product);
});

// --- Escritura, protegida con contraseña de admin ---

productsRouter.post("/", requireAdmin, async (req, res) => {
  try {
    const { title, price, image, badge } = req.body;

    if (!title || !price || !image) {
      return res
        .status(400)
        .json({ error: "Faltan campos: title, price e image son obligatorios" });
    }

    const baseId = slugify(title);
    let id = baseId;
    let suffix = 1;

    // Si ya existe un producto con ese slug, le agrega -2, -3, etc.
    while (await prisma.product.findUnique({ where: { id } })) {
      suffix += 1;
      id = `${baseId}-${suffix}`;
    }

    const product = await prisma.product.create({
      data: { id, title, price: Number(price), image, badge: badge || null },
    });

    res.status(201).json(product);
  } catch (error) {
    console.error("Error creando producto:", error);
    res.status(500).json({ error: "No se pudo crear el producto" });
  }
});

productsRouter.put("/:id", requireAdmin, async (req, res) => {
  try {
    const { title, price, image, badge } = req.body;

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data: {
        ...(title !== undefined && { title }),
        ...(price !== undefined && { price: Number(price) }),
        ...(image !== undefined && { image }),
        ...(badge !== undefined && { badge: badge || null }),
      },
    });

    res.json(product);
  } catch (error) {
    console.error("Error actualizando producto:", error);
    res.status(404).json({ error: "Producto no encontrado" });
  }
});

productsRouter.delete("/:id", requireAdmin, async (req, res) => {
  try {
    await prisma.product.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (error) {
    console.error("Error eliminando producto:", error);
    res.status(404).json({ error: "Producto no encontrado" });
  }
});
