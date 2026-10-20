import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { query, queryOne } from "../lib/db.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 }, // 2 MB
});

// Mira los primeros bytes del archivo. El "mimetype" lo manda el navegador
// y se puede falsificar; esto no.
function detectType(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

export const uploadRouter = Router(); // POST: solo admin
export const imagesRouter = Router(); // GET: público

uploadRouter.post(
  "/",
  requireAdmin,
  upload.single("image"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No se recibió ninguna imagen" });
      }

      const mime = detectType(req.file.buffer);
      if (!mime) {
        return res
          .status(400)
          .json({ error: "Solo se permiten imágenes JPG, PNG o WEBP" });
      }

      const id = randomUUID();
      await query("INSERT INTO Image (id, mime, data) VALUES (?, ?, ?)", [
        id,
        mime,
        req.file.buffer,
      ]);

      const base =
        process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
      res.status(201).json({ url: `${base.replace(/\/$/, "")}/api/images/${id}` });
    } catch (err) {
      next(err);
    }
  }
);

imagesRouter.get("/:id", async (req, res, next) => {
  try {
    const row = await queryOne("SELECT mime, data FROM Image WHERE id = ?", [
      String(req.params.id),
    ]);
    if (!row) return res.status(404).end();

    res.set({
      "Content-Type": row.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    res.send(row.data);
  } catch (err) {
    next(err);
  }
});
