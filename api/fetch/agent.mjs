import { executeUniversalFetchRequest } from "../../lib/fetch-universal-execution.mjs";
import { atcSafe, atcCreateTaskForOrder, atcSyncTaskFromOrder, atcSelectPartnerStoreForOrder, atcSelectResourceForOrder, atcRecordAssignment, atcRecordEvent } from "../../lib/atc.mjs";
import { offerOrderToPartnerStore } from "../../lib/partner-store.mjs";
import { getSwiggyToken } from "../../lib/swiggy-oauth-v2.mjs";
import { getUberToken } from "../../lib/uber-oauth.mjs";
import { prepareInstamartOrder } from "../../lib/fetch-instamart-execution.mjs";
import { prepareUberRide } from "../../lib/uber-ride.mjs";
import { answerFetchConversation } from "../../lib/fetch-conversation.mjs";
import { persistFetchWorkflow } from "../../lib/fetch-workflow-store.mjs";

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

function isActionConfirmation(text) {
  return /^(yes|yeah|yep|sure|okay|ok|go ahead|do it|place it|place the order|confirm|confirmed|proceed|please do|that's fine|that works)$/i
    .test(clean(text).replace(/[.!]+$/, ""));
}

function isExecutionRequest(universal) {
  const domain = clean(universal?.fetch?.decisions?.[0]?.intent?.domain);
  return [
    "physical_commerce",
    "mobility",
    "restaurant",
    "travel",
    "communications",
    "productivity"
  ].includes(domain) || !!universal?.provider?.id;
}

function buildActiveTask({
  text,
  universal,
  status,
  message,
  previousTask = null
} = {}) {
  const decision = universal?.fetch?.decisions?.[0] || {};
  const intent = decision?.intent || null;
  const entities = decision?.entities || {};
  const plan = decision?.plan || null;
  const domain = clean(intent?.domain) || "general_agent";
  const previousDomain = clean(previousTask?.domain);

  // Preserve the larger objective for natural follow-ups, but reset it when
  // the user clearly switches into a different executable domain.
  const keepObjective =
    previousTask?.objective &&
    (domain === "general_agent" || !previousDomain || previousDomain === domain);

  return {
    id: clean(universal?.workflow_id) || null,
    objective: keepObjective ? previousTask.objective : clean(text),
    latestText: clean(text),
    text: clean(text),
    domain,
    intent,
    entities,
    plan,
    stage: domain === "general_agent" ? "conversation" : clean(status || universal?.status || "working"),
    status: clean(status || universal?.status || "working"),
    network:
      universal?.provider?.category ||
      universal?.atc?.network ||
      previousTask?.network ||
      "digital",
    workflowId: clean(universal?.workflow_id) || null,
    orderId: clean(universal?.order_id || universal?.orderId || previousTask?.orderId) || null,
    provider:
      universal?.provider
        ? {
            id: universal.provider.id || null,
            name: universal.provider.name || null
          }
        : previousTask?.provider || null,
    lastResponse: clean(message),
    updatedAt: new Date().toISOString()
  };
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

async function getCustomerMemories(customerId) {
  const id = clean(customerId);
  if (!id) return [];

  try {
    const rows = await supabaseRequest(
      `fetch_customer_memory?customer_id=eq.${encodeURIComponent(id)}&select=id,memory_key,memory_value,memory_type,source,confidence,explicit,expires_at,updated_at&order=updated_at.desc&limit=20`
    );

    const now = Date.now();
    return (Array.isArray(rows) ? rows : []).filter((memory) => {
      if (!memory?.expires_at) return true;
      const expires = Date.parse(memory.expires_at);
      return !Number.isFinite(expires) || expires > now;
    });
  } catch (error) {
    console.error("FETCH MEMORY READ ERROR", error);
    return [];
  }
}

function extractExplicitMemory(text) {
  const value = clean(text);
  const match = value.match(
    /^(?:please\s+)?remember(?:\s+that)?\s+(.+)$/i
  );

  if (!match) return null;

  const statement = clean(match[1]).replace(/[.!?]+$/, "");
  if (!statement) return null;

  const preferenceMatch = statement.match(
    /^(?:my\s+)?preferred\s+([^:]+?)\s*(?:is|are)\s+(.+)$/i
  );

  if (preferenceMatch) {
    const subject = clean(preferenceMatch[1]).toLowerCase().replace(/\s+/g, "_");
    return {
      memoryKey: `preference.${subject}`,
      memoryType: "preference",
      value: {
        value: clean(preferenceMatch[2]),
        preference: clean(preferenceMatch[1])
      }
    };
  }

  const amMatch = statement.match(
    /^my\s+([^:]+?)\s+(?:is|are)\s+(.+)$/i
  );

  if (amMatch) {
    const subject = clean(amMatch[1]).toLowerCase().replace(/\s+/g, "_");
    return {
      memoryKey: `fact.${subject}`,
      memoryType: "fact",
      value: { value: clean(amMatch[2]) }
    };
  }

  return {
    memoryKey: `fact.${statement.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 100)}`,
    memoryType: "fact",
    value: { value: statement }
  };
}

async function saveExplicitMemory(customerId, memory) {
  if (!customerId || !memory) return null;

  const existing = await supabaseRequest(
    `fetch_customer_memory?customer_id=eq.${encodeURIComponent(customerId)}&memory_key=eq.${encodeURIComponent(memory.memoryKey)}&select=id&limit=1`
  );

  const payload = {
    customer_id: customerId,
    memory_key: memory.memoryKey,
    memory_value: memory.value,
    memory_type: memory.memoryType,
    source: "user_explicit",
    confidence: 1,
    explicit: true,
    updated_at: new Date().toISOString()
  };

  if (Array.isArray(existing) && existing.length) {
    const rows = await supabaseRequest(
      `fetch_customer_memory?id=eq.${encodeURIComponent(existing[0].id)}`,
      {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload)
      }
    );
    return Array.isArray(rows) ? rows[0] : rows;
  }

  const rows = await supabaseRequest("fetch_customer_memory", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload)
  });

  return Array.isArray(rows) ? rows[0] : rows;
}

