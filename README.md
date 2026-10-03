# Tanadorada API

## Arrancar en local

1. `npm install`
2. Copia `.env.example` a `.env` y llena los valores (necesitas Postgres corriendo
   local o remoto, y credenciales de PayPal sandbox desde
   https://developer.paypal.com -> My Apps & Credentials -> Sandbox).
3. `npx prisma migrate dev --name init` — crea las tablas en tu base de datos.
4. `npm run seed` — carga los 4 productos de ejemplo.
5. `npm run dev` — levanta la API en http://localhost:4000

## Endpoints

- `GET  /api/products` — lista de productos
- `GET  /api/products/:id` — un producto
- `POST /api/orders` — crea una orden + una orden de pago en PayPal
- `POST /api/orders/:id/capture` — captura (cobra) el pago después de que
  el cliente aprueba en PayPal
- `GET  /api/orders/:id` — detalle de una orden (para la página de
  confirmación)

## Flujo de pago (PayPal Orders API v2, sin SDK)

1. El frontend manda `POST /api/orders` con los datos del cliente y los
   items del carrito (solo `productId` y `quantity` — el precio SIEMPRE
   se recalcula del lado del servidor, nunca se confía en el que mande
   el navegador).
2. La API crea la orden en la base de datos con estado `pending`, crea la
   orden correspondiente en PayPal, y devuelve `approveUrl`.
3. El frontend redirige al cliente a `approveUrl` para que apruebe el pago
   en PayPal.
4. PayPal redirige de vuelta a tu sitio (a una URL que tú defines al crear
   la orden — falta agregar `application_context.return_url` en
   `src/lib/paypal.js` cuando conectes esto con el frontend).
5. El frontend llama `POST /api/orders/:id/capture` para cobrar
   efectivamente el pago, y la orden pasa a estado `paid`.

## Pendiente para producción

- Agregar `application_context` (return_url / cancel_url) en
  `createPaypalOrder` para que PayPal sepa a dónde redirigir.
- Verificar webhooks de PayPal (evento `PAYMENT.CAPTURE.COMPLETED`) como
  respaldo, por si el cliente cierra la pestaña antes de que el frontend
  llegue a llamar `/capture`.
- Migrar `PAYPAL_MODE` de `sandbox` a `live` con credenciales reales.
- Mover `DATABASE_URL` a la base de datos real del VPS.
