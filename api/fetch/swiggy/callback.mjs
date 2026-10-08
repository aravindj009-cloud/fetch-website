import { consumeSwiggyState, exchangeSwiggyCode, saveSwiggyToken } from "../../../lib/swiggy-oauth-v2.mjs";

function clean(value) { return String(value ?? "").trim(); }

function html(res, status, title, message) {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`<!doctype html><html><body style="font-family:system-ui;padding:40px"><h2>${title}</h2><p>${message}</p><p>You can close this window and return to Fetch.</p></body></html>`);
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const code = clean(url.searchParams.get("code"));
    const state = clean(url.searchParams.get("state"));
    const oauthError = clean(url.searchParams.get("error"));

    if (oauthError) return html(res, 400, "Swiggy connection was not completed", "Swiggy returned: " + oauthError.replace(/[<>&"]/g, ""));
    if (!code || !state) return html(res, 400, "Missing authorization details", "The Swiggy callback did not contain the required code and state.");

    const row = await consumeSwiggyState(state);
    if (!row) return html(res, 400, "Authorization expired", "Please return to Fetch and connect Swiggy again.");

    const token = await exchangeSwiggyCode(row, code);
    await saveSwiggyToken(row.conversation_id, token);

    // WhatsApp-originated OAuth should return the user to the WhatsApp
    // conversation, not leave them in the Fetch website. The backend sends
    // the connection confirmation through WhatsApp and renders only a small
    // browser handoff page.
    if (String(row.conversation_id || "").startsWith("whatsapp:")) {
      const target = new URL("https://tryfetch.in/api/fetch/context.mjs");
      target.searchParams.set("oauth_resume", "1");
      target.searchParams.set("conversation_id", row.conversation_id);
      res.status(302);
      res.setHeader("Location", target.toString());
      res.end();
      return;
    }

    const target = new URL("https://tryfetch.in/");
    target.searchParams.set("swiggy", "connected");
    target.searchParams.set("instamart", "connected");
    target.searchParams.set("conversationId", row.conversation_id);
    res.status(302);
    res.setHeader("Location", target.toString());
    res.end();
  } catch (error) {
    console.error("FETCH SWIGGY CALLBACK ERROR", error);
    html(res, 500, "Fetch could not complete the Swiggy connection", "Please return to Fetch and try connecting again.");
  }
}
