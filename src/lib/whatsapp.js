import { queryOne } from "./db.js";

export const DEFAULT_INTRO =
  "Hola Tanadorada 👋 Quiero pagar mi pedido con tarjeta. ¿Me pueden enviar el link de pago, por favor?";

const GIFT_INTRO =
  "Hola Tanadorada 👋 Quiero comprar un certificado de regalo y pagarlo con tarjeta. ¿Me pueden enviar el link de pago, por favor?";

const GIFT_DELIVERY_TEXT = {
  personal: "Lo recibo yo para entregarlo personalmente",
  direct: "Que se envíe directamente al destinatario",
};

const MAX_INTRO = 300;
const MAX_LINES = 15; // líneas de productos en el mensaje (el resto se resume)

// La columna a veces llega como texto; esto la vuelve siempre objeto.
function parseValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Deja solo dígitos con código de país: "+504 9850-9853" y "9850-9853"
// terminan igual (50498509853). Devuelve null si no parece un teléfono.
export function normalizeWhatsappNumber(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  const full = digits.length === 8 ? `504${digits}` : digits;
  return full.length >= 10 && full.length <= 15 ? full : null;
}

// Número y saludo guardados en el panel (Contenido de página → WhatsApp).
// Devuelve null si todavía no hay un número válido.
export async function getWhatsappSettings() {
  const row = await queryOne("SELECT value FROM SiteContent WHERE `key` = ?", [
    "whatsapp",
  ]);
  const saved = row ? parseValue(row.value) : null;

  const number = normalizeWhatsappNumber(saved?.number);
  if (!number) return null;

  const intro =
    String(saved?.intro ?? "").trim().slice(0, MAX_INTRO) || DEFAULT_INTRO;

  return { number, intro };
}

const money = (amount) =>
  `L${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Arma el link de WhatsApp con el mensaje del pedido ya escrito.
export function buildWhatsappUrl({
  settings,
  orderId,
  customerName,
  items,
  subtotal,
}) {
  const lines = items
    .slice(0, MAX_LINES)
    .map(
      (item) =>
        `• ${item.title} × ${item.quantity} — ${money(item.price * item.quantity)}`
    );

  if (items.length > MAX_LINES) {
    lines.push(`• … y ${items.length - MAX_LINES} más`);
  }

  const name = String(customerName).replace(/\s+/g, " ").trim();

  const text = [
    settings.intro,
    "",
    `Pedido #${orderId.slice(-8).toUpperCase()}`,
    ...lines,
    "",
    `Total: ${money(subtotal)} HNL`,
    `Nombre: ${name}`,
  ].join("\n");

  return `https://wa.me/${settings.number}?text=${encodeURIComponent(text)}`;
}

// Link de WhatsApp para pedir el link de pago de un certificado de regalo.
export function buildGiftCertificateWhatsappUrl({
  settings,
  requestId,
  amount,
  recipientName,
  senderName,
  delivery,
}) {
  const text = [
    GIFT_INTRO,
    "",
    `Certificado de regalo #${requestId.slice(-8).toUpperCase()}`,
    `Monto: ${money(amount)} HNL`,
    `Para: ${recipientName}`,
    `De: ${senderName}`,
    `Entrega: ${GIFT_DELIVERY_TEXT[delivery] ?? delivery}`,
  ].join("\n");

  return `https://wa.me/${settings.number}?text=${encodeURIComponent(text)}`;
}
