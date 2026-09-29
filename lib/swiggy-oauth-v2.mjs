import crypto from "node:crypto";

const BASE = "https://mcp.swiggy.com";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://skfxzagxlxputwpwxwbe.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;
const clean = (v) => String(v ?? "").trim();

async function db(path, options = {}) {
  if (!SUPABASE_KEY) throw new Error("SUPABASE_SECRET_KEY is missing");
  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, { ...options, headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY, "Content-Type": "application/json", ...(options.headers || {}) } });
  const raw = await response.text();
  let data = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!response.ok) throw new Error("Supabase " + response.status + ": " + (typeof data === "string" ? data : JSON.stringify(data)));
  return data;
}

function redirectUri(req) {
  const configured = clean(process.env.SWIGGY_REDIRECT_URI);
  if (configured) return configured;
  const host = clean(req?.headers?.host);
  const proto = clean(req?.headers?.["x-forwarded-proto"]) || (host.startsWith("localhost") ? "http" : "https");
  return proto + "://" + host + "/api/fetch/swiggy/callback.mjs";
}

export async function beginSwiggyAuth(req, conversationId) {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(32).toString("base64url");
  const uri = redirectUri(req);
  const reg = await fetch(BASE + "/auth/register", { method:"POST", headers:{"Content-Type":"application/json","Accept":"application/json"}, body:JSON.stringify({ client_name:"Fetch Personal AI Agent", redirect_uris:[uri], grant_types:["authorization_code"], response_types:["code"], token_endpoint_auth_method:"none" }) });
  const raw = await reg.text();
  let data = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = { raw }; }
  if (!reg.ok || !data?.client_id) throw new Error(data?.error_description || data?.error || "Swiggy client registration failed (HTTP " + reg.status + ")");
  await db("fetch_swiggy_oauth_states", { method:"POST", headers:{Prefer:"return=minimal"}, body:JSON.stringify({ state, conversation_id:clean(conversationId), code_verifier:verifier, client_id:data.client_id, redirect_uri:uri, expires_at:new Date(Date.now()+10*60*1000).toISOString() }) });
  const q = new URLSearchParams({ response_type:"code", client_id:data.client_id, redirect_uri:uri, code_challenge:challenge, code_challenge_method:"S256", state, scope:"mcp:tools" });
  return BASE + "/auth/authorize?" + q.toString();
}

export async function consumeSwiggyState(state) {
  const rows = await db("fetch_swiggy_oauth_states?state=eq." + encodeURIComponent(clean(state)) + "&select=*&limit=1");
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row) return null;
  await db("fetch_swiggy_oauth_states?state=eq." + encodeURIComponent(clean(state)), {method:"DELETE"});
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export async function exchangeSwiggyCode(row, code) {
  const response = await fetch(BASE + "/auth/token", { method:"POST", headers:{"Content-Type":"application/json","Accept":"application/json"}, body:JSON.stringify({ grant_type:"authorization_code", code:clean(code), code_verifier:row.code_verifier, client_id:row.client_id, redirect_uri:row.redirect_uri }) });
  const raw = await response.text();
  let data = null; try { data = raw ? JSON.parse(raw) : null; } catch { data = {raw}; }
  if (!response.ok || !data?.access_token) throw new Error(data?.error_description || data?.error || "Swiggy token exchange failed (HTTP " + response.status + ")");
  return data;
}

export async function saveSwiggyToken(conversationId, token) {
  const expiresIn = Math.max(60, Number(token.expires_in || 432000));
  const expiresAt = new Date(Date.now()+expiresIn*1000).toISOString();
  await db("fetch_provider_connections?conversation_id=eq." + encodeURIComponent(clean(conversationId)) + "&provider_id=eq.swiggy_instamart", {method:"DELETE"});
  await db("fetch_provider_connections", { method:"POST", headers:{Prefer:"return=minimal"}, body:JSON.stringify({ conversation_id:clean(conversationId), provider_id:"swiggy_instamart", access_token:clean(token.access_token), token_type:clean(token.token_type)||"Bearer", expires_at:expiresAt }) });
  return expiresAt;
}

export async function getSwiggyToken(conversationId) {
  const rows = await db("fetch_provider_connections?conversation_id=eq." + encodeURIComponent(clean(conversationId)) + "&provider_id=eq.swiggy_instamart&select=access_token,token_type,expires_at&limit=1");
  const row = Array.isArray(rows) && rows.length ? rows[0] : null;
  if (!row || new Date(row.expires_at).getTime() <= Date.now()+60000) return null;
  return row;
}
