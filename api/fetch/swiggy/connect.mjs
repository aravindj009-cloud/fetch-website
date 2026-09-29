import crypto from "node:crypto";

const SWIGGY_BASE = "https://mcp.swiggy.com";
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://skfxzagxlxputwpwxwbe.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY;

function clean(v){ return String(v ?? "").trim(); }

function json(res,status,body){
  res.status(status);
  res.setHeader("Content-Type","application/json");
  res.end(JSON.stringify(body));
}

async function db(path, options = {}){
  if(!SUPABASE_KEY) throw new Error("SUPABASE_SECRET_KEY is missing in Vercel environment variables");

  const response = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...options,
    headers:{
      apikey:SUPABASE_KEY,
      Authorization:"Bearer " + SUPABASE_KEY,
      "Content-Type":"application/json",
      ...(options.headers || {})
    }
  });

  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }

  if(!response.ok){
    throw new Error("Supabase " + response.status + ": " + (typeof data === "string" ? data : JSON.stringify(data)));
  }

  return data;
}

function redirectUri(req){
  const configured = clean(process.env.SWIGGY_REDIRECT_URI);
  if(configured) return configured;

  const host = clean(req?.headers?.host);
  const forwardedProto = clean(req?.headers?.["x-forwarded-proto"]);
  const proto = forwardedProto || (host.startsWith("localhost") ? "http" : "https");

  return proto + "://" + host + "/api/fetch/swiggy/callback.mjs";
}

export default async function handler(req,res){
  if(req.method !== "GET"){
    return json(res,405,{success:false,error:"Method not allowed"});
  }

  try{
    const url = new URL(req.url,"https://" + (req.headers.host || "localhost"));
    const conversationId = clean(url.searchParams.get("conversationId"));

    if(!conversationId){
      return json(res,400,{success:false,error:"conversationId is required"});
    }

    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = crypto.randomBytes(32).toString("base64url");
    const uri = redirectUri(req);

    const registration = await fetch(SWIGGY_BASE + "/auth/register",{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Accept":"application/json"
      },
      body:JSON.stringify({
        client_name:"Fetch Personal AI Agent",
        redirect_uris:[uri],
        grant_types:["authorization_code"],
        response_types:["code"],
        token_endpoint_auth_method:"none"
      })
    });

    const registrationRaw = await registration.text();
    let registrationData = null;
    try { registrationData = registrationRaw ? JSON.parse(registrationRaw) : null; }
    catch { registrationData = {raw:registrationRaw}; }

    if(!registration.ok || !registrationData?.client_id){
      throw new Error(
        registrationData?.error_description ||
        registrationData?.error ||
        "Swiggy client registration failed (HTTP " + registration.status + ")"
      );
    }

    await db("fetch_swiggy_oauth_states",{
      method:"POST",
      headers:{Prefer:"return=minimal"},
      body:JSON.stringify({
        state,
        conversation_id:conversationId,
        code_verifier:verifier,
        client_id:registrationData.client_id,
        redirect_uri:uri,
        expires_at:new Date(Date.now()+10*60*1000).toISOString()
      })
    });

    const authorize = new URL(SWIGGY_BASE + "/auth/authorize");
    authorize.searchParams.set("response_type","code");
    authorize.searchParams.set("client_id",registrationData.client_id);
    authorize.searchParams.set("redirect_uri",uri);
    authorize.searchParams.set("code_challenge",challenge);
    authorize.searchParams.set("code_challenge_method","S256");
    authorize.searchParams.set("state",state);
    authorize.searchParams.set("scope","mcp:tools");

    res.status(302);
    res.setHeader("Location",authorize.toString());
    res.end();
  }catch(error){
    console.error("FETCH_SWIGGY_CONNECT_ERROR",error);
    return json(res,500,{
      success:false,
      error:error?.message || "Could not start Swiggy authorization"
    });
  }
}
