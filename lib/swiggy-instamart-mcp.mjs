/* FETCH — SWIGGY INSTAMART MCP CLIENT
 *
 * Production client for Swiggy Builders Club streamable HTTP.
 * - OAuth bearer token supplied server-side only
 * - MCP initialize handshake + session header
 * - JSON and SSE response parsing
 * - Explicit 401/429 handling for re-auth / retry
 */

const MCP_URL = "https://mcp.swiggy.com/im";
const MCP_PROTOCOL_VERSION = "2025-06-18";

function clean(value) {
  return String(value ?? "").trim();
}

function extractText(result) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  return parts
    .filter((part) => part?.type === "text")
    .map((part) => clean(part.text))
    .filter(Boolean)
    .join("\n");
}

function parseResponse(raw, contentType = "") {
  const text = clean(raw);
  if (!text) return null;

  if (contentType.includes("text/event-stream")) {
    const dataLines = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);

    for (let i = dataLines.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(dataLines[i]);
      } catch {
        // Continue until the final valid JSON event.
      }
    }
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getSessionId(response) {
  return (
    response.headers.get("mcp-session-id") ||
    response.headers.get("Mcp-Session-Id") ||
    response.headers.get("MCP-Session-Id") ||
    null
  );
}

async function mcpRequest({ accessToken, method, params = {}, sessionId = null, id = 1 }) {
  const token = clean(accessToken);

  if (!token) {
    return {
      success: false,
      status: "connection_required",
      error: "SWIGGY_ACCESS_TOKEN_REQUIRED"
    };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION
  };

  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const response = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    })
  });

  const raw = await response.text();
  const payload = parseResponse(raw, response.headers.get("content-type") || "");

  if (!response.ok) {
    return {
      success: false,
      status:
        response.status === 401
          ? "reauthorization_required"
          : response.status === 429
            ? "rate_limited"
            : "mcp_error",
      http_status: response.status,
      retry_after: response.headers.get("retry-after") || null,
      error:
        payload?.error?.message ||
        payload?.message ||
        (typeof payload?.raw === "string" ? payload.raw : raw)
    };
  }

  if (payload?.error) {
    return {
      success: false,
      status:
        payload.error?.code === -32001
          ? "reauthorization_required"
          : "mcp_error",
      error: payload.error.message || "Swiggy MCP error",
      code: payload.error.code ?? null
    };
  }

  return {
    success: true,
    status: "completed",
    data: payload?.result || payload?.data || payload,
    text: extractText(payload?.result || payload?.data || payload),
    sessionId: getSessionId(response) || sessionId
  };
}

async function initializeSession(accessToken) {
  const result = await mcpRequest({
    accessToken,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "Fetch",
        version: "1.0.0"
      }
    },
    id: 1
  });

  if (!result.success) return result;

  return {
    ...result,
    sessionId: result.sessionId || null
  };
}

async function createSession(accessToken) {
  const initialized = await initializeSession(accessToken);
  if (!initialized.success) return initialized;

  const sessionId = initialized.sessionId;

  if (sessionId) {
    // MCP lifecycle requires the client to announce readiness after initialize.
    const ready = await mcpRequest({
      accessToken,
      method: "notifications/initialized",
      params: {},
      sessionId,
      id: 2
    });

    if (!ready.success && ready.http_status !== 202) {
      return ready;
    }
  }

  return {
    success: true,
    status: "connected",
    sessionId
  };
}

async function callTool({ accessToken, name, arguments: args = {}, sessionId = null, id = 3 }) {
  const result = await mcpRequest({
    accessToken,
    method: "tools/call",
    params: {
      name,
      arguments: args
    },
    sessionId,
    id
  });

  return result;
}

async function callWithSession(accessToken, fn) {
  const session = await createSession(accessToken);
  if (!session.success) return session;
  return fn(session.sessionId);
}

export async function getAddresses(accessToken) {
  return callWithSession(accessToken, (sessionId) =>
    callTool({
      accessToken,
      name: "get_addresses",
      sessionId,
      id: 3
    })
  );
}

