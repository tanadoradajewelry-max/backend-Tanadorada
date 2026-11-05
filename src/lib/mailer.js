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

const lempiras = (amount) =>
  `L${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} HNL`;

const itemsListHtml = (items) =>
  items
    .map(
      (item) =>
        `<li>${escapeHtml(item.title)} × ${item.quantity} — ${lempiras(item.price * item.quantity)}</li>`
    )
    .join("");

// Aviso a la dueña: entró un pedido nuevo que espera el link de pago por
// WhatsApp. El pedido ya quedó guardado; si el correo falla, solo se registra.
export async function sendOrderRequestEmail(order) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(
      "SMTP no configurado en .env — se omite el aviso de pedido nuevo",
      order.id
    );
    return;
  }

  try {
    const shortId = order.id.slice(-8).toUpperCase();

    const digits = String(order.phone || "").replace(/\D/g, "");
    const waNumber = digits.length === 8 ? `504${digits}` : digits;
    const phoneHtml = waNumber
      ? `<a href="https://wa.me/${waNumber}">${escapeHtml(order.phone)}</a>`
      : escapeHtml(order.phone);

    const base = (process.env.FRONTEND_URL || "")
      .split(",")[0]
      .trim()
      .replace(/\/$/, "");
    const panelLink = base
      ? `<p><a href="${escapeHtml(base)}/admin/pedidos">Abrir los pedidos en el panel</a></p>`
      : "";

    await getTransporter().sendMail({
      from: `"TANADORADA" <${process.env.SMTP_USER}>`,
      to: process.env.STORE_NOTIFICATION_EMAIL || process.env.SMTP_USER,
      replyTo: order.email,
      subject: `Nuevo pedido #${shortId} — ${oneLine(order.customerName)} (espera link de pago)`,
      html: `
        <h2>Nuevo pedido #${shortId}</h2>
        <p>El cliente fue enviado a WhatsApp para pedirte el link de pago con tarjeta.
        Cuando te pague, márcalo como <strong>Pagado</strong> en el panel: se descuenta
        el stock y recibe su confirmación.</p>
        <p><strong>Cliente:</strong> ${escapeHtml(order.customerName)} (${escapeHtml(order.email)})</p>
        <p><strong>WhatsApp / teléfono:</strong> ${phoneHtml}</p>
        <p><strong>Dirección:</strong> ${escapeHtml(order.address)}, ${escapeHtml(order.city)}</p>
        <ul>${itemsListHtml(order.items)}</ul>
        <p><strong>Total:</strong> ${lempiras(order.subtotal)}</p>
        ${panelLink}
      `,
    });
  } catch (error) {
    console.error("No se pudo enviar el aviso de pedido nuevo:", error);
  }
}

// Confirmación al cliente cuando marcas su pedido como pagado.
export async function sendPaymentConfirmedEmail(order) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(
      "SMTP no configurado en .env — se omite la confirmación de pago",
      order.id
    );
    return;
  }

  try {
    const shortId = order.id.slice(-8).toUpperCase();

    await getTransporter().sendMail({
      from: `"TANADORADA" <${process.env.SMTP_USER}>`,
      to: order.email,
      subject: `Recibimos tu pago — pedido #${shortId} — TANADORADA`,
      html: `
        <h2>¡Gracias por tu compra, ${escapeHtml(order.customerName)}!</h2>
        <p>Confirmamos tu pago. Este es el detalle de tu pedido #${shortId}:</p>
        <ul>${itemsListHtml(order.items)}</ul>
        <p><strong>Total pagado:</strong> ${lempiras(order.subtotal)}</p>
        <p>Te vamos a contactar pronto para coordinar el envío.</p>
      `,
    });
  } catch (error) {
    console.error("No se pudo enviar la confirmación de pago:", error);
  }
}

// Aviso al dueño cuando entra una solicitud de Charm Bar Experience.
export async function sendCharmBarEmail(request) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(
      "SMTP no configurado en .env — se omite el correo de Charm Bar",
      request.id
    );
    return;
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
}

