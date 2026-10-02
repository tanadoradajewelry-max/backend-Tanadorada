import { createHmac, createHash } from "node:crypto";

const KEY_ID = process.env.PIXELPAY_KEY_ID;
const SECRET_KEY = process.env.PIXELPAY_SECRET_KEY;
const ENDPOINT = process.env.PIXELPAY_ENDPOINT || "pixelpay.app";
const MODE = process.env.PIXELPAY_MODE || "sandbox"; // "sandbox" | "live"
const APP_URL = `https://${ENDPOINT}`;

function getHostedRoute() {
  const segment = MODE === "live" ? "other" : "sandbox";
  return `https://${ENDPOINT}/api/v2/transaction/hosted/${segment}`;
}

// Firma requerida por PixelPay para el servicio hosted/payment/other:
// HMAC-SHA3-512 sobre "Key ID|order_id|app_url", firmado con el Secret Key.
// Va en el header x-client-signature (aquí la mandamos como campo
// _client_signature, que es como la espera este servicio en particular).
function buildClientSignature(orderId) {
  return createHmac("sha3-512", SECRET_KEY)
    .update([KEY_ID, orderId, APP_URL].join("|"))
    .digest("hex");
}

// Crea el link de pago hospedado. Devuelve la URL a la que hay que
// redirigir al cliente para que pague con su tarjeta.
export async function createHostedPayment({ orderId, amount, customer }) {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  const [firstName, ...rest] = customer.name.trim().split(" ");
  const lastName = rest.join(" ") || firstName; // fallback si solo mandan un nombre

  const params = new URLSearchParams({
    _key: KEY_ID,
    _client_signature: buildClientSignature(orderId),
    _order_id: orderId,
    _amount: amount.toFixed(2),
    _currency: "HNL",
    _first_name: firstName,
    _last_name: lastName,
    _email: customer.email,
    _complete: `${frontendUrl}/gracias?orderId=${orderId}`,
    _cancel: `${frontendUrl}/checkout`,
    json: "true",
  });

  const response = await fetch(getHostedRoute(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(
      `PixelPay rechazó la petición: ${JSON.stringify(data.errors)}`
    );
  }

  return data.url;
}

// Verifica el paymentHash que PixelPay agrega a la URL _complete cuando
// el cliente paga con éxito. Fórmula: md5(order_id|Key ID|Secret Key).
export function verifyPaymentHash(orderId, paymentHash) {
  if (!paymentHash) return false;

  const expected = createHash("md5")
    .update([orderId, KEY_ID, SECRET_KEY].join("|"))
    .digest("hex");

  return expected === paymentHash;
}