export async function searchProducts({ accessToken, addressId, query }) {
  return callWithSession(accessToken, (sessionId) =>
    callTool({
      accessToken,
      name: "search_products",
      arguments: { addressId, query },
      sessionId,
      id: 3
    })
  );
}

export async function updateCart({ accessToken, addressId, items }) {
  return callWithSession(accessToken, (sessionId) =>
    callTool({
      accessToken,
      name: "update_cart",
      arguments: {
        selectedAddressId: clean(addressId),
        items
      },
      sessionId,
      id: 3
    })
  );
}

export async function getCart({ accessToken } = {}) {
  return callWithSession(accessToken, (sessionId) =>
    callTool({
      accessToken,
      name: "get_cart",
      sessionId,
      id: 3
    })
  );
}

export async function getPaymentOptions(accessToken) {
  return callWithSession(accessToken, (sessionId) =>
    callTool({
      accessToken,
      name: "get_payment_options",
      sessionId,
      id: 3
    })
  );
}

export async function checkout({ accessToken, addressId, paymentMethod, intentApp, generateUPIQR }) {
  return callWithSession(accessToken, (sessionId) =>
    callTool({
      accessToken,
      name: "checkout",
      arguments: {
        addressId,
        ...(paymentMethod ? { paymentMethod } : {}),
        ...(intentApp ? { intentApp } : {}),
        ...(generateUPIQR ? { generateUPIQR: true } : {})
      },
      sessionId,
      id: 3
    })
  );
}

export async function getOrders({ accessToken, count = 10, activeOnly = false }) {
  return callWithSession(accessToken, (sessionId) =>
    callTool({
      accessToken,
      name: "get_orders",
      arguments: { count, orderType: "INSTAMART", activeOnly },
      sessionId,
      id: 3
    })
  );
}

export async function trackOrder({ accessToken, orderId }) {
  return callWithSession(accessToken, (sessionId) =>
    callTool({
      accessToken,
      name: "track_order",
      arguments: { orderId },
      sessionId,
      id: 3
    })
  );
}

export async function getOrderDetails({ accessToken, orderId }) {
  return callWithSession(accessToken, (sessionId) =>
    callTool({
      accessToken,
      name: "get_order_details",
      arguments: { orderId },
      sessionId,
      id: 3
    })
  );
}

export async function buildInstamartCartPreview({ accessToken, items, addressId: selectedAddressId }) {
  const session = await createSession(accessToken);
  if (!session.success) return session;

  const sessionId = session.sessionId;

  const addresses = await callTool({
    accessToken,
    name: "get_addresses",
    sessionId,
    id: 3
  });

  if (!addresses.success) {
    return {
      stage: "get_addresses",
      ...addresses
    };
  }

  const addressData =
    addresses?.data?.structuredContent?.data ||
    addresses?.data?.data ||
    addresses?.data ||
    {};

  const addressList =
    addressData?.addresses ||
    (Array.isArray(addressData) ? addressData : []);

  if (!clean(selectedAddressId)) {
    return {
      success: true,
      status: "address_selection_required",
      stage: "get_addresses",
      addresses: Array.isArray(addressList) ? addressList : []
    };
  }

  const addressId = clean(selectedAddressId);
  const address = Array.isArray(addressList)
    ? addressList.find(
        (item) =>
          clean(item?.id || item?.addressId) === addressId
      )
    : null;

  if (!address) {
    return {
      success: false,
      status: "address_required",
      stage: "get_addresses",
      addresses: addressList
    };
  }

  const searches = [];

  for (const item of Array.isArray(items) ? items : []) {
    const query = clean(item?.item || item?.name);
    if (!query) continue;

    const result = await callTool({
      accessToken,
      name: "search_products",
      arguments: { addressId, query },
      sessionId,
      id: 10 + searches.length
    });

    searches.push({
      requested: query,
      quantity: Math.max(1, Number(item?.quantity || 1)),
      result
    });

    if (!result.success) {
      return {
        success: false,
        status: result.status,
        stage: "search_products",
        searches,
        error: result.error,
        code: result.code
      };
    }
  }

  return {
    success: true,
    status: "products_found",
    address,
    addressId,
    searches
  };
}
