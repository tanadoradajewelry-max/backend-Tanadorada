import rateLimit from "express-rate-limit";

// Para las rutas protegidas con contraseña de admin (login, crear/editar/
// borrar productos, contenido). Pocos intentos, para frenar fuerza bruta
// contra la contraseña.
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 30, // 30 intentos por IP en esa ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos. Espera unos minutos e intenta de nuevo." },
});

// Para crear órdenes — público por diseño, pero sin límite alguien podría
// spamear pedidos falsos y gastar tus límites de la API de PixelPay.
export const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 intentos de compra por IP cada 15 minutos
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de compra. Espera unos minutos." },
});