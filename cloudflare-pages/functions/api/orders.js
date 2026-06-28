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

function lineOrderMessage(order) {
  const itemLines = order.items.map((item, index) =>
    `${index + 1}. ${item.name}｜${item.variant}｜${item.quantity} x ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.lineTotal)}`
  ).join("\n");

  return [
    "Omar Standard Cafe 新訂單",
    "",
    `訂單編號：${order.id}`,
    `訂單時間：${order.createdAt}`,
    `客人姓名：${order.customer.name} ${order.customer.title}`,
    `電話：${order.customer.phone}`,
    `Email：${order.customer.email}`,
    `LINE ID：${order.customer.line || "-"}`,
    `運送方式：${order.shippingMethod}`,
    `付款方式：${order.paymentMethod}`,
    `收件資訊：${order.deliveryDetail}`,
    "",
    "商品明細：",
    itemLines,
    "",
    `商品小計：${formatCurrency(order.totals.subtotal)}`,
    `運費：${formatCurrency(order.totals.shippingFee)}`,
    `總計：${formatCurrency(order.totals.total)}`,
    `備註：${order.note || "-"}`,
  ].join("\n");
}

function splitLineMessages(text) {
  const maxLength = 4500;
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLength && chunks.length < 4) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < 1000) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  chunks.push(remaining.slice(0, maxLength));
  return chunks.map((chunk) => ({ type: "text", text: chunk }));
}

async function sendLineOrderNotification(order, env) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_OWNER_USER_ID) {
    return { enabled: false, sent: false, warning: "未啟用 LINE 推播。" };
  }

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: env.LINE_OWNER_USER_ID,
        messages: splitLineMessages(lineOrderMessage(order)),
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return { enabled: true, sent: false, warning: `LINE 推播失敗：${response.status} ${detail}` };
    }

    return { enabled: true, sent: true, warning: "" };
  } catch (error) {
    return { enabled: true, sent: false, warning: error.message || "LINE 推播失敗。" };
  }
}

export async function onRequestPost(context) {
  try {
    const input = await context.request.json();
    const order = normalizeOrder(input);
    const validation = validateOrder(order);
    if (validation) return json({ error: validation }, { status: 400 });

    await saveOrder(context.env, order);

    const lineResult = await sendLineOrderNotification(order, context.env);
    if (lineResult.warning && lineResult.enabled) console.error(lineResult.warning);

    return json({
      ok: true,
      orderId: order.id,
      total: order.totals.total,
      lineNotificationEnabled: lineResult.enabled,
      lineNotificationSent: lineResult.sent,
      lineNotificationWarning: lineResult.sent || !lineResult.enabled ? "" : "LINE 推播失敗，請店家查看 Cloudflare Functions log。",
    });
  } catch (error) {
    console.error(error);
    return json({ error: error.message || "訂單送出失敗" }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return json({ ok: true });
}