// Aviso a la dueña cuando entra una solicitud de certificado de regalo.
export async function sendGiftCertificateEmail(request) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn(
      "SMTP no configurado en .env — se omite el correo del certificado",
      request.id
    );
    return;
  }

  try {
    const code = request.id.slice(-8).toUpperCase();
    const isEmail = request.receiveVia === "email";

    const deliveryText =
      request.delivery === "direct"
        ? "Que se envíe directamente al destinatario (pedirle sus datos por el chat)"
        : "Lo recibe quien compra, para entregarlo personalmente";

    let contactHtml;
    if (isEmail) {
      contactHtml = `<a href="mailto:${escapeHtml(request.contact)}">${escapeHtml(request.contact)}</a>`;
    } else {
      const digits = String(request.contact || "").replace(/\D/g, "");
      const waNumber = digits.length === 8 ? `504${digits}` : digits;
      contactHtml = waNumber
        ? `<a href="https://wa.me/${waNumber}">${escapeHtml(request.contact)}</a>`
        : escapeHtml(request.contact);
    }

    const textRows = [
      ["Monto", lempiras(request.amount)],
      ["Para", request.recipientName],
      ["De parte de", request.senderName],
      ["Mensaje personalizado", request.message],
      ["Modalidad de entrega", deliveryText],
      ["Recibirlo por", isEmail ? "Correo electrónico" : "WhatsApp"],
    ];

    const cell = (label, valueHtml) =>
      `<tr>
        <td style="padding:6px 14px 6px 0;color:#777;vertical-align:top"><strong>${escapeHtml(label)}</strong></td>
        <td style="padding:6px 0">${valueHtml}</td>
      </tr>`;

    const rowsHtml =
      textRows
        .filter(([, value]) => value)
        .map(([label, value]) =>
          cell(label, escapeHtml(value).replace(/\n/g, "<br>"))
        )
        .join("") + cell("Contacto", contactHtml);

    const base = (process.env.FRONTEND_URL || "")
      .split(",")[0]
      .trim()
      .replace(/\/$/, "");
    const panelLink = base
      ? `<p><a href="${escapeHtml(base)}/admin/certificados">Abrir los certificados en el panel</a></p>`
      : "";

    await getTransporter().sendMail({
      from: `"TANADORADA" <${process.env.SMTP_USER}>`,
      to: process.env.STORE_NOTIFICATION_EMAIL || process.env.SMTP_USER,
      ...(isEmail ? { replyTo: request.contact } : {}),
      subject: `Certificado de regalo #${code} — ${lempiras(request.amount)} — ${oneLine(request.senderName)}`,
      html: `
        <h2>Nueva solicitud de certificado de regalo #${code}</h2>
        <p>La clienta fue enviada a WhatsApp para pedirte el link de pago con tarjeta.
        Cuando te pague, cámbiala a <strong>Pagada</strong> en el panel.</p>
        <table style="border-collapse:collapse;font-size:14px">${rowsHtml}</table>
        ${panelLink}
      `,
    });
  } catch (error) {
    console.error("No se pudo enviar el correo del certificado:", error);
  }
}

// ✅ NUEVA FUNCIÓN AGREGADA: Aviso de stock bajo
export async function sendLowStockEmail(alerts) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("SMTP no configurado en .env — se omite el aviso de stock bajo");
    return;
  }

  try {
    const alertsHtml = alerts
      .map(
        (alert) =>
          `<li><strong>${escapeHtml(alert.title)}</strong> — Quedan solo <strong>${alert.stock}</strong> piezas.</li>`
      )
      .join("");

    await getTransporter().sendMail({
      from: `"TANADORADA" <${process.env.SMTP_USER}>`,
      to: process.env.STORE_NOTIFICATION_EMAIL || process.env.SMTP_USER,
      subject: `⚠️ Alerta de Stock Bajo — TANADORADA`,
      html: `
        <h2>Alerta de Stock Bajo</h2>
        <p>Los siguientes productos se están agotando (quedan menos de 10):</p>
        <ul>${alertsHtml}</ul>
        <p>Entra a tu panel de administrador para actualizar el inventario.</p>
      `,
    });
  } catch (error) {
    console.error("No se pudo enviar el correo de stock bajo:", error);
  }
}
