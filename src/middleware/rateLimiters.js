import rateLimit from "express-rate-limit";

// Rutas de admin: SOLO cuentan los intentos que fallan (status 400 o más,
// por ejemplo contraseña equivocada). Subir fotos o editar muchas veces
// seguidas, cuando todo sale bien, nunca te bloquea.
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." },
});

// Crear pedidos es público por diseño; este tope evita que alguien
// spamee pedidos falsos.
export const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de compra. Espera unos minutos." },
});
