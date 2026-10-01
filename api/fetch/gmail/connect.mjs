import { beginGmailAuth } from "../../../lib/gmail-oauth.mjs";

const clean = (v) => String(v ?? "").trim();

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "https://" + (req.headers.host || "tryfetch.in"));
    const conversationId = clean(url.searchParams.get("conversationId"));

    if (!conversationId) {
      res.status(400).json({ success: false, error: "conversationId is required" });
      return;
    }

    const authorizeUrl = await beginGmailAuth(req, conversationId);
    res.statusCode = 302;
    res.setHeader("Location", authorizeUrl);
    res.setHeader("Cache-Control", "no-store");
    res.end();
  } catch (error) {
    console.error("FETCH_GMAIL_CONNECT_ERROR", error);
    res.status(500).json({
      success: false,
      error: error?.message || "Could not start Gmail authorization"
    });
  }
}
