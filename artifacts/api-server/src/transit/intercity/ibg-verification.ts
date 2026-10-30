import type { IbgData, Row } from "./ibg-model";

export const IBG_COMMIT = "b7df01420884a043a7e72c70d97b8a20e2c69002";
export const IBG_SHA = "6f592b96af3b5a3d0004ade84a5212aeae0fb53e963d92f52544e2aa019e15b2";
export const IBG_LOCATION_WARNING = "IBG coverage/verification warning: contradictory research stop coordinates are quarantined and omitted from nearby results, network boarding locations and boarding selectors until independently verified. Missing points do not mean no carrier service. Archived records are retained; no replacement coordinates are inferred.";

// Reviewed decisions apply to one immutable source record, never to a stop name
// or a whole carrier. A verified decision needs independent location evidence;
// changing the import timestamp or trusting the archive again is not verification.
type LocationDecision = {
  version: string;
  sha256: string;
  rawStopId: string;
  reason: string;
  evidence: string;
} & (
  | { status: "quarantined" }
  | { status: "verified"; independentEvidence: { url: string; checkedAt: string; notes: string } }
);
const decisions: readonly LocationDecision[] = [{
  version: IBG_COMMIT,
  sha256: IBG_SHA,
  rawStopId: "1#2382",
  status: "quarantined",
  reason: "State College Regional Airport is encoded at 40.734062,-74.165535 near Newark, while raw stop 2382 with the same name is at 40.85141,-77.8528 in Pennsylvania. This material contradiction is not ordinary coordinate snapping. Neither point is relocated or independently verified by this comparison.",
  evidence: "docs/intercity-gtfs-audit.md#stops",
}];

export function ibgLocationDecision(data: IbgData, stop: Row) {
  return decisions.find(d => d.version === data.version && d.sha256 === data.sha256 && d.rawStopId === stop.stop_id);
}
