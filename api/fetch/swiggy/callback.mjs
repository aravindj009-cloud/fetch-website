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

    // Always return the customer to the canonical Fetch production domain.
    // The OAuth callback itself runs on Swiggy's allowlisted Vercel URL,
    // which is a different browser origin from tryfetch.in. Returning to
    // tryfetch.in preserves the browser's Fetch conversation/session state.
    const target = new URL("https://tryfetch.in/");
    target.searchParams.set("swiggy", "connected");
    target.searchParams.set("conversationId", row.conversation_id);
    res.status(302);
    res.setHeader("Location", target.toString());
    res.end();
  } catch (error) {
    console.error("FETCH SWIGGY CALLBACK ERROR", error);
    html(res, 500, "Fetch could not complete the Swiggy connection", "Please return to Fetch and try connecting again.");
  }
}
