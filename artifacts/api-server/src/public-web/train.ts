import { pool } from "@workspace/db";
import { amtrakTrainDetail } from "../transit/amtrak-service";
import type { AmtrakTrain } from "../transit/amtrak-model";

/** The API poller owns live observations. A separate web process must read its
 * persisted snapshot rather than mistake an empty process-local cache for 404. */
export async function publicTrain(id: string): Promise<AmtrakTrain | undefined> {
  const { rows } = await pool.query(
    "SELECT data FROM transit_feed_snapshots WHERE mode='live' AND id='amtrak:tracking'");
  const observed = (rows[0]?.data.trains as AmtrakTrain[] | undefined)?.find(train => train.id === id);
  // The document fallback describes the identity only; it never exposes
  // coordinates, live estimates or a freshness claim from this snapshot.
  if (observed) return { ...observed, message: "Train run information. Open the train page to check current tracking availability." };
  return amtrakTrainDetail(id);
}
