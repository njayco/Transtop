import { db, pool, feedSources } from "@workspace/db";
import { seedDemo } from "./demo";
import { pollRealtime } from "./realtime";
import { cleanup } from "./rides";
import { importGtfs } from "./importer";
import { logger } from "../lib/logger";
import { adapters } from "./adapters";
export async function startTransitJobs() {
  await seedDemo();
  for(const a of adapters) {
    const data={name:a.name,documentation:a.documentation,staticUrl:a.staticUrl,realtimeUrls:a.realtimeUrls,status:a.status,setup:a.setup};
    await db.insert(feedSources).values({id:a.id,mode:"live",agency:a.id,data})
      .onConflictDoUpdate({target:[feedSources.mode,feedSources.id],set:{data,updatedAt:new Date()}});
  }
  await cleanup();
  const runPoll=()=>pollRealtime().catch(()=>logger.warn("Live feed polling failed"));
  void runPoll();
  setInterval(runPoll,30000).unref();
  setInterval(()=>void cleanup().catch(()=>logger.warn("Retention cleanup failed")),60000).unref();
  // Single process owner; CLI imports use the same advisory lock below.
  // Static imports are opt-in for runtime resource control. CLI always available.
  if(process.env.TRANSIT_AUTO_IMPORT==="true"){
    const runImport=async()=>{
      const client=await pool.connect();
      try{
        const {rows}=await client.query("SELECT pg_try_advisory_lock(735102) AS locked");
        if(!rows[0].locked)return;
        try{for(const id of ["mta-subway","mta-lirr","mta-mnr"])await importGtfs(id);}
        finally{await client.query("SELECT pg_advisory_unlock(735102)");}
      }catch{logger.warn("Scheduled GTFS import failed; previous complete dataset retained");}
      finally{client.release();}
    };
    setInterval(()=>void runImport(),24*3600000).unref();
  }
}
