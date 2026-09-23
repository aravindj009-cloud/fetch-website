import { executeUniversalFetchRequest } from "../../lib/fetch-universal-execution.mjs";
import { atcSafe, atcCreateTaskForOrder, atcSelectPartnerStoreForOrder, atcRecordEvent } from "../../lib/atc.mjs";
import { offerOrderToPartnerStore } from "../../lib/partner-store.mjs";

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  "https://skfxzagxlxputwpwxwbe.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

const WINDOW = 60000;
const LIMIT = 20;
const buckets = new Map();

function clean(value) {
  return String(value ?? "").trim();
}

function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function allowed(req) {
  const key = String(req.headers["x-forwarded-for"] || "unknown")
    .split(",")[0]
    .trim();
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.t >= WINDOW) {
    buckets.set(key, { t: now, n: 1 });
    return true;
  }

  bucket.n += 1;
  return bucket.n <= LIMIT;
}

function validCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

function isPhysicalRequest(text) {
  const value = clean(text).toLowerCase();
  return [
    "buy ",
    "get me",
    "bring me",
    "deliver",
    "order",
    "grocer",
    "kitkat",
    "kit kat",
    "milk",
    "bread",
    "eggs",
    "rice",
    "snacks",
    "biscuit",
    "biscuits",
    "medicine",
    "water",
    "fetch me"
  ].some((term) => value.includes(term));
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_KEY) {
    throw new Error("SUPABASE_SECRET_KEY is missing");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`
    );
  }

  return data;
}

function webCustomerPhone(conversationId) {
  const raw = clean(conversationId || `web:${Date.now()}`);
  return `web:${raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)}`;
}

async function getOrCreateWebCustomer(conversationId) {
  const phone = webCustomerPhone(conversationId);

  const existing = await supabaseRequest(
    `customers?phone=eq.${encodeURIComponent(phone)}&select=*&limit=1`
  );

  if (Array.isArray(existing) && existing.length) {
    return existing[0];
  }

  const created = await supabaseRequest("customers", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ phone })
  });

  return Array.isArray(created) ? created[0] : created;
}

async function createPhysicalOrder({
  customer,
  entities,
  deliveryAddress,
  latitude,
  longitude
}) {
  const items = Array.isArray(entities?.items)
    ? entities.items
        .map((item) => {
          const quantity = Math.max(1, Number(item?.quantity || 1));
          return `${quantity > 1 ? `${quantity} ` : ""}${clean(item?.item)}`;
        })
        .join(", ")
    : "";

  if (!items) {
    return null;
  }

  const hasLocation = validCoordinates(latitude, longitude);

  const data = await supabaseRequest("orders", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      customer_id: customer.id,
      store_name: "Any available local store",
      items,
      budget: null,
      delivery_address: clean(deliveryAddress),
      customer_latitude: hasLocation ? Number(latitude) : null,
      customer_longitude: hasLocation ? Number(longitude) : null,
      customer_location_source: hasLocation ? "web_browser_geolocation" : null,
      customer_location_shared_at: hasLocation ? new Date().toISOString() : null,
      status: hasLocation ? "finding_partner" : "collecting_details",
      item_total: 0,
      fetch_fee: 0,
      delivery_fee: 0,
      total_amount: 0,
      shopper_earnings: 0,
      payment_status: "pending",
      delivery_pricing_status: "pending",
      delivery_rate_per_km: 10
    })
  });

  const order = Array.isArray(data) ? data[0] : data;

  if (order?.id) {
    await atcSafe(
      () => atcCreateTaskForOrder(order),
      "web_task_create"
    );

    await atcSafe(
      () =>
        atcRecordEvent({
          orderId: order.id,
          eventType: "task_created",
          actorType: "atc",
          toStatus: order.status,
          metadata: { source: "web_agent" }
        }),
      "web_task_created_event"
    );
  }

  return order;
}

async function dispatchPhysicalOrder(order) {
  if (!order?.id) {
    return { success: false, reason: "missing_order" };
  }

  if (!validCoordinates(order.customer_latitude, order.customer_longitude)) {
    return { success: false, reason: "customer_location_missing" };
  }

  const match = await atcSelectPartnerStoreForOrder({ order });

  if (!match?.partnerStoreId) {
    return {
      success: false,
      reason: "no_partner_store_available",
      fallback: "shopper"
    };
  }

  const rows = await supabaseRequest(
    `partner_stores?id=eq.${encodeURIComponent(match.partnerStoreId)}&select=*&limit=1`
  );
  const partnerStore = Array.isArray(rows) && rows.length ? rows[0] : null;

  if (!partnerStore) {
    return {
      success: false,
      reason: "partner_store_not_found",
      fallback: "shopper"
    };
  }

  const offer = await offerOrderToPartnerStore({
    order,
    partnerStore,
    distanceKm: match.distanceKm,
    resourceId: match.resourceId
  });

  if (!offer?.success) {
    return {
      success: false,
      reason: offer?.reason || "partner_offer_failed",
      fallback: "shopper"
    };
  }

  const updatedRows = await supabaseRequest(
    `orders?id=eq.${encodeURIComponent(order.id)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        status: "partner_offered",
        partner_store_id: partnerStore.id,
        partner_request_id: offer.request?.id || null,
        store_name: partnerStore.business_name || order.store_name,
        delivery_pricing_status: "pending",
        item_total: 0,
        delivery_fee: 0,
        total_amount: 0,
        priced_at: null
      })
    }
  );

  const updatedOrder = Array.isArray(updatedRows)
    ? updatedRows[0]
    : updatedRows;

  return {
    success: true,
    order: updatedOrder || order,
    partnerStore,
    request: offer.request,
    distanceKm: match.distanceKm
  };
}

