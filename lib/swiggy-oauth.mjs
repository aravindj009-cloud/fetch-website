/*
 * FETCH — SWIGGY MCP OAUTH
 * Server-side OAuth 2.1 + PKCE for per-conversation user authorization.
 */
import crypto from "node:crypto";

const SWIGGY_BASE = "https://mcp.swiggy.com";
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  "https://skfxzagxlxputwpwxwbe.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

function clean(value) {
  return String(value ?? "").trim();
}

function baseUrl(req) {
  const configured = clean(process.env.SWIGGY_REDIRECT_URI);
  if (configured) return configured;
  const host = clean(req?.headers?.host) || "localhost";
  const proto =
    clean(req?.headers?.["x-forwarded-proto"]) ||
    (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/api/fetch/swiggy/callback.mjs`;
}

async function supabaseRequest(path, options = {}) {
  if (!SUPABASE_KEY) throw new Error("SUPABASE_SECRET_KEY is missing");

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
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

  if (!response.ok) {
    throw new Error(
      `Supabase ${response.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`
    );
  }
  return data;
}

function pkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

export async function createSwiggyAuthorization({ req, conversationId }) {
  const redirectUri = baseUrl(req);
  const { verifier, challenge } = pkce();
  const state = crypto.randomBytes(32).toString("base64url");

  const registration = await fetch(`${SWIGGY_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Fetch Personal AI Agent",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });

  const registrationRaw = await registration.text();
  let registrationData = null;
  try { registrationData = registrationRaw ? JSON.parse(registrationRaw) : null; }
  catch { registrationData = { raw: registrationRaw }; }

  if (!registration.ok || !registrationData?.client_id) {
    throw new Error(
      registrationData?.error_description ||
      registrationData?.error ||
      `Swiggy client registration failed (HTTP ${registration.status})`
    );
  }

  await supabaseRequest("fetch_swiggy_oauth_states", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      state,
      conversation_id: clean(conversationId),
      code_verifier: verifier,
      redirect_uri: redirectUri,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    })
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: registrationData.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "mcp:tools"
  });

  return {
    authorizationUrl: `${SWIGGY_BASE}/auth/authorize?${params.toString()}`,
    redirectUri
  };
}

export async function consumeSwiggyState(state) {
  const rows = await supabaseRequest(
    `fetch_swiggy_oauth_states?state=eq.${encodeURIComponent(clean(state))}&select=*&limit=1`
  );
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;

  if (!row) return null;

  await supabaseRequest(
    `fetch_swiggy_oauth_states?state=eq.${encodeURIComponent(clean(state))}`,
    { method: "DELETE" }
  );

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }

  return row;
}

export async function exchangeSwiggyCode({ code, codeVerifier, redirectUri, clientId }) {
  const response = await fetch(`${SWIGGY_BASE}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      client_id: clientId,
      redirect_uri: redirectUri
    })
  });

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }

  if (!response.ok || !data?.access_token) {
    throw new Error(
      data?.error_description ||
      data?.error ||
      `Swiggy token exchange failed (HTTP ${response.status})`
    );
  }

  return data;
}

export async function saveSwiggyToken({ conversationId, token }) {
  const expiresIn = Math.max(60, Number(token?.expires_in || 432000));
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  await supabaseRequest(
    "fetch_provider_connections?conversation_id=eq." +
      encodeURIComponent(clean(conversationId)) +
      "&provider_id=eq.swiggy_instamart",
    {
      method: "DELETE"
    }
  );

  await supabaseRequest("fetch_provider_connections", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      conversation_id: clean(conversationId),
      provider_id: "swiggy_instamart",
      access_token: clean(token.access_token),
      token_type: clean(token.token_type) || "Bearer",
      expires_at: expiresAt
    })
  });

  return { expiresAt };
}

export async function getSwiggyToken(conversationId) {
  const rows = await supabaseRequest(
    `fetch_provider_connections?conversation_id=eq.${encodeURIComponent(clean(conversationId))}&provider_id=eq.swiggy_instamart&select=access_token,token_type,expires_at&limit=1`
  );

  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now() + 60000) {
    return null;
  }

  return row;
}

export function redirectUriForRequest(req) {
  return baseUrl(req);
}
