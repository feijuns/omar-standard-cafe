function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function cleanText(value, maxLength = 500) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function money(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("zh-TW").format(money(value)) + "元";
}

function createOrderId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `OSC-${timestamp}-${suffix}`;
}

function normalizeOrder(input) {
  const customer = input && input.customer ? input.customer : {};
  const items = Array.isArray(input && input.items) ? input.items : [];
  const normalizedItems = items.slice(0, 80).map((item) => {
    const quantity = Math.max(1, Math.min(99, Math.round(Number(item.quantity) || 1)));
    const unitPrice = money(item.price);
    return {
      productId: cleanText(item.productId, 80),
      name: cleanText(item.name, 160),
      variant: cleanText(item.variant, 160),
      quantity,
      unitPrice,
      lineTotal: quantity * unitPrice,
    };
  }).filter((item) => item.name && item.variant && item.unitPrice > 0);

  const subtotal = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const shippingFee = subtotal === 0 || subtotal >= 1000 ? 0 : 60;

  return {
    id: createOrderId(),
    createdAt: new Date().toISOString(),
    customer: {
      name: cleanText(customer.name, 80),
      title: cleanText(customer.title, 20),
      phone: cleanText(customer.phone, 40),
      email: cleanText(customer.email, 160),
      line: cleanText(customer.line, 80),
    },
    shippingMethod: cleanText(input && input.shippingMethod, 80),
    deliveryDetail: cleanText(input && input.deliveryDetail, 500),
    paymentMethod: cleanText(input && input.paymentMethod, 80),
    note: cleanText(input && input.note, 1000),
    items: normalizedItems,
    totals: {
      subtotal,
      shippingFee,
      total: subtotal + shippingFee,
    },
  };
}

function validateOrder(order) {
  if (!order.items.length) return "請先加入商品到購物車";
  if (!order.customer.name) return "請填寫收件人姓名";
  if (!order.customer.phone) return "請填寫電話";
  if (!order.customer.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.customer.email)) return "請填寫正確 Email";
  if (!order.deliveryDetail) return "請填寫配送資料";
  if (!order.shippingMethod) return "請選擇配送方式";
  if (!order.paymentMethod) return "請選擇付款方式";
  return "";
}

async function saveOrder(env, order) {
  if (!env.DB) throw new Error("Cloudflare D1 尚未綁定，請設定 DB binding。");

  const inserts = [
    env.DB.prepare(`
      INSERT INTO orders (
        id, created_at, customer_name, customer_title, customer_phone, customer_email, customer_line,
        shipping_method, delivery_detail, payment_method, note, subtotal, shipping_fee, total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      order.id,
      order.createdAt,
      order.customer.name,
      order.customer.title,
      order.customer.phone,
      order.customer.email,
      order.customer.line,
      order.shippingMethod,
      order.deliveryDetail,
      order.paymentMethod,
      order.note,
      order.totals.subtotal,
      order.totals.shippingFee,
      order.totals.total,
    ),
    ...order.items.map((item) => env.DB.prepare(`
      INSERT INTO order_items (
        order_id, product_id, product_name, variant, quantity, unit_price, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      order.id,
      item.productId,
      item.name,
      item.variant,
      item.quantity,
      item.unitPrice,
      item.lineTotal,
    )),
  ];

  await env.DB.batch(inserts);
}

function orderText(order) {
  const itemLines = order.items.map((item) =>
    `${item.name}｜${item.variant}｜${item.quantity} x ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.lineTotal)}`
  ).join("\n");

  return [
    "Omar Standard Cafe 訂單通知",
    "",
    `訂單編號：${order.id}`,
    `訂單時間：${order.createdAt}`,
    `收件人：${order.customer.name} ${order.customer.title}`,
    `電話：${order.customer.phone}`,
    `Email：${order.customer.email}`,
    `Line：${order.customer.line || "-"}`,
    `配送方式：${order.shippingMethod}`,
    `配送資料：${order.deliveryDetail}`,
    `付款方式：${order.paymentMethod}`,
    `備註：${order.note || "-"}`,
    "",
    "訂購品項：",
    itemLines,
    "",
    `商品小計：${formatCurrency(order.totals.subtotal)}`,
    `運費：${formatCurrency(order.totals.shippingFee)}`,
    `總計：${formatCurrency(order.totals.total)}`,
    "",
    "付款資訊：",
    "玉山銀行 808",
    "帳號 0602-940-035211",
    "戶名 歐瑪標準咖啡工作室莊斐竣",
    "也可使用網站付款資訊中的 LINE PAY。",
  ].join("\n");
}

