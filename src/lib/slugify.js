// Convierte "Collar Gitana Gold" -> "collar-gitana-gold", quitando acentos
// y caracteres raros. Se usa como id del producto cuando se crea desde
// el panel admin (en vez de pedirle al usuario que invente un id a mano).
export function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