async function forgetMemories(customerId, text) {
  const id = clean(customerId);
  const request = clean(text).replace(/^(?:please\s+)?forget(?:\s+that)?\s+/i, "").replace(/[.!?]+$/, "").trim();
  if (!id || !request) return 0;

  const rows = await supabaseRequest(
    `fetch_customer_memory?customer_id=eq.${encodeURIComponent(id)}&select=id,memory_key,memory_value`
  );

  const memories = Array.isArray(rows) ? rows : [];
  const target = request.toLowerCase();
  let removed = 0;

  for (const memory of memories) {
    const haystack = [
      memory.memory_key,
      JSON.stringify(memory.memory_value || {})
    ].join(" ").toLowerCase();

    if (
      haystack.includes(target) ||
      target.includes(String(memory.memory_key || "").toLowerCase().replace(/^fact\./, "").replace(/^preference\./, ""))
    ) {
      await supabaseRequest(
        `fetch_customer_memory?id=eq.${encodeURIComponent(memory.id)}`,
        { method: "DELETE" }
      );
      removed += 1;
    }
  }

  return removed;
}

async function getOrCreateWebCustomer(resolvedConversationId) {
  const phone = webCustomerPhone(resolvedConversationId);

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

  let offer;
  try {
    offer = await offerOrderToPartnerStore({
      order,
      partnerStore,
      distanceKm: match.distanceKm,
      resourceId: match.resourceId
    });
  } catch (error) {
    console.error("FETCH PARTNER STORE OFFER ERROR", error);
    return {
      success: false,
      reason: error?.message || "partner_offer_failed",
      fallback: "shopper"
    };
  }

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
    const reason = clean(result?.fetch?.decisions?.[0]?.decision?.reason);
    if (reason === "mobility_provider_choice_required") {
      return "Sure — I can get that arranged. Would you like Uber or Rapido?";
    }

    return (
      clean(result?.execution?.message) ||
      "I need a little more information."
    );
  }

  if (result?.status === "provider_connection_required" && result?.provider?.id === "uber") {
    return "I can arrange that through Uber. Connect Uber to Fetch once, then I can continue.";
  }

  if (result?.status === "provider_ready" && result?.provider?.id === "uber") {
    return "I’ve got Uber connected. I’m ready to work out the ride details and I’ll ask before I book it.";
  }

  if (result?.provider?.id === "rapido") {
    return "I can route this through Rapido. I’ll confirm the trip details with you before any ride is requested.";
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

async function getOrderStatus(orderId) {
  const id = clean(orderId);
  if (!id) return null;

  const rows = await supabaseRequest(
    `orders?id=eq.${encodeURIComponent(id)}&select=id,status,items,store_name,item_total,fetch_fee,delivery_fee,total_amount,delivery_pricing_status,payment_status,updated_at,created_at&limit=1`
  );

  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

function buildOrderStatusMessage(order) {
  const status = clean(order?.status).toLowerCase();

  if (status === "partner_offered") {
    return "I’ve found a partner store and sent your request. I’m waiting for the store to confirm availability and the actual price.";
  }

  if (status === "awaiting_customer_price_confirmation") {
    const total = Number(order?.total_amount);
    if (Number.isFinite(total) && total > 0) {
      return `The store has confirmed the items. Your current total is ₹${Math.round(total).toLocaleString("en-IN")}. Please review it before Fetch proceeds.`;
    }
    return "The store has confirmed the items. I’m preparing the final total for your approval.";
  }

  if (status === "finding_shopper") {
    return "Your order has moved to the Fetch shopper network. I’m finding a shopper now.";
  }

  if (status === "shopper_assigned") {
    return "A Fetch shopper has accepted the order and will start shopping.";
  }

  if (status === "shopping") {
    return "Your Fetch shopper is shopping for the order now.";
  }

  if (status === "picked_up") {
    return "Your order has been picked up and is moving to delivery.";
  }

  if (status === "out_for_delivery") {
    return "Your Fetch order is out for delivery.";
  }

  if (status === "delivered" || status === "completed") {
    return "Your Fetch order is complete.";
  }

  return null;
}


/* Web approval flow: customer approval is an explicit execution boundary. */
async function approvePhysicalOrder({ orderId, conversationId }) {
  const id = clean(orderId);
  const conversation = clean(conversationId);

  if (!id || !conversation) {
    return {
      success: false,
      status: "invalid_request",
      error: "orderId and conversationId are required"
    };
  }

  const customer = await getOrCreateWebCustomer(conversation);

  const rows = await supabaseRequest(
    `orders?id=eq.${encodeURIComponent(id)}&select=*&limit=1`
  );
  const order = Array.isArray(rows) && rows.length ? rows[0] : null;

  if (!order) {
    return { success: false, status: "order_not_found", error: "order_not_found" };
  }

  if (String(order.customer_id) !== String(customer.id)) {
    return { success: false, status: "forbidden", error: "ORDER_NOT_OWNED_BY_SESSION" };
  }

  const currentStatus = clean(order.status).toLowerCase();

  if (
    [
      "finding_shopper",
      "shopper_assigned",
      "shopping",
      "picked_up",
      "out_for_delivery",
      "delivered",
      "completed"
    ].includes(currentStatus)
  ) {
    return {
      success: true,
      status: currentStatus,
      order_id: order.id,
      message:
        currentStatus === "finding_shopper"
          ? "Approved. Fetch is finding a shopper now."
          : "This order has already moved past customer approval.",
      order
    };
  }

  if (currentStatus !== "awaiting_customer_price_confirmation") {
    return {
      success: false,
      status: currentStatus || "unknown",
      error: "ORDER_NOT_AWAITING_CUSTOMER_APPROVAL",
      message: "This order is not currently waiting for customer approval."
    };
  }

  const updatedRows = await supabaseRequest(
    `orders?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "finding_shopper" })
    }
  );

  const updatedOrder = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;

  await atcSafe(
    () => atcSyncTaskFromOrder(updatedOrder || order),
    "web_approval_task_sync"
  );

  await atcSafe(
    () =>
      atcRecordEvent({
        orderId: id,
        eventType: "customer_approved_price",
        fromStatus: currentStatus,
        toStatus: "finding_shopper",
        actorType: "customer",
        actorId: customer.id,
        metadata: { source: "fetch_web", conversation_id: conversation }
      }),
    "web_customer_approval_event"
  );

  let shopperMatch = null;
  try {
    shopperMatch = await atcSelectResourceForOrder({
      order: updatedOrder || order
    });
  } catch (error) {
    console.error("FETCH WEB APPROVAL SHOPPER MATCH ERROR", error);
  }

  if (shopperMatch?.shopperId) {
    const existingJobs = await supabaseRequest(
      `shopper_jobs?order_id=eq.${encodeURIComponent(id)}&status=in.(offered,accepted)&select=*&limit=1`
    );

    let job = Array.isArray(existingJobs) && existingJobs.length
      ? existingJobs[0]
      : null;

    if (!job) {
      const jobRows = await supabaseRequest("shopper_jobs", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          order_id: id,
          shopper_id: shopperMatch.shopperId,
          status: "offered"
        })
      });
      job = Array.isArray(jobRows) ? jobRows[0] : jobRows;
    }

    if (job?.id) {
      await atcSafe(
        () =>
          atcRecordAssignment({
            orderId: id,
            shopperId: shopperMatch.shopperId,
            status: "offered",
            jobId: job.id
          }),
        "web_approval_assignment"
      );

      await atcSafe(
        () =>
          atcRecordEvent({
            orderId: id,
            eventType: "shopper_offer_created",
            actorType: "atc",
            actorId: shopperMatch.shopperId,
            metadata: {
              job_id: job.id,
              distance_km: shopperMatch.distanceKm,
              source: "web_customer_approval"
            }
          }),
        "web_approval_shopper_offer_event"
      );
    }
  }

  return {
    success: true,
    status: "finding_shopper",
    order_id: id,
    message: shopperMatch?.shopperId
      ? "Approved. Fetch has started the shopper matching process."
      : "Approved. Fetch is finding an available shopper now.",
    shopper_match: shopperMatch
      ? { distance_km: shopperMatch.distanceKm, score: shopperMatch.score }
      : null,
    order: updatedOrder || order
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    try {
      const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
      const orderId = clean(url.searchParams.get("orderId"));

      if (!orderId) {
        return json(res, 400, {
          success: false,
          error: "orderId is required"
        });
      }

      const order = await getOrderStatus(orderId);

      if (!order) {
        return json(res, 404, {
          success: false,
          error: "order_not_found"
        });
      }

      return json(res, 200, {
        success: true,
        order,
        status: order.status,
        message: buildOrderStatusMessage(order)
      });
    } catch (error) {
      console.error("FETCH ORDER STATUS API ERROR", error);
      return json(res, 500, {
        success: false,
        error: error?.message || "Could not load order status"
      });
    }
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

    const action = clean(body.action);
    const conversationId = clean(body.conversationId);

    if (action === "approve_order") {
      const approval = await approvePhysicalOrder({
        orderId: clean(body.orderId),
        conversationId
      });

      return json(
        res,
        approval.success ? 200 : (approval.status === "forbidden" ? 403 : 400),
        approval
      );
    }

    const text = clean(body.text);
    const resolvedConversationId = conversationId || `web:${Date.now()}`;
    const activeTask = body.activeTask && typeof body.activeTask === "object"
      ? body.activeTask
      : null;

    if (
      isActionConfirmation(text) &&
      activeTask?.status === "awaiting_customer_price_confirmation" &&
      activeTask?.orderId
    ) {
      const approval = await approvePhysicalOrder({
        orderId: clean(activeTask.orderId),
        conversationId: resolvedConversationId
      });

      return json(
        res,
        approval.success ? 200 : (approval.status === "forbidden" ? 403 : 400),
        approval
      );
    }

    if (!text) {
      return json(res, 400, {
        success: false,
        error: "text is required"
      });
    }

    const customer = await getOrCreateWebCustomer(resolvedConversationId);
    const memories = await getCustomerMemories(customer?.id);

    const explicitMemory = extractExplicitMemory(text);
    const isForgetRequest = /^(?:please\s+)?forget(?:\s+that)?\s+/i.test(text);
    const forgottenCount = isForgetRequest
      ? await forgetMemories(customer?.id, text)
      : 0;

    if (explicitMemory) {
      await saveExplicitMemory(customer?.id, explicitMemory);
    }

    const swiggyToken = await getSwiggyToken(resolvedConversationId);
    const uberToken = await getUberToken(resolvedConversationId);

    const universal = await executeUniversalFetchRequest({
      text,
      customerId: clean(body.customerId) || null,
      conversationId: resolvedConversationId,
      channel: "web",
      activeTaskId: clean(body.activeTaskId) || null,
      activeTaskContext: {
        text: activeTask?.text || null,
        stage: activeTask?.stage || null,
        status: activeTask?.status || null,
        network: activeTask?.network || null,
        workflowId: activeTask?.workflowId || null,
        orderId: activeTask?.orderId || null,
        history: Array.isArray(body.history) ? body.history.slice(-10) : []
      },
      suppliedIntent: body.suppliedIntent || null,
      suppliedContext: { ...(body.suppliedContext || {}), provider_access_token: swiggyToken?.access_token || null, provider_access_tokens: { swiggy_instamart: swiggyToken?.access_token || null, uber: uberToken?.access_token || null }, location: { latitude: body.latitude ?? null, longitude: body.longitude ?? null } }
    });

    await persistFetchWorkflow({
      customerId: clean(body.customerId) || null,
      conversationId: resolvedConversationId,
      channel: "web",
      sourceText: text,
      universal,
      activeTask,
      eventType: "request_received"
    });

    /*
     * Provider-first ATC:
     * if Fetch has identified an existing app such as Instamart or Uber,
     * do not accidentally send the same request into the old local-store
     * engine. The provider becomes the execution path.
     */
    if (universal?.provider?.id) {
      /*
       * LOCAL DEMO MODE
       *
       * Swiggy asks platform operators to build locally first. This mode
       * exercises the Fetch UX without pretending that a real Swiggy order
       * has been placed. It is enabled only when the browser explicitly
       * sends suppliedContext.local_demo === true.
       */
      if (
        universal.provider.id === "swiggy_instamart" &&
        body.suppliedContext?.local_demo === true
      ) {
        const demoAction = clean(body.demoAction) || "prepare";
        const entities = universal?.fetch?.decisions?.[0]?.entities || {};
        const requestedItems = Array.isArray(entities?.items) && entities.items.length
          ? entities.items
          : [{ quantity: 1, item: "milk" }];

        const catalog = {
          milk: { name: "Full Cream Milk", pack: "1 L", price: 68 },
          bread: { name: "Sandwich Bread", pack: "400 g", price: 45 },
          eggs: { name: "Farm Fresh Eggs", pack: "6 pcs", price: 62 },
          kitkat: { name: "KitKat Milk Chocolate", pack: "2 Finger", price: 20 },
          rice: { name: "Everyday Rice", pack: "5 kg", price: 399 },
          biscuits: { name: "Marie Biscuits", pack: "250 g", price: 35 },
          water: { name: "Packaged Drinking Water", pack: "1 L", price: 20 }
        };

        const products = requestedItems.map((item) => {
          const key = clean(item?.item).toLowerCase().replace(/\s+/g, "");
          const base = catalog[key] || { name: clean(item?.item) || "Requested item", pack: "1 unit", price: 99 };
          const quantity = Math.max(1, Number(item?.quantity || 1));
          return {
            requested: clean(item?.item),
            quantity,
            ...base,
            line_total: base.price * quantity
          };
        });

        const subtotal = products.reduce((sum, item) => sum + item.line_total, 0);
        const deliveryFee = 25;
        const total = subtotal + deliveryFee;

        const preview = {
          address: "Demo delivery address",
          products,
          subtotal,
          delivery_fee: deliveryFee,
          total
        };

        if (demoAction === "cart") {
          return json(res, 200, {
            success: true,
            status: "awaiting_checkout_confirmation",
            workflow_id: universal.workflow_id || null,
            message: "I’ve prepared the Instamart cart. Review the total before I place anything.",
            provider: {
              id: universal.provider.id,
              name: universal.provider.name,
              company: universal.provider.company,
              category: universal.provider.category,
              connection_status: "connected_demo"
            },
            demo_stage: "cart_ready",
            instamart_preview: preview,
            execution: {
              success: true,
              status: "awaiting_checkout_confirmation",
              side_effect: false,
              confirmation_required: true,
              demo: true
            }
          });
        }

        if (demoAction === "checkout") {
          const demoOrderId = "FETCH-DEMO-" + Date.now().toString(36).toUpperCase();
          return json(res, 200, {
            success: true,
            status: "order_placed",
            workflow_id: universal.workflow_id || null,
            order_id: demoOrderId,
            message: "Done. Your demo Instamart order " + demoOrderId + " has been placed.",
            provider: {
              id: universal.provider.id,
              name: universal.provider.name,
              company: universal.provider.company,
              category: universal.provider.category,
              connection_status: "connected_demo"
            },
            demo_stage: "order_placed",
            instamart_preview: {
              ...preview,
              order_id: demoOrderId,
              tracking: "Order confirmed · Preparing · Out for delivery · Delivered"
            },
            execution: {
              success: true,
              status: "order_placed",
              side_effect: false,
              confirmation_required: false,
              demo: true
            }
          });
        }

        return json(res, 200, {
          success: true,
          status: "awaiting_product_selection",
          workflow_id: universal.workflow_id || null,
          message: "I found the requested items on Instamart. Review the products before I build the cart.",
          provider: {
            id: universal.provider.id,
            name: universal.provider.name,
            company: universal.provider.company,
            category: universal.provider.category,
            connection_status: "connected_demo"
          },
          demo_stage: "products_found",
          instamart_preview: preview,
          execution: {
            success: true,
            status: "awaiting_product_selection",
            side_effect: false,
            confirmation_required: true,
            demo: true
          }
        });
      }

      const provider = universal.provider;
      const providerExecution = universal.execution || {};

      if (
        provider.id === "uber" &&
        uberToken?.access_token &&
        body.suppliedContext?.local_demo !== true
      ) {
        const entities = universal?.fetch?.decisions?.[0]?.entities || {};
        const execution = await prepareUberRide({
          accessToken: uberToken.access_token,
          pickupLatitude: body.latitude,
          pickupLongitude: body.longitude,
          destination: entities.destination
        });

        return json(res, 200, {
          success: true,
          status: execution.status || "provider_ready",
          workflow_id: universal.workflow_id || null,
          message: execution.message || "I’ve worked out the Uber ride. Review it before I request anything.",
          fetch: {
            intent: universal?.fetch?.decisions?.[0]?.intent || null,
            confidence: universal?.fetch?.decisions?.[0]?.intent?.confidence ?? null,
            entities,
            plan: universal?.fetch?.decisions?.[0]?.plan || null
          },
          atc: universal.atc || null,
          provider: {
            id: provider.id,
            name: provider.name,
            company: provider.company,
            category: provider.category,
            capabilities: provider.capabilities,
            transport: provider.transport,
            connection_status: "connected",
            web_url: provider.web_url
          },
          execution: {
            success: !!execution.success,
            status: execution.status || null,
            message: execution.message || null,
            execution_type: "uber_ride_api",
            side_effect: false,
            confirmation_required: true
          },
          uber_preview: execution
        });
      }

      if (
        provider.id === "swiggy_instamart" &&
        swiggyToken?.access_token &&
        body.suppliedContext?.local_demo !== true
      ) {
        const entities = universal?.fetch?.decisions?.[0]?.entities || {};
        const execution = await prepareInstamartOrder({
          accessToken: swiggyToken.access_token,
          items: Array.isArray(entities?.items) ? entities.items : []
        });

        return json(res, 200, {
          success: true,
          status: execution.status || "provider_ready",
          workflow_id: universal.workflow_id || null,
          message: execution.message || "I found the requested items on Instamart. Review the available products before I build the cart.",
          fetch: {
            intent: universal?.fetch?.decisions?.[0]?.intent || null,
            confidence: universal?.fetch?.decisions?.[0]?.intent?.confidence ?? null,
            entities,
            plan: universal?.fetch?.decisions?.[0]?.plan || null
          },
          atc: universal.atc || null,
          provider: {
            id: provider.id, name: provider.name, company: provider.company, category: provider.category,
            capabilities: provider.capabilities, transport: provider.transport, connection_status: "connected", web_url: provider.web_url
          },
          execution: {
            success: !!execution.success, status: execution.status || null, message: execution.message || null,
            execution_type: "swiggy_instamart_mcp", side_effect: false, confirmation_required: execution.status !== "order_placed"
          },
          instamart_preview: execution
        });
      }

      const connectionRequired = provider.connection_status !== "connected";
      const connectorPending = ["connector_pending", "not_enabled"].includes(provider.connection_status);
      const connectUrl = connectionRequired && provider.connect_path
        ? provider.connect_path + "?conversationId=" + encodeURIComponent(resolvedConversationId)
        : null;

      const providerMessage =
        provider.id === "uber" && connectionRequired && connectUrl
          ? "I can get that arranged through Uber. Connect Uber to Fetch once and I’ll continue."
          : provider.id === "uber" && provider.connection_status === "connected"
            ? "Uber is connected. I’m ready to work out the ride details and I’ll ask before booking."
            : provider.id === "rapido"
              ? "I can route this through Rapido. I’ll confirm the trip details with you before any ride is requested."
              : connectorPending
                ? `I can route this request through ${provider.name}, but that live connector is not connected to Fetch yet. I haven’t placed or attempted any order.`
                : connectionRequired && connectUrl
                  ? `I found ${provider.name}. Connect it to Fetch and I can continue with this request.`
                  : clean(providerExecution.message) || "Fetch selected " + provider.name + " for this request.";

      return json(res, 200, {
        success: true,
        status: universal.status || "provider_connection_required",
        workflow_id: universal.workflow_id || null,
        message: providerMessage,
        fetch: {
          intent: universal?.fetch?.decisions?.[0]?.intent || null,
          confidence: universal?.fetch?.decisions?.[0]?.intent?.confidence ?? null,
          entities: universal?.fetch?.decisions?.[0]?.entities || null,
          plan: universal?.fetch?.decisions?.[0]?.plan || null
        },
        atc: universal.atc || null,
        provider: {
          id: provider.id,
          name: provider.name,
          company: provider.company,
          category: provider.category,
          capabilities: provider.capabilities,
          transport: provider.transport,
          connection_status: provider.connection_status,
          web_url: provider.web_url,
          connect_url: connectUrl,
          action_url: provider.id === "rapido" ? provider.web_url : null,
          action_label: provider.id === "rapido" ? "Open Rapido" : null
        },
        execution: {
          success: !!providerExecution.success,
          status: providerExecution.status || null,
          message: providerExecution.message || null,
          execution_type: providerExecution.execution_type || "connected_app",
          side_effect: false,
          confirmation_required: !!providerExecution.confirmation_required,
          quote: null
        }
      });
    }

    if (!isExecutionRequest(universal)) {
      const decision = universal?.fetch?.decisions?.[0] || null;
      const execution = universal?.execution || null;
      const naturalAnswer = await answerFetchConversation({
        text,
        history: Array.isArray(body.history) ? body.history : [],
        activeTask,
        memories: explicitMemory
          ? [...memories.filter((memory) => memory.memory_key !== explicitMemory.memoryKey), explicitMemory]
          : memories
      });

      const responseMessage =
        (isForgetRequest
          ? (forgottenCount
              ? "Done — I’ve forgotten that preference."
              : "I couldn’t find a saved preference matching that.")
          : null) ||
        naturalAnswer ||
        clean(execution?.message) ||
        clean(decision?.decision?.reason) ||
        "I understand the request.";

      const activeTaskState = buildActiveTask({
        text,
        universal,
        status: universal?.status || "resource_matched",
        message: responseMessage,
        previousTask: activeTask
      });

      return json(res, 200, {
        success: true,
        message: responseMessage,
        status: universal?.status || "resource_matched",
        workflow_id: universal?.workflow_id || null,
        active_task: activeTaskState,
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
      await persistFetchWorkflow({
        customerId: clean(body.customerId) || null,
        conversationId: resolvedConversationId,
        channel: "web",
        sourceText: text,
        universal: { ...universal, status: "partner_offered", order_id: dispatch.order?.id || order.id },
        activeTask,
        orderId: dispatch.order?.id || order.id,
        eventType: "partner_store_offered"
      });

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

    await persistFetchWorkflow({
      customerId: clean(body.customerId) || null,
      conversationId: resolvedConversationId,
      channel: "web",
      sourceText: text,
      universal: { ...universal, status: "finding_shopper", order_id: fallbackOrder?.id || order.id },
      activeTask,
      orderId: fallbackOrder?.id || order.id,
      eventType: "shopper_fallback"
    });

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
