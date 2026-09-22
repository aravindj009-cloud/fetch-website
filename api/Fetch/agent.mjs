import { executeUniversalFetchRequest } from "../../lib/fetch-universal-execution.mjs";

const WINDOW=60000, LIMIT=20, buckets=new Map();

function json(res,status,body){res.status(status).setHeader("Content-Type","application/json");res.setHeader("Cache-Control","no-store");res.end(JSON.stringify(body));}
function clean(v){return String(v??"").trim();}
function allowed(req){
  const key=String(req.headers["x-forwarded-for"]||"unknown").split(",")[0].trim(), now=Date.now();
  const b=buckets.get(key);
  if(!b||now-b.t>=WINDOW){buckets.set(key,{t:now,n:1});return true;}
  b.n+=1; return b.n<=LIMIT;
}
function message(r){
  const s=clean(r?.status);
  if(s==="completed") return clean(r?.execution?.message)||"Done. I’ve taken care of it.";
  if(s==="needs_clarification") return clean(r?.fetch?.decisions?.[0]?.decision?.reason)||"I need a little more information before I can do that.";
  if(s==="awaiting_physical_order") return "I found the physical execution path. The live delivery flow needs a confirmed order before it can hand this to the store network.";
  if(s==="resource_matched") return clean(r?.execution?.message)||"I found the right execution path, but that capability is not connected yet.";
  return clean(r?.execution?.message)||"I’m working out the best way to handle that.";
}
export default async function handler(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  if(req.method==="OPTIONS"){res.status(204).end();return;}
  if(req.method!=="POST") return json(res,405,{success:false,error:"Method not allowed"});
  if(!allowed(req)) return json(res,429,{success:false,error:"Too many requests. Try again shortly."});
  try{
    const body=typeof req.body==="string"?JSON.parse(req.body||"{}"):(req.body||{});
    const text=clean(body.text); if(!text) return json(res,400,{success:false,error:"text is required"});
    const r=await executeUniversalFetchRequest({
      text, customerId:clean(body.customerId)||null,
      conversationId:clean(body.conversationId)||`web:${Date.now()}`,
      channel:"web", activeTaskId:clean(body.activeTaskId)||null,
      suppliedIntent:body.suppliedIntent||null, suppliedContext:body.suppliedContext||{}
    });
    const d=r?.fetch?.decisions?.[0]||null, a=r?.atc||null, e=r?.execution||null;
    return json(res,200,{success:true,message:message(r),status:r?.status||"unknown",workflow_id:r?.workflow_id||null,
      fetch:{intent:d?.intent||null,entities:d?.entities||null,plan:d?.plan||null},
      atc:a?{status:a.status||null,network:a.network||null,resource_type:a.resource_type||null,reason:a.reason||null,distance_km:a.distance_km??a.distanceKm??null}:null,
      execution:e?{success:!!e.success,status:e.status||null,message:e.message||null,execution_type:e.execution_type||null,side_effect:!!e.side_effect}:null});
  }catch(err){console.error("FETCH AGENT API ERROR",err);return json(res,500,{success:false,error:"Fetch could not process that request right now."});}
}
