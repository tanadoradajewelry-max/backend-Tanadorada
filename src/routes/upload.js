import { Router } from "express";
import multer from "multer";
import { requireAdmin } from "../middleware/requireAdmin.js";

// En memoria, no en disco — nunca tocamos el sistema de archivos del
// servidor, que no persiste entre despliegues en este hosting.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB (en base64 pesa ~33% más)
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Solo se permiten imágenes JPG, PNG o WEBP"));
    }
    cb(null, true);
  },
});

export const uploadRouter = Router();

uploadRouter.post("/", requireAdmin, upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No se recibió ninguna imagen" });
  }

  // Convierte el archivo a un "data URI" — un texto que el navegador
  // interpreta directo como imagen, sin necesitar ningún archivo real
  // guardado en ningún servidor. Esto se guarda tal cual en la columna
  // `image` de MySQL.
  const base64 = req.file.buffer.toString("base64");
  const dataUri = `data:${req.file.mimetype};base64,${base64}`;

  res.status(201).json({ url: dataUri });
});
