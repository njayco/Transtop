import { db, pool, feedSources } from "@workspace/db";
import { seedDemo } from "./demo";
import { pollRealtime } from "./realtime";
import { cleanup } from "./rides";
import { importGtfs } from "./importer";
import { logger } from "../lib/logger";
import { adapters } from "./adapters";
import { maintainGenerations } from "./generations";
import { refreshIntercity } from "./intercity/service";
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
  // Small public source refresh is independent of the large regional importer.
  const runIntercity=()=>refreshIntercity().catch(()=>logger.warn("Intercity source refresh unavailable"));
  void runIntercity();
  setInterval(()=>void runIntercity(),3600000).unref();
  setInterval(runPoll,30000).unref();
  setInterval(()=>void cleanup().catch(()=>logger.warn("Retention cleanup failed")),60000).unref();
  await maintainGenerations();
  setInterval(()=>void maintainGenerations(),60000).unref();
  // CLI imports and maintenance share the importer's cross-process advisory lock.
  // Opt-in resource control. Stale/missing datasets refresh on startup and
  // daily, with the same cross-process lock as the import CLI.
  if(process.env.TRANSIT_AUTO_IMPORT==="true"){
    const runImport=async()=>{
      try{
        for(const a of adapters.filter(a=>a.staticUrl)){
          const {rows}=await pool.query("SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id=$1",[`${a.id}:static`]);
          if(rows[0]&&Date.now()-Date.parse(rows[0].data.importedAt)<22*3600000)continue;
          try{await importGtfs(a.id);}catch{logger.warn({agency:a.id},"Scheduled import failed; previous dataset retained");}
        }
      }catch{logger.warn("Scheduled GTFS import failed; previous complete dataset retained");}
    };
    // Recheck hourly, but only download feeds older than 22 hours. A busy lock
    // or temporary download failure must not defer a stale feed for a full day.
    setInterval(()=>void runImport(),3600000).unref();
    void runImport();
  }
}
