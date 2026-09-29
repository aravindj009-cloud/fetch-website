import { getUberToken } from "../../../lib/uber-oauth.mjs";
import { requestUberRide, getUberRide } from "../../../lib/uber-ride.mjs";

const clean = (v) => String(v ?? "").trim();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const conversationId = clean(body.conversationId);
    const action = clean(body.action);

    if (!conversationId) {
      return res.status(400).json({ success: false, error: "conversationId is required" });
    }

    const token = await getUberToken(conversationId);
    if (!token?.access_token) {
      return res.status(401).json({
        success: false,
        error: "uber_connection_required",
        message: "Connect Uber to Fetch first."
      });
    }

    if (action === "checkout") {
      if (body.confirmed !== true) {
        return res.status(400).json({
          success: false,
          error: "explicit_confirmation_required",
          message: "I need your confirmation before requesting the ride."
        });
      }

      const result = await requestUberRide({
        accessToken: token.access_token,
        preview: body.preview
      });

      return res.status(200).json({
        success: true,
        ...result
      });
    }

    if (action === "track") {
      const result = await getUberRide(token.access_token, clean(body.requestId) || null);
      return res.status(200).json({
        success: true,
        status: result?.status || "unknown",
        request_id: result?.request_id || body.requestId || null,
        data: result
      });
    }

    return res.status(400).json({
      success: false,
      error: "unknown_action"
    });
  } catch (error) {
    console.error("FETCH_UBER_EXECUTION_ERROR", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Uber execution failed"
    });
  }
}
