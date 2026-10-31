import { from } from "pg-copy-streams";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { editionTable } from "./storage";

/** Each bounded COPY is atomic. Sealing enforces uniqueness before publication.
 * No table/column names or SQL are supplied by a feed.
 */
export async function copyCalls(client:{query:(q:ReturnType<typeof from>)=>ReturnType<typeof from>},rows:Record<string,unknown>[],signal:AbortSignal,stage:string){
  const stream=client.query(from(`COPY ${editionTable(stage)}
    (id,mode,agency,trip_id,stop_id,sequence,arrival_seconds,departure_seconds,data) FROM STDIN WITH (FORMAT csv)`));
  const complete=finished(stream);void complete.catch(()=>{});
  const abort=()=>stream.destroy(new Error("IDFM import cancelled"));
  signal.addEventListener("abort",abort,{once:true});
  const cell=(v:unknown)=>`"${String(v).replaceAll('"','""')}"`;
  try{
    for(const r of rows){
      signal.throwIfAborted();
      const line=[r.id,r.mode,r.agency,r.tripId,r.stopId,r.sequence,r.arrivalSeconds,r.departureSeconds,JSON.stringify(r.data)].map(cell).join(",")+"\n";
      if(!stream.write(line))await once(stream,"drain");
    }
    stream.end();await complete;
  }catch(error){stream.destroy(error instanceof Error?error:new Error(String(error)));await complete.catch(()=>{});throw error;}
  finally{signal.removeEventListener("abort",abort);}
}
