// Protección mínima para no dejar las rutas de creación/edición/borrado
// abiertas a cualquiera. No es un sistema de usuarios real (no hay tabla
// de admins ni JWT), es una contraseña única compartida — suficiente
// mientras seas tú el único que administra la tienda. Si más adelante
// quieres que varias personas administren con sus propias cuentas,
// esto se reemplaza por un login con tabla de usuarios + JWT.
export function requireAdmin(req, res, next) {
  const providedPassword = req.headers["x-admin-password"];

  if (!process.env.ADMIN_PASSWORD) {
    return res
      .status(500)
      .json({ error: "ADMIN_PASSWORD no está configurado en el servidor" });
  }

  if (providedPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Contraseña de admin incorrecta" });
  }

  next();
}