function orderHtml(order) {
  const rows = order.items.map((item) => `
    <tr>
      <td style="border-bottom:1px solid #e8e2dc;padding:8px 6px;">${escapeHtml(item.name)}</td>
      <td style="border-bottom:1px solid #e8e2dc;padding:8px 6px;">${escapeHtml(item.variant)}</td>
      <td style="border-bottom:1px solid #e8e2dc;padding:8px 6px;text-align:right;">${item.quantity}</td>
      <td style="border-bottom:1px solid #e8e2dc;padding:8px 6px;text-align:right;">${formatCurrency(item.unitPrice)}</td>
      <td style="border-bottom:1px solid #e8e2dc;padding:8px 6px;text-align:right;">${formatCurrency(item.lineTotal)}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family:Arial,'Noto Sans TC',sans-serif;line-height:1.7;color:#2f3a44;">
      <h2 style="margin:0 0 12px;">Omar Standard Cafe 訂單通知</h2>
      <p>
        <strong>訂單編號：</strong>${escapeHtml(order.id)}<br>
        <strong>訂單時間：</strong>${escapeHtml(order.createdAt)}
      </p>
      <p>
        <strong>收件人：</strong>${escapeHtml(order.customer.name)} ${escapeHtml(order.customer.title)}<br>
        <strong>電話：</strong>${escapeHtml(order.customer.phone)}<br>
        <strong>Email：</strong>${escapeHtml(order.customer.email)}<br>
        <strong>Line：</strong>${escapeHtml(order.customer.line || "-")}
      </p>
      <p>
        <strong>配送方式：</strong>${escapeHtml(order.shippingMethod)}<br>
        <strong>配送資料：</strong>${escapeHtml(order.deliveryDetail)}<br>
        <strong>付款方式：</strong>${escapeHtml(order.paymentMethod)}
      </p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:760px;">
        <thead>
          <tr style="background:#f4f1ed;text-align:left;">
            <th style="padding:8px 6px;">商品</th>
            <th style="padding:8px 6px;">規格</th>
            <th style="padding:8px 6px;text-align:right;">數量</th>
            <th style="padding:8px 6px;text-align:right;">單價</th>
            <th style="padding:8px 6px;text-align:right;">小計</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p>
        商品小計：${formatCurrency(order.totals.subtotal)}<br>
        運費：${formatCurrency(order.totals.shippingFee)}<br>
        <strong>總計：${formatCurrency(order.totals.total)}</strong>
      </p>
      <p><strong>備註：</strong>${escapeHtml(order.note || "-")}</p>
      <hr style="border:0;border-top:1px solid #e8e2dc;margin:20px 0;">
      <p>
        付款資訊：玉山銀行 808，帳號 0602-940-035211，戶名 歐瑪標準咖啡工作室莊斐竣。<br>
        也可使用網站付款資訊中的 LINE PAY。
      </p>
    </div>
  `;
}

async function sendResendEmail(env, message) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return { sent: false, warning: "尚未設定 RESEND_API_KEY 或 RESEND_FROM_EMAIL。" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: message.to,
      reply_to: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Resend 寄信失敗：${detail}`);
  }

  return { sent: true };
}

async function notifyOrder(env, order) {
  const ownerEmail = env.OWNER_EMAIL || "feijuns@gmail.com";
  const text = orderText(order);
  const html = orderHtml(order);
  const ownerSubject = `Omar Standard Cafe 新訂單 ${order.id}`;
  const customerSubject = `Omar Standard Cafe 訂單確認 ${order.id}`;

  const ownerResult = await sendResendEmail(env, {
    to: [ownerEmail],
    replyTo: order.customer.email,
    subject: ownerSubject,
    text,
    html,
  });
  if (!ownerResult.sent) return ownerResult;

  const customerResult = await sendResendEmail(env, {
    to: [order.customer.email],
    replyTo: ownerEmail,
    subject: customerSubject,
    text,
    html,
  });

  return customerResult.sent
    ? { sent: true }
    : { sent: false, warning: customerResult.warning || "客人訂單確認信未寄出。" };
}

export async function onRequestPost(context) {
  try {
    const input = await context.request.json();
    const order = normalizeOrder(input);
    const validation = validateOrder(order);
    if (validation) return json({ error: validation }, { status: 400 });

    await saveOrder(context.env, order);

    let emailSent = false;
    let emailWarning = "";
    try {
      const emailResult = await notifyOrder(context.env, order);
      emailSent = Boolean(emailResult.sent);
      emailWarning = emailResult.warning || "";
    } catch (error) {
      console.error(error);
      emailWarning = "通知信寄送失敗，請店家確認 Resend 設定。";
    }

    return json({
      ok: true,
      orderId: order.id,
      total: order.totals.total,
      emailSent,
      emailWarning,
    });
  } catch (error) {
    console.error(error);
    return json({ error: error.message || "訂單送出失敗" }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return json({ ok: true });
}
