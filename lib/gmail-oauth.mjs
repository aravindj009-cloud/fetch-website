const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://skfxzagxlxputwpwxwbe.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GMAIL_PROFILE = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const clean = (v) => String(v ?? "").trim();

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify"
];

async function db(path, options = {}) {
  if (!SUPABASE_KEY) throw new Error("SUPABASE_SECRET_KEY is missing");
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) {
    throw new Error("Supabase " + response.status + ": " +
      (typeof data === "string" ? data : JSON.stringify(data)));
  }
  return data;
}

function redirectUri(req) {
  const configured = clean(process.env.GMAIL_REDIRECT_URI);
  if (configured) return configured;
  const host = clean(req?.headers?.host).split(":")[0].toLowerCase();
  if (host === "tryfetch.in" || host === "www.tryfetch.in" || process.env.VERCEL_ENV === "production") {
    return "https://tryfetch.in/api/fetch/gmail/callback.mjs";
  }
  const proto = clean(req?.headers?.["x-forwarded-proto"]) || "https";
  return proto + "://" + host + "/api/fetch/gmail/callback.mjs";
}

function randomState() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function beginGmailAuth(req, conversationId) {
  const clientId = clean(process.env.GOOGLE_CLIENT_ID);
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is missing in Vercel");

  const state = randomState();
  const uri = redirectUri(req);

  await db("fetch_provider_oauth_states", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      state,
      conversation_id: clean(conversationId),
      provider_id: "gmail",
      code_verifier: null,
      client_id: clientId,
      redirect_uri: uri,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    })
  });

  const url = new URL(GOOGLE_AUTH);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", uri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function consumeGmailState(state) {
  const rows = await db(
    "fetch_provider_oauth_states?state=eq." +
      encodeURIComponent(clean(state)) +
      "&provider_id=eq.gmail&select=*&limit=1"
  );
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return null;

  await db(
    "fetch_provider_oauth_states?state=eq." +
      encodeURIComponent(clean(state)),
    { method: "DELETE" }
  );

  if (!row.expires_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export async function exchangeGmailCode(row, code) {
  const clientId = clean(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = clean(process.env.GOOGLE_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are missing in Vercel");
  }

  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: clean(code),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: row.redirect_uri,
      grant_type: "authorization_code"
    })
  });

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }

  if (!response.ok || !data?.access_token) {
    throw new Error(data?.error_description || data?.error || "Google token exchange failed");
  }

  return data;
}

async function fetchProfile(accessToken) {
  const response = await fetch(GMAIL_PROFILE, {
    headers: { Authorization: "Bearer " + clean(accessToken) }
  });
  if (!response.ok) return null;
  return response.json();
}

export async function saveGmailToken(conversationId, token) {
  const expiresIn = Math.max(60, Number(token.expires_in || 3600));
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const profile = await fetchProfile(token.access_token);

  await db(
    "fetch_provider_connections?conversation_id=eq." +
      encodeURIComponent(clean(conversationId)) +
      "&provider_id=eq.gmail",
    { method: "DELETE" }
  );

  await db("fetch_provider_connections", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      conversation_id: clean(conversationId),
      provider_id: "gmail",
      access_token: clean(token.access_token),
      token_type: clean(token.token_type) || "Bearer",
      expires_at: expiresAt,
      refresh_token: clean(token.refresh_token) || null,
      scopes: GMAIL_SCOPES,
    })
  });

  return {
    expiresAt,
    email: clean(profile?.emailAddress) || null
  };
}

export async function getGmailToken(conversationId) {
  const rows = await db(
    "fetch_provider_connections?conversation_id=eq." +
      encodeURIComponent(clean(conversationId)) +
      "&provider_id=eq.gmail&select=access_token,token_type,expires_at,refresh_token,scopes&limit=1"
  );
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return null;

  if (row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 60000) {
    return row;
  }

  if (!row.refresh_token) return null;

  const clientId = clean(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = clean(process.env.GOOGLE_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;

  const response = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token"
    })
  });

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok || !data?.access_token) return null;

  const expiresAt = new Date(Date.now() + Math.max(60, Number(data.expires_in || 3600)) * 1000).toISOString();

  await db(
    "fetch_provider_connections?conversation_id=eq." +
      encodeURIComponent(clean(conversationId)) +
      "&provider_id=eq.gmail",
    {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        access_token: data.access_token,
        token_type: clean(data.token_type) || "Bearer",
        expires_at: expiresAt
      })
    }
  );

  return {
    ...row,
    access_token: data.access_token,
    token_type: clean(data.token_type) || "Bearer",
    expires_at: expiresAt
  };
}

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\\+/g, "-")
    .replace(/\\//g, "_")
    .replace(/=+$/g, "");
}

export async function getGmailProfile(accessToken) {
  return fetchProfile(accessToken);
}

export async function sendGmailEmail(accessToken, { to, subject, body } = {}) {
  const recipient = clean(to);
  const emailSubject = clean(subject) || "Message from Fetch";
  const emailBody = String(body ?? "").trim();

  if (!recipient) throw new Error("Gmail recipient is required");
  if (!emailBody) throw new Error("Gmail message is required");

  const profile = await fetchProfile(accessToken);
  const from = clean(profile?.emailAddress);

  const mime = [
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "To: " + recipient,
    from ? "From: " + from : "",
    "Subject: " + emailSubject,
    "",
    emailBody
  ].filter((line, index) => line || index === 0).join("\\r\\n");

  const response = await fetch(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + clean(accessToken),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        raw: base64UrlEncode(mime)
      })
    }
  );

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }

  if (!response.ok) {
    throw new Error(
      data?.error?.message ||
      data?.error_description ||
      "Gmail send failed"
    );
  }

  return {
    success: true,
    messageId: data?.id || null,
    threadId: data?.threadId || null,
    email: from || null
  };
}
