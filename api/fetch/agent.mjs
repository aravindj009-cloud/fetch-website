import { executeUniversalFetchRequest } from "../../lib/fetch-universal-execution.mjs";

const WINDOW = 60000;
const LIMIT = 20;
const buckets = new Map();

function json(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function clean(value) {
  return String(value ?? "").trim();
}

function allowed(req) {
  const key = String(
    req.headers["x-forwarded-for"] || "unknown"
  ).split(",")[0].trim();

  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.t >= WINDOW) {
    buckets.set(key, { t: now, n: 1 });
    return true;
  }

  bucket.n += 1;
  return bucket.n <= LIMIT;
}

function message(result) {
  const status = clean(result?.status);

  if (status === "completed") {
    return clean(result?.execution?.message) ||
      "Done. I’ve taken care of it.";
  }

  if (status === "needs_clarification") {
    return clean(
      result?.fetch?.decisions?.[0]?.decision?.reason
    ) || clean(result?.execution?.message) ||
      "I need a little more information before I can do that.";
  }

  if (status === "awaiting_physical_order") {
    return clean(result?.execution?.message) ||
      "I found the physical fulfilment path. I’m checking the best way to get that to you.";
  }

  if (status === "resource_matched") {
    return clean(result?.execution?.message) ||
      "I found the right execution path and I’m working on it.";
  }

  return clean(result?.execution?.message) ||
    "I’m working out the best way to handle that.";
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
    return json(res, 405, {
      success: false,
      error: "Method not allowed"
    });
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
        : (req.body || {});

    const text = clean(body.text);

    if (!text) {
      return json(res, 400, {
        success: false,
        error: "text is required"
      });
    }

    const result = await executeUniversalFetchRequest({
      text,
      customerId: clean(body.customerId) || null,
      conversationId:
        clean(body.conversationId) || `web:${Date.now()}`,
      channel: "web",
      activeTaskId: clean(body.activeTaskId) || null,
      suppliedIntent: body.suppliedIntent || null,
      suppliedContext: body.suppliedContext || {}
    });

    const decision =
      result?.fetch?.decisions?.[0] || null;

    const atc = result?.atc || null;
    const execution = result?.execution || null;

    return json(res, 200, {
      success: true,
      message: message(result),
      status: result?.status || "unknown",
      workflow_id: result?.workflow_id || null,

      fetch: {
        intent: decision?.intent || null,
        confidence: decision?.confidence ?? null,
        entities: decision?.entities || null,
        plan: decision?.plan || null
      },

      atc: atc
        ? {
            status: atc.status || null,
            network: atc.network || null,
            resource_type: atc.resource_type || null,
            reason: atc.reason || null,
            distance_km:
              atc.distance_km ??
              atc.distanceKm ??
              null
          }
        : null,

      execution: execution
        ? {
            success: !!execution.success,
            status: execution.status || null,
            message: execution.message || null,
            execution_type:
              execution.execution_type || null,
            side_effect: !!execution.side_effect,
            quote: execution.quote || null
          }
        : null
    });
  } catch (error) {
    console.error("FETCH AGENT API ERROR", error);

    return json(res, 500, {
      success: false,
      error: "Fetch could not process that request right now."
    });
  }
}
