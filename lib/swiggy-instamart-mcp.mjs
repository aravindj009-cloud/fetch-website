/* FETCH — SWIGGY INSTAMART MCP CLIENT */
const MCP_URL = "https://mcp.swiggy.com/im";

function clean(value) { return String(value ?? "").trim(); }

function extractText(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  return parts.filter((part) => part?.type === "text").map((part) => clean(part.text)).filter(Boolean).join("\n");
}

async function rpc({ accessToken, method, params = {}, id = 1 }) {
  const token = clean(accessToken);
  if (!token) return { success: false, status: "connection_required", error: "SWIGGY_ACCESS_TOKEN_REQUIRED" };

  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params })
  });

  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = { raw }; }

  if (!response.ok) {
    return {
      success: false,
      status: response.status === 401 ? "reauthorization_required" : "mcp_error",
      http_status: response.status,
      error: payload?.error?.message || payload?.message || raw
    };
  }

  if (payload?.error) {
    return { success: false, status: "mcp_error", error: payload.error.message || "Swiggy MCP error", code: payload.error.code ?? null };
  }

  const result = payload?.result || payload?.data || payload;
  return { success: true, status: "completed", data: result, text: extractText(result) };
}

async function callTool({ accessToken, name, arguments: args = {} }) {
  return rpc({ accessToken, method: "tools/call", params: { name, arguments: args } });
}

export async function getAddresses(accessToken) {
  return callTool({ accessToken, name: "get_addresses" });
}

export async function searchProducts({ accessToken, addressId, query }) {
  return callTool({ accessToken, name: "search_products", arguments: { addressId, query } });
}

export async function updateCart({ accessToken, addressId, items }) {
  return callTool({
    accessToken,
    name: "update_cart",
    arguments: { items }
  });
}

export async function getCart({ accessToken } = {}) {
  return callTool({ accessToken, name: "get_cart" });
}

export async function getPaymentOptions(accessToken) {
  return callTool({ accessToken, name: "get_payment_options" });
}

export async function checkout({ accessToken, paymentMethod, intentApp, generateUPIQR }) {
  return callTool({
    accessToken,
    name: "checkout",
    arguments: {
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(intentApp ? { intentApp } : {}),
      ...(generateUPIQR ? { generateUPIQR: true } : {})
    }
  });
}

export async function getOrders({ accessToken, count = 10, activeOnly = false }) {
  return callTool({
    accessToken,
    name: "get_orders",
    arguments: { count, orderType: "INSTAMART", activeOnly }
  });
}

export async function trackOrder({ accessToken, orderId }) {
  return callTool({ accessToken, name: "track_order", arguments: { orderId } });
}

export async function getOrderDetails({ accessToken, orderId }) {
  return callTool({ accessToken, name: "get_order_details", arguments: { orderId } });
}

export async function buildInstamartCartPreview({ accessToken, items }) {
  const addresses = await getAddresses(accessToken);
  if (!addresses.success) return { stage: "get_addresses", ...addresses };

  const addressList =
    addresses?.data?.structuredContent?.data ||
    addresses?.data?.data ||
    addresses?.data?.addresses ||
    addresses?.data ||
    [];

  const address = Array.isArray(addressList)
    ? addressList.find((item) => /home/i.test(clean(item?.label))) || addressList[0]
    : null;

  const addressId = clean(address?.id || address?.addressId);

  if (!addressId) {
    return { success: false, status: "address_required", stage: "get_addresses", addresses: addressList };
  }

  const searches = [];
  for (const item of Array.isArray(items) ? items : []) {
    const query = clean(item?.item || item?.name);
    if (!query) continue;

    const result = await searchProducts({ accessToken, addressId, query });
    searches.push({ requested: query, quantity: Math.max(1, Number(item?.quantity || 1)), result });
  }

  return { success: true, status: "products_found", address, addressId, searches };
}
