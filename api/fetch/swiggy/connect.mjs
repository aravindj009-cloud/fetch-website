// Production deployment marker: Swiggy OAuth connect flow is live-ready.
// Deployment trigger: 2026-09-29 production sync.\nconst clean = (value) => String(value ?? "").trim();

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomBase64Url(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier) {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64Url(new Uint8Array(digest));
}

async function db(path, options = {}) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://skfxzagxlxputwpwxwbe.supabase.co";
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseKey) {
    throw new Error("SUPABASE_SECRET_KEY is missing in Vercel");
  }

  const response = await fetch(supabaseUrl + "/rest/v1/" + path, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: "Bearer " + supabaseKey,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; }
  catch { data = raw; }

  if (!response.ok) {
    throw new Error(
      "Supabase " + response.status + ": " +
      (typeof data === "string" ? data : JSON.stringify(data))
    );
  }

  return data;
}

function redirectUri(request) {
  const configured = clean(process.env.SWIGGY_REDIRECT_URI);
  if (configured) return configured;

  const url = new URL(request.url);
  return url.origin + "/api/fetch/swiggy/callback.mjs";
}

export async function GET(request) {
  try {
    const requestUrl = new URL(request.url);
    const conversationId = clean(requestUrl.searchParams.get("conversationId"));

    if (!conversationId) {
      return Response.json(
        { success: false, error: "conversationId is required" },
        { status: 400 }
      );
    }

    const verifier = randomBase64Url(32);
    const challenge = await pkceChallenge(verifier);
    const state = randomBase64Url(32);
    const uri = redirectUri(request);

    const registration = await fetch("https://mcp.swiggy.com/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        client_name: "Fetch Personal AI Agent",
        redirect_uris: [uri],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none"
      })
    });

    const registrationRaw = await registration.text();

    let registrationData;
    try {
      registrationData = registrationRaw
        ? JSON.parse(registrationRaw)
        : {};
    } catch {
      registrationData = { raw: registrationRaw };
    }

    if (!registration.ok || !registrationData.client_id) {
      throw new Error(
        registrationData.error_description ||
        registrationData.error ||
        "Swiggy client registration failed (HTTP " + registration.status + ")"
      );
    }

    await db("fetch_swiggy_oauth_states", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        state,
        conversation_id: conversationId,
        code_verifier: verifier,
        client_id: registrationData.client_id,
        redirect_uri: uri,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      })
    });

    const authorizeUrl = new URL("https://mcp.swiggy.com/auth/authorize");
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", registrationData.client_id);
    authorizeUrl.searchParams.set("redirect_uri", uri);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("scope", "mcp:tools");

    return Response.redirect(authorizeUrl.toString(), 302);
  } catch (error) {
    console.error("FETCH_SWIGGY_CONNECT_ERROR", error);

    return Response.json(
      {
        success: false,
        error: error?.message || "Could not start Swiggy authorization"
      },
      { status: 500 }
    );
  }
}
