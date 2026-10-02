const PAYPAL_BASE_URL =
  process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

// PayPal exige un access token por cada sesión de llamadas (expira en ~9h,
// así que para un volumen bajo/medio es más simple pedirlo en cada request
// que andar cacheándolo con su propio riesgo de expiración silenciosa).
async function getAccessToken() {
  const credentials = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(`${PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`No se pudo autenticar con PayPal: ${errorBody}`);
  }

  const data = await response.json();
  return data.access_token;
}

// Crea una orden de pago en PayPal por el monto total ya calculado
// y verificado en el servidor (nunca confiar en un total que venga
// del frontend).
export async function createPaypalOrder({ orderId, amount, currency = "USD" }) {
  const accessToken = await getAccessToken();
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  const response = await fetch(`${PAYPAL_BASE_URL}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: orderId,
          amount: {
            currency_code: currency,
            value: amount.toFixed(2),
          },
        },
      ],
      // A dónde PayPal redirige al cliente después de aprobar o cancelar.
      application_context: {
        return_url: `${frontendUrl}/gracias?orderId=${orderId}`,
        cancel_url: `${frontendUrl}/checkout`,
        user_action: "PAY_NOW",
        brand_name: "TANADORADA",
      },
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`No se pudo crear la orden en PayPal: ${errorBody}`);
  }

  return response.json();
}

// Captura (cobra) una orden que el cliente ya aprobó en el checkout de PayPal.
export async function capturePaypalOrder(paypalOrderId) {
  const accessToken = await getAccessToken();

  const response = await fetch(
    `${PAYPAL_BASE_URL}/v2/checkout/orders/${paypalOrderId}/capture`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`No se pudo capturar el pago en PayPal: ${errorBody}`);
  }

  return response.json();
}
