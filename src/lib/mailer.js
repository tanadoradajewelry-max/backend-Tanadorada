import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // true para el puerto 465, false para 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

function buildItemsHtml(items) {
  return items
    .map(
      (item) =>
        `<li>${item.title} × ${item.quantity} — $${(item.price * item.quantity).toFixed(2)} LPS</li>`
    )
    .join("");
}

// Se llama una sola vez, justo después de que un pago se confirma.
// Manda dos correos: uno al dueño de la tienda (notificación de venta)
// y otro al cliente (confirmación/recibo). Si el SMTP no está configurado
// o algún envío falla, solo se registra en consola — NUNCA debe tumbar
// el flujo de la orden, que ya se cobró y guardó correctamente.
export async function sendOrderEmails(order) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(
      "SMTP no configurado en .env — se omite el envío de correos de la orden",
      order.id
    );
    return;
  }

  const t = getTransporter();
  const shortId = order.id.slice(-8);
  const itemsHtml = buildItemsHtml(order.items);
  const from = `"TANADORADA" <${process.env.SMTP_USER}>`;

  try {
    await t.sendMail({
      from,
      to: process.env.STORE_NOTIFICATION_EMAIL || process.env.SMTP_USER,
      subject: `Nuevo pedido #${shortId} — ${order.customerName}`,
      html: `
        <h2>Nuevo pedido pagado</h2>
        <p><strong>Cliente:</strong> ${order.customerName} (${order.email})</p>
        <p><strong>Teléfono:</strong> ${order.phone}</p>
        <p><strong>Dirección:</strong> ${order.address}, ${order.city}</p>
        <ul>${itemsHtml}</ul>
        <p><strong>Total:</strong> $${order.subtotal.toFixed(2)} LPS</p>
      `,
    });
  } catch (error) {
    console.error("No se pudo enviar el correo de notificación al dueño:", error);
  }

  try {
    await t.sendMail({
      from,
      to: order.email,
      subject: `Confirmación de tu pedido #${shortId} — TANADORADA`,
      html: `
        <h2>¡Gracias por tu compra, ${order.customerName}!</h2>
        <p>Tu pedido fue confirmado con el siguiente detalle:</p>
        <ul>${itemsHtml}</ul>
        <p><strong>Total pagado:</strong> $${order.subtotal.toFixed(2)} LPS</p>
        <p>Te vamos a contactar pronto para coordinar el envío.</p>
      `,
    });
  } catch (error) {
    console.error("No se pudo enviar el correo de confirmación al cliente:", error);
  }
}
