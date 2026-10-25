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

// Todo lo que escribe una persona en un formulario se "escapa" antes de
// meterlo en el HTML de un correo, para que no pueda colar código.
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Para el asunto del correo: sin saltos de línea.
const oneLine = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();

function buildItemsHtml(items) {
  return items
    .map(
      (item) =>
        `<li>${escapeHtml(item.title)} × ${item.quantity} — $${(item.price * item.quantity).toFixed(2)} LPS</li>`
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
      subject: `Nuevo pedido #${shortId} — ${oneLine(order.customerName)}`,
      html: `
        <h2>Nuevo pedido pagado</h2>
        <p><strong>Cliente:</strong> ${escapeHtml(order.customerName)} (${escapeHtml(order.email)})</p>
        <p><strong>Teléfono:</strong> ${escapeHtml(order.phone)}</p>
        <p><strong>Dirección:</strong> ${escapeHtml(order.address)}, ${escapeHtml(order.city)}</p>
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
        <h2>¡Gracias por tu compra, ${escapeHtml(order.customerName)}!</h2>
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

// Aviso a la dueña cuando, después de una venta, a uno o más productos les
// quedan pocas piezas. "alerts": [{ id, title, remaining, oversold }]
export async function sendLowStockEmail(alerts) {
  if (!alerts?.length) return;

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("SMTP no configurado en .env — se omite el aviso de stock bajo");
    return;
  }

  try {
    const soldOut = alerts.filter((a) => a.remaining === 0);

    const subject =
      alerts.length === 1
        ? soldOut.length
          ? `Agotado: ${oneLine(alerts[0].title)}`
          : `Stock bajo: ${oneLine(alerts[0].title)} (quedan ${alerts[0].remaining})`
        : `Stock bajo en ${alerts.length} productos${
            soldOut.length
              ? ` (${soldOut.length} ${soldOut.length === 1 ? "agotado" : "agotados"})`
              : ""
          }`;

    const rowsHtml = alerts
      .map((a) => {
        const status =
          a.remaining === 0
            ? '<strong style="color:#B4453D">AGOTADO</strong>'
            : `Quedan <strong>${a.remaining}</strong>`;

        const note =
          a.oversold > 0
            ? `<br><span style="color:#B4453D;font-size:12px">Se vendieron ${a.oversold} más de las que había. Revisa ese pedido.</span>`
            : "";

        return `<tr>
          <td style="padding:6px 18px 6px 0">${escapeHtml(a.title)}</td>
          <td style="padding:6px 0">${status}${note}</td>
        </tr>`;
      })
      .join("");

    // Enlace al panel, si FRONTEND_URL está configurada.
    const base = (process.env.FRONTEND_URL || "")
      .split(",")[0]
      .trim()
      .replace(/\/$/, "");

    const panelLink = base
      ? `<p><a href="${escapeHtml(base)}/admin">Abrir el panel</a> para actualizar el stock.</p>`
      : "<p>Entra al panel, en Productos → Editar, para actualizar el stock.</p>";

    await getTransporter().sendMail({
      from: `"TANADORADA" <${process.env.SMTP_USER}>`,
      to: process.env.STORE_NOTIFICATION_EMAIL || process.env.SMTP_USER,
      subject,
      html: `
        <h2>Aviso de stock</h2>
        <p>Después de la última venta, estos productos tienen pocas piezas:</p>
        <table style="border-collapse:collapse;font-size:14px">${rowsHtml}</table>
        ${panelLink}
      `,
    });
  } catch (error) {
    console.error("No se pudo enviar el aviso de stock bajo:", error);
  }
}

  
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
      to: process.env.STORE_NOTIFICATION_EMAIL || process.env.SMTP_USER,
      replyTo: request.email,
      subject: `Nueva solicitud Charm Bar — ${oneLine(request.fullName)} (${oneLine(request.occasion)})`,
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
