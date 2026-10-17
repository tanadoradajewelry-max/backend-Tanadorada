// Tallas de un producto. Se guardan como texto JSON en la columna "sizes":
//   [{ "label": "7", "price": 1000 }, { "label": "8", "price": 1100 }]
// Este archivo lo usan los productos (para guardar) y los pedidos (para
// calcular el precio real en el servidor).

export const MAX_SIZES = 12;

// Deja solo tallas válidas: con nombre, precio mayor a 0 y sin repetir.
export function cleanSizes(list) {
  if (!Array.isArray(list)) return [];

  const seen = new Set();
  const result = [];

  for (const item of list) {
    const label = String(item?.label ?? "").trim().slice(0, 30);
    const price = Math.round(Number(item?.price) * 100) / 100;

    if (!label || !Number.isFinite(price) || price <= 0) continue;

    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    result.push({ label, price });
    if (result.length === MAX_SIZES) break;
  }

  return result;
}

// Convierte lo que viene de la base de datos en una lista de tallas.
export function parseSizes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return cleanSizes(raw);

  try {
    return cleanSizes(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function minSizePrice(sizes) {
  return Math.min(...sizes.map((size) => size.price));
}