const ADMIN_EMAIL = "feijuns@gmail.com";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function isAdmin(request, env) {
  const allowedEmail = String(env.ADMIN_EMAIL || ADMIN_EMAIL).toLowerCase();
  const accessEmail = String(request.headers.get("cf-access-authenticated-user-email") || "").toLowerCase();
  if (accessEmail && accessEmail === allowedEmail) return true;

  const configuredToken = env.ADMIN_TOKEN;
  if (!configuredToken) return false;
  const url = new URL(request.url);
  const token = request.headers.get("x-admin-token") || url.searchParams.get("token");
  return token === configuredToken;
}

function rowValue(value) {
  return value == null ? "" : String(value);
}

export async function onRequestGet(context) {
  try {
    if (!isAdmin(context.request, context.env)) {
      return json({ error: "沒有後台權限，請使用 Cloudflare Access 登入 feijuns@gmail.com，或設定 ADMIN_TOKEN 後以 /admin?token=你的密碼 進入。" }, { status: 401 });
    }
    if (!context.env.DB) throw new Error("Cloudflare D1 尚未設定，請確認 DB binding。");

    const result = await context.env.DB.prepare(`
      SELECT
        orders.id,
        orders.created_at,
        orders.customer_name,
        orders.customer_phone,
        orders.customer_email,
        orders.recipient_name,
        orders.recipient_phone,
        orders.shipping_method,
        orders.delivery_detail,
        orders.payment_method,
        orders.note,
        orders.subtotal,
        orders.shipping_fee,
        orders.total,
        order_items.product_name,
        order_items.variant,
        order_items.quantity,
        order_items.unit_price,
        order_items.line_total
      FROM orders
      JOIN order_items ON order_items.order_id = orders.id
      ORDER BY orders.created_at DESC, order_items.id ASC
      LIMIT 1000
    `).all();

    const rows = (result.results || []).map((row) => ({
      "訂單編號": rowValue(row.id),
      "訂單時間": rowValue(row.created_at),
      "訂購人姓名": rowValue(row.customer_name),
      "訂購人電話": rowValue(row.customer_phone),
      "訂購人 Email": rowValue(row.customer_email),
      "收件人姓名": rowValue(row.recipient_name || row.customer_name),
      "收件人電話": rowValue(row.recipient_phone || row.customer_phone),
      "商品名稱": rowValue(row.product_name),
      "規格": rowValue(row.variant),
      "數量": rowValue(row.quantity),
      "單價": rowValue(row.unit_price),
      "金額": rowValue(row.line_total),
      "售出金額": rowValue(row.line_total),
      "配送方式": rowValue(row.shipping_method),
      "配送資料": rowValue(row.delivery_detail),
      "付款方式": rowValue(row.payment_method),
      "備註": rowValue(row.note),
      "商品小計": rowValue(row.subtotal),
      "運費": rowValue(row.shipping_fee),
      "訂單總計": rowValue(row.total),
      "發票號碼": "",
      "發票金額": "",
      "收款日期": "",
      "是否已出貨": "否",
    }));

    return json({ ok: true, rows });
  } catch (error) {
    console.error(error);
    return json({ error: error.message || "讀取訂單失敗" }, { status: 500 });
  }
}