function buildMessage(result) {
  if (result?.status === "needs_clarification") {
    return (
      clean(result?.fetch?.decisions?.[0]?.decision?.reason) ||
      clean(result?.execution?.message) ||
      "I need a little more information."
    );
  }

  if (result?.status === "partner_offered") {
    const store = clean(result?.partner_store?.business_name) || "a nearby partner store";
    return (
      `Got it 👍\n\n` +
      `I’ve routed your request through Fetch ATC to ${store}.\n\n` +
      `I’m waiting for the store to confirm the actual items and price. ` +
      `I’ll calculate delivery only after that.`
    );
  }

  if (result?.status === "finding_shopper") {
    return (
      `Got it 👍\n\n` +
      `No eligible partner store was available for this request, so it has moved to the Fetch shopper fallback.`
    );
  }

  if (result?.status === "awaiting_location") {
    return (
      `I can fetch that. 📍\n\n` +
      `Please allow location access so Fetch can find the nearest suitable partner store.`
    );
  }

  if (result?.status === "completed") {
    return clean(result?.execution?.message) || "Done. I’ve taken care of it.";
  }

  return (
    clean(result?.execution?.message) ||
    "I’m working on that."
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    return json(res, 405, { success: false, error: "Method not allowed" });
  }

  if (!allowed(req)) {
    return json(res, 429, {
      success: false,
      error: "Too many requests. Try again shortly."
    });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const text = clean(body.text);
    const conversationId = clean(body.conversationId) || `web:${Date.now()}`;

    if (!text) {
      return json(res, 400, {
        success: false,
        error: "text is required"
      });
    }

    const universal = await executeUniversalFetchRequest({
      text,
      customerId: clean(body.customerId) || null,
      conversationId,
      channel: "web",
      activeTaskId: clean(body.activeTaskId) || null,
      suppliedIntent: body.suppliedIntent || null,
      suppliedContext: body.suppliedContext || {}
    });

    if (!isPhysicalRequest(text)) {
      const decision = universal?.fetch?.decisions?.[0] || null;
      const execution = universal?.execution || null;
      return json(res, 200, {
        success: true,
        message:
          clean(execution?.message) ||
          clean(decision?.decision?.reason) ||
          "I understand the request.",
        status: universal?.status || "resource_matched",
        workflow_id: universal?.workflow_id || null,
        fetch: {
          intent: decision?.intent || null,
          confidence: decision?.intent?.confidence ?? null,
          entities: decision?.entities || null,
          plan: decision?.plan || null
        },
        atc: universal?.atc || null,
        execution: execution
          ? {
              success: !!execution.success,
              status: execution.status || null,
              message: execution.message || null,
              execution_type: execution.execution_type || null,
              side_effect: !!execution.side_effect,
              quote: null
            }
          : null
      });
    }

    const entities = universal?.fetch?.decisions?.[0]?.entities || {};
    const customer = await getOrCreateWebCustomer(conversationId);

    const latitude = body.latitude;
    const longitude = body.longitude;
    const deliveryAddress = clean(body.deliveryAddress);

    if (!validCoordinates(latitude, longitude)) {
      return json(res, 200, {
        success: true,
        status: "awaiting_location",
        workflow_id: universal?.workflow_id || null,
        message: "Please share your delivery location so Fetch can route the order through ATC.",
        fetch: {
          intent: universal?.fetch?.decisions?.[0]?.intent || null,
          entities,
          plan: universal?.fetch?.decisions?.[0]?.plan || null
        },
        atc: universal?.atc || null,
        execution: {
          success: false,
          status: "awaiting_location",
          message: "Customer coordinates are required for physical ATC routing.",
          execution_type: "physical_network_handoff",
          side_effect: false,
          quote: null
        }
      });
    }

    const order = await createPhysicalOrder({
      customer,
      entities,
      deliveryAddress,
      latitude,
      longitude
    });

    if (!order) {
      throw new Error("Could not create Fetch physical order");
    }

    const dispatch = await dispatchPhysicalOrder(order);

    if (dispatch.success) {
      return json(res, 200, {
        success: true,
        status: "partner_offered",
        workflow_id: universal?.workflow_id || null,
        order_id: dispatch.order?.id || order.id,
        message: buildMessage({
          status: "partner_offered",
          partner_store: dispatch.partnerStore
        }),
        fetch: {
          intent: universal?.fetch?.decisions?.[0]?.intent || null,
          entities,
          plan: universal?.fetch?.decisions?.[0]?.plan || null
        },
        atc: {
          status: "resource_matched",
          network: "physical",
          resource_type: "partner_store",
          reason: "ATC catalog match + nearest eligible partner store",
          distance_km: dispatch.distanceKm ?? null
        },
        execution: {
          success: true,
          status: "partner_offered",
          message: "Partner store request sent.",
          execution_type: "physical_partner_store",
          side_effect: true,
          quote: null
        },
        partner_store: {
          id: dispatch.partnerStore?.id || null,
          business_name: dispatch.partnerStore?.business_name || null,
          request_id: dispatch.request?.id || null
        }
      });
    }

    // Partner-store fallback is recorded explicitly. The existing WhatsApp
    // shopper engine remains the source of truth for shopper dispatch.
    const fallbackRows = await supabaseRequest(
      `orders?id=eq.${encodeURIComponent(order.id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          status: "finding_shopper",
          partner_store_id: null,
          partner_request_id: null,
          store_name: "Any available local store"
        })
      }
    );

    const fallbackOrder = Array.isArray(fallbackRows)
      ? fallbackRows[0]
      : fallbackRows;

    return json(res, 200, {
      success: true,
      status: "finding_shopper",
      workflow_id: universal?.workflow_id || null,
      order_id: fallbackOrder?.id || order.id,
      message: buildMessage({ status: "finding_shopper" }),
      fetch: {
        intent: universal?.fetch?.decisions?.[0]?.intent || null,
        entities,
        plan: universal?.fetch?.decisions?.[0]?.plan || null
      },
      atc: {
        status: "resource_unavailable",
        network: "physical",
        resource_type: "shopper_fallback",
        reason: dispatch.reason || "No eligible partner store available"
      },
      execution: {
        success: true,
        status: "finding_shopper",
        message: "Physical order saved for shopper fallback.",
        execution_type: "physical_shopper_fallback",
        side_effect: true,
        quote: null
      }
    });
  } catch (error) {
    console.error("FETCH AGENT API ERROR", error);
    return json(res, 500, {
      success: false,
      error: error?.message || "Fetch could not process that request right now."
    });
  }
}
