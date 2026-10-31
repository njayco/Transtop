/** Fixed-host, server-only PRIM transport. Never log headers or error bodies. */
export async function fetchPrimStop(ref:string,fetcher:typeof fetch=fetch,key=process.env.PRIM_API_KEY){
  if(!/^STIF:(?:StopPoint:Q|StopArea:SP):\d+:$/.test(ref))throw new Error("Unsupported PRIM reference");
  if(!key)throw new Error("PRIM key is not configured");
  const url=new URL("https://prim.iledefrance-mobilites.fr/marketplace/stop-monitoring");
  url.searchParams.set("MonitoringRef",ref);
  const response=await fetcher(url,{headers:{apikey:key,Accept:"application/json"},
    signal:AbortSignal.timeout(8000),redirect:"error"});
  if(!response.ok){await response.body?.cancel();throw new Error(`PRIM HTTP ${response.status}`);}
  const reader=response.body?.getReader();if(!reader)throw new Error("PRIM returned no body");
  const chunks:Uint8Array[]=[];let bytes=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;
      if(bytes>2*1024*1024)throw new Error("PRIM response exceeds 2 MiB");
      chunks.push(value);
    }
  }finally{await reader.cancel().catch(()=>{});}
  try{return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string,any>;}
  catch{throw new Error("PRIM returned invalid JSON");}
}
