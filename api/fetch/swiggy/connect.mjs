function json(res,status,body){
  res.status(status);
  res.setHeader("Content-Type","application/json");
  res.end(JSON.stringify(body));
}

export default async function handler(req,res){
  if(req.method!=="GET"){
    return json(res,405,{success:false,error:"Method not allowed"});
  }

  try{
    const url=new URL(req.url,"https://"+(req.headers.host||"localhost"));
    const conversationId=(url.searchParams.get("conversationId")||"").trim();

    if(!conversationId){
      return json(res,400,{success:false,error:"conversationId is required"});
    }

    const { beginSwiggyAuth } = await import("../../../lib/swiggy-oauth-v2.mjs");
    const authorizationUrl=await beginSwiggyAuth(req,conversationId);

    res.status(302);
    res.setHeader("Location",authorizationUrl);
    res.end();
  }catch(error){
    console.error("FETCH_SWIGGY_CONNECT_ERROR",error);
    return json(res,500,{
      success:false,
      error:error?.message||"Could not start Swiggy authorization",
      name:error?.name||"Error"
    });
  }
}
