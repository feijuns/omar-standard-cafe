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

function formatOrderTime(value) {
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(value));
  } catch (error) {
    return value;
  }
}

function createOrderId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `OSC-${timestamp}-${suffix}`;
}

function allowedPaymentMethods(shippingMethod) {
  return shippingMethod === "中華郵政宅配"
    ? ["匯款：玉山銀行", "LINE PAY"]
    : ["匯款：玉山銀行", "LINE PAY", "取貨付款"];
}

function deliveryLabel(shippingMethod) {
  return shippingMethod === "中華郵政宅配" ? "宅配地址" : "取件門市";
}

function normalizeOrder(input) {
  const customer = input && input.customer ? input.customer : {};
  const recipient = input && input.recipient ? input.recipient : {};
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
  const customerName = cleanText(customer.name, 80);
  const customerPhone = cleanText(customer.phone, 40);

  return {
    id: createOrderId(),
    createdAt: new Date().toISOString(),
    customer: {
      name: customerName,
      phone: customerPhone,
      email: cleanText(customer.email, 160),
    },
    recipient: {
      name: cleanText(recipient.name, 80) || customerName,
      phone: cleanText(recipient.phone, 40) || customerPhone,
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
  const allowedShipping = ["中華郵政宅配", "7-11 店到店", "全家店到店"];
  if (!order.items.length) return "請先加入商品到購物車";
  if (!order.customer.name) return "請填寫姓名";
  if (!order.customer.phone) return "請填寫電話";
  if (order.customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.customer.email)) return "請確認 Email 格式";
  if (!allowedShipping.includes(order.shippingMethod)) return "請選擇配送方式";
  if (!order.recipient.name) return "請填寫收件人姓名";
  if (!order.recipient.phone) return "請填寫收件人電話";
  if (!order.deliveryDetail) return `請填寫${deliveryLabel(order.shippingMethod)}`;
  if (!allowedPaymentMethods(order.shippingMethod).includes(order.paymentMethod)) return "請選擇正確的付款方式";
  return "";
}

async function saveOrder(env, order) {
  if (!env.DB) throw new Error("Cloudflare D1 尚未設定，請確認 DB binding。");

  const inserts = [
    env.DB.prepare(`
      INSERT INTO orders (
        id, created_at, customer_name, customer_title, customer_phone, customer_email, customer_line,
        recipient_name, recipient_phone, shipping_method, delivery_detail, payment_method, note,
        subtotal, shipping_fee, total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      order.id,
      order.createdAt,
      order.customer.name,
      "",
      order.customer.phone,
      order.customer.email || "",
      "",
      order.recipient.name,
      order.recipient.phone,
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
  const deliveryInfoLabel = deliveryLabel(order.shippingMethod);

  return [
    "Omar Standard Cafe 新訂單",
    "",
    `訂單編號：${order.id}`,
    `訂單時間：${formatOrderTime(order.createdAt)}`,
    `訂購人姓名：${order.customer.name}`,
    `訂購人電話：${order.customer.phone}`,
    `訂購人 Email：${order.customer.email || "未提供"}`,
    `收件人姓名：${order.recipient.name}`,
    `收件人電話：${order.recipient.phone}`,
    `配送方式：${order.shippingMethod}`,
    `${deliveryInfoLabel}：${order.deliveryDetail}`,
    `付款方式：${order.paymentMethod}`,
    "",
    "商品明細：",
    itemLines,
    "",
    `商品小計：${formatCurrency(order.totals.subtotal)}`,
    `運費：${formatCurrency(order.totals.shippingFee)}`,
    `訂單總計：${formatCurrency(order.totals.total)}`,
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
    return { enabled: false, sent: false, warning: "LINE 推播未啟用。" };
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
      lineNotificationWarning: lineResult.sent || !lineResult.enabled ? "" : "LINE 推播失敗，請到 Cloudflare Functions log 查看。",
    });
  } catch (error) {
    console.error(error);
    return json({ error: error.message || "訂單建立失敗" }, { status: 500 });
  }
}

export async function onRequestOptions() {
  return json({ ok: true });
}
