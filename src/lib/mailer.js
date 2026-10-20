import nodemailer from "nodemailer";

let transporter = null;

// Aquí llegan los pedidos pagados y las solicitudes de Charm Bar.
const NOTIFY_TO =
  process.env.STORE_NOTIFICATION_EMAIL || "tanadoradajewelry@gmail.com";

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // true para 465, false para 587
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return transporter;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const oneLine = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();

function buildItemsHtml(items) {
  return items
    .map(
      (item) =>
        `<li>${escapeHtml(item.title)} × ${item.quantity} — $${(item.price * item.quantity).toFixed(2)} LPS</li>`
    )
    .join("");
}

function smtpReady(label, id) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(`SMTP no configurado en .env — se omite ${label}`, id);
    return false;
  }
  return true;
}

// Se llama una vez, justo después de que un pago se confirma.
// Correo 1: al dueño (notificación de venta). Correo 2: al cliente (recibo).
export async function sendOrderEmails(order) {
  if (!smtpReady("el envío de correos de la orden", order.id)) return;

  const t = getTransporter();
  const shortId = order.id.slice(-8);
  const itemsHtml = buildItemsHtml(order.items);
  const from = `"TANADORADA" <${process.env.SMTP_USER}>`;

  try {
    await t.sendMail({
      from,
      to: NOTIFY_TO,
      replyTo: order.email,
      subject: `🛍️ Nuevo pedido pagado #${shortId} — ${oneLine(order.customerName)}`,
      html: `
        <h2>Nuevo pedido pagado</h2>
        <p><strong>Cliente:</strong> ${escapeHtml(order.customerName)} (${escapeHtml(order.email)})</p>
        <p><strong>Teléfono:</strong> ${escapeHtml(order.phone)}</p>
        <p><strong>Dirección:</strong> ${escapeHtml(order.address)}, ${escapeHtml(order.city)}</p>
        <ul>${itemsHtml}</ul>
        <p><strong>Total:</strong> $${Number(order.subtotal).toFixed(2)} LPS</p>
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
        <h2>¡Gracias por tu compra, ${escapeHtml(order.customerName)}!</h2>
        <p>Tu pedido fue confirmado con el siguiente detalle:</p>
        <ul>${itemsHtml}</ul>
        <p><strong>Total pagado:</strong> $${Number(order.subtotal).toFixed(2)} LPS</p>
        <p>Te vamos a contactar pronto para coordinar el envío.</p>
      `,
    });
  } catch (error) {
    console.error("No se pudo enviar el correo de confirmación al cliente:", error);
  }
}

// Aviso al dueño cuando entra una solicitud de Charm Bar Experience.
// Al darle "Responder" en el correo, la respuesta va directo al cliente.
export async function sendCharmBarEmail(request) {
  if (!smtpReady("el correo de Charm Bar", request.id)) return;

  const [year, month, day] = request.eventDate.split("-");

  const rows = [
    ["Nombre", request.fullName],
    ["Empresa o marca", request.company],
    ["WhatsApp / teléfono", request.phone],
    ["Correo", request.email],
    ["Ocasión", request.occasion],
    ["Fecha del evento", `${day}/${month}/${year}`],
    ["Invitados", request.guests],
    ["Tipo de lugar", request.venueType],
    ["Ciudad y lugar", request.location],
    ["Tipo de experiencia", request.experienceType],
    ["Qué personalizar", request.customize],
    ["Duración", request.duration],
    ["Presupuesto", request.budget],
    ["Más detalles", request.details],
    ["Cómo nos conoció", request.source],
  ];

  const rowsHtml = rows
    .filter(([, value]) => value)
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:6px 14px 6px 0;color:#777;vertical-align:top"><strong>${escapeHtml(label)}</strong></td>
          <td style="padding:6px 0">${escapeHtml(value).replace(/\n/g, "<br>")}</td>
        </tr>`
    )
    .join("");

  try {
    await getTransporter().sendMail({
      from: `"TANADORADA" <${process.env.SMTP_USER}>`,
      to: NOTIFY_TO,
      replyTo: request.email,
      subject: `💎 Nueva solicitud Charm Bar — ${oneLine(request.fullName)} (${oneLine(request.occasion)})`,
      html: `
        <h2>Nueva solicitud de Charm Bar Experience</h2>
        <table style="border-collapse:collapse;font-size:14px">${rowsHtml}</table>
        <p style="color:#777;font-size:12px;margin-top:18px">
          Puedes marcarla como contactada desde el panel, en la pestaña Charm Bar.
        </p>
      `,
    });
  } catch (error) {
    console.error("No se pudo enviar el correo de Charm Bar:", error);
  }
}

// Para comprobar que el SMTP funciona. Lanza error si algo falla.
export async function sendTestEmail() {
  await getTransporter().sendMail({
    from: `"TANADORADA" <${process.env.SMTP_USER}>`,
    to: NOTIFY_TO,
    subject: "✅ Prueba de correo — TANADORADA",
    html: "<p>Si ves esto, los correos de pedidos y Charm Bar están funcionando.</p>",
  });
}
