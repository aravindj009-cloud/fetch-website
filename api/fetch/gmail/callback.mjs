import { consumeGmailState, exchangeGmailCode, saveGmailToken } from "../../../lib/gmail-oauth.mjs";

const clean = (v) => String(v ?? "").trim();

function html(res, status, title, message) {
  res.status(status);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(`<!doctype html><html><body style="font-family:system-ui;padding:40px"><h2>${title}</h2><p>${message}</p><p>You can close this window and return to Fetch.</p></body></html>`);
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, "https://" + (req.headers.host || "tryfetch.in"));
    const code = clean(url.searchParams.get("code"));
    const state = clean(url.searchParams.get("state"));
    const oauthError = clean(url.searchParams.get("error"));

    if (oauthError) {
      return html(res, 400, "Gmail connection was not completed", "Google returned: " + oauthError.replace(/[<>&"]/g, ""));
    }

    if (!code || !state) {
      return html(res, 400, "Missing authorization details", "The Gmail callback did not contain the required authorization details.");
    }

    const row = await consumeGmailState(state);
    if (!row) {
      return html(res, 400, "Authorization expired", "Please return to Fetch and connect Gmail again.");
    }

    const token = await exchangeGmailCode(row, code);
    const saved = await saveGmailToken(row.conversation_id, token);

    const target = new URL("https://tryfetch.in/");
    target.searchParams.set("gmail", "connected");
    target.searchParams.set("conversationId", row.conversation_id);
    if (saved?.email) target.searchParams.set("gmailAddress", saved.email);

    res.statusCode = 302;
    res.setHeader("Location", target.toString());
    res.end();
  } catch (error) {
    console.error("FETCH_GMAIL_CALLBACK_ERROR", error);
    html(res, 500, "Fetch could not complete the Gmail connection", "Please return to Fetch and try connecting Gmail again.");
  }
}
