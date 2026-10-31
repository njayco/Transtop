import type { WmataAccess as AccessInfo } from "@workspace/api-client-react";
import { useEffect, useState } from "react";

const checked = (at?: string) => at ? new Date(at).toLocaleString() : "not yet checked";
export function WmataAccess({ access: supplied, now: override }: { access: AccessInfo; now?: number }) {
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const tick = () => setClock(Date.now());
    const timer = window.setInterval(tick, 5000);
    window.addEventListener("focus", tick);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", tick); };
  }, []);
  const now = override ?? clock;
  const fresh = (state: string, at: string | undefined, ttl: number) => {
    if (state !== "fresh") return state;
    const time = at ? Date.parse(at) : NaN;
    return !Number.isFinite(time) || time > now + 30000 || now - time > ttl ? "stale" : state;
  };
  // Keep aging even when refetch fails, the browser is offline or a tab resumes.
  const access = { ...supplied,
    mappingStatus: fresh(supplied.mappingStatus, supplied.mappingCheckedAt, 86400000),
    entrancesStatus: fresh(supplied.entrancesStatus, supplied.entrancesCheckedAt, 86400000),
    outagesStatus: fresh(supplied.outagesStatus, supplied.outagesCheckedAt, 180000) };
  const mapped = access.mappingStatus === "fresh" && access.stationCodes.length > 0;
  const currentOutages = mapped && access.outagesStatus === "fresh";
  return <section id="wmata-station-access" className="scroll-mt-20 space-y-3 border-t border-border pt-3" aria-label="WMATA station access">
    <h3 className="font-semibold">Entrances and elevator access</h3>
    <p className="text-sm font-medium">Step-free route: not verified</p>
    <p className="text-sm text-muted-foreground">{access.scope} Wheelchair flags and an absence of reported outages do not certify accessibility.</p>
    <div className="space-y-1 text-xs text-muted-foreground">
      <p>Station crosswalk: {access.mappingStatus}{mapped ? ` · ${access.stationCodes.join(" / ")}` : ""}. Checked: {checked(access.mappingCheckedAt)}.</p>
      <p>Entrance source: {access.entrancesStatus}. Checked: {checked(access.entrancesCheckedAt)}.</p>
      <p>Equipment outage source: {access.outagesStatus}. Checked: {checked(access.outagesCheckedAt)}.</p>
      <p>Checks record when Transtop requested WMATA data. WMATA supplies no full-list update time here; individual outage updates are shown below. Arrival predictions and service alerts have separate freshness.</p>
    </div>
    {!mapped && <p className="text-sm">Access information is unknown: a current exact station-code crosswalk is unavailable. No entrance or equipment assignments have been guessed.</p>}
    {mapped && access.entrancesStatus === "fresh" && <div>
      <h4 className="text-sm font-semibold">Official station entrances</h4>
      <p className="text-xs text-muted-foreground">These are station entrance descriptions, not verified elevator entrances. They are not matched to the selected GTFS entrance or equipment.</p>
      {access.entrances.length ? <ul className="mt-2 space-y-2">{access.entrances.map((e, i) => <li key={i} className="text-sm">
        <p className="font-medium">{e.name}</p>
        {e.description !== e.name && <p>{e.description}</p>}
        <p className="text-xs text-muted-foreground">Station {e.stationCodes.join(" / ")} · {e.lat.toFixed(5)}, {e.lon.toFixed(5)}</p>
      </li>)}</ul> : <p className="text-sm">No entrances returned for these exact station codes; entrance access remains unknown.</p>}
    </div>}
    {mapped && access.entrancesStatus !== "fresh" && <p className="text-sm">Entrance information is {access.entrancesStatus}; unverified or stale entrance records are withheld.</p>}
    <div>
      <h4 className="text-sm font-semibold">Reported elevator and escalator outages</h4>
      {!currentOutages ? <p className="text-sm">Current equipment condition is unknown. Outage records are withheld while the source or station crosswalk is stale or unavailable.</p> :
        access.outages.length ? <ul className="mt-2 space-y-3">{access.outages.map(e => <li key={`${e.stationCode}:${e.equipmentType}:${e.equipmentId}`} className="rounded-xl border border-border p-3 text-sm">
          <p className="font-semibold">{e.equipmentType === "ELEVATOR" ? "Elevator" : "Escalator"} {e.equipmentId} · station {e.stationCode}</p>
          <p>{e.location}</p><p>{e.symptom}</p>
          <p className="font-medium">{e.status}</p>
          <p className="text-xs text-muted-foreground">WMATA reported: {checked(e.reportedAt)}. Updated: {checked(e.updatedAt)}.</p>
          <p className="text-xs text-muted-foreground">Estimated return: {e.estimatedReturn ? checked(e.estimatedReturn) : "not supplied"}. An estimate is not confirmation of repair. Escalators are not step-free access.</p>
        </li>)}</ul> : <p className="text-sm">WMATA returned no reported outages for these station codes. This is not a working-elevator guarantee or a verified step-free path.</p>}
    </div>
    <p className="text-xs text-muted-foreground">Source: WMATA. <a className="underline" href={access.url} target="_blank" rel="noreferrer">Entrance documentation</a> · <a className="underline" href={access.outageUrl} target="_blank" rel="noreferrer">Equipment outage documentation</a> · <a className="underline" href="https://www.wmata.com/service/elevators-escalators/" target="_blank" rel="noreferrer">Check WMATA elevator status before travel</a></p>
  </section>;
}
