import { test } from "node:test";
import assert from "node:assert/strict";
import { documentTrips,documentStops,WALL_CLOSURE } from "../src/transit/intercity/uploaded-data";
import { transbridgeTrips,transbridgeDocuments,transbridgeCrossChecks } from "../src/transit/intercity/transbridge";
import { activeDocumentTrip,documentIntercityDepartures,documentTimetable,documentRoute,documentCatalog } from "../src/transit/intercity/uploaded-service";

const NY={lat:40.7568858,lon:-73.9910078,provider:"transbridge"};
const find=(number:string,holiday=false)=>transbridgeTrips.find(t=>t.number===number&&!!t.serviceDates===holiday)!;

test("all 15 PDFs have provenance, 31 subset checks and no duplicated physical runs",()=>{
  assert.equal(transbridgeDocuments.length,15);
  assert.ok(transbridgeDocuments.every(d=>/^[0-9a-f]{64}$/.test(d.sha256)&&d.sourceUrl.endsWith(".pdf")));
  assert.equal(transbridgeCrossChecks.length,31);
  assert.equal(transbridgeTrips.length,93);
  assert.equal(transbridgeTrips.filter(t=>!t.serviceDates).length,71);
  assert.equal(transbridgeTrips.filter(t=>t.serviceDates).length,22);
  const all=documentTrips.filter(t=>t.providerId==="transbridge");
  assert.equal(all.length,97);assert.equal(new Set(all.map(t=>t.id)).size,97);
  assert.ok(transbridgeDocuments.filter(d=>d.role==="cross-check").every(d=>!transbridgeTrips.some(t=>t.sourceUrl===d.sourceUrl)));
});
test("verified Thanksgiving and Black Friday replace every regular corridor calendar",()=>{
  for(const date of ["2026-11-26","2026-11-27"]) {
    const trips=documentTrips.filter(t=>t.providerId==="transbridge"&&activeDocumentTrip(t,date));
    assert.equal(trips.length,22);assert.ok(trips.every(t=>t.serviceDates?.includes(date)));
    const ny=documentIntercityDepartures({...NY,date});
    assert.equal(ny.length,11);
    assert.equal(new Set(ny.map(d=>d.tripId)).size,11);
    assert.ok(ny.some(d=>d.tripId.endsWith(":300")));
    assert.ok(ny.some(d=>d.tripId.endsWith(":308H")));
    assert.ok(ny.some(d=>d.tripId.endsWith(":500")));
    assert.ok(ny.every(d=>!d.tripId.includes(":regular:")&&d.sourceUrl.includes("/2026/10/")));
    for(const dir of ["east","west"]) {
      const result=documentTimetable({routeId:`transbridge:wall-${dir}`,date});
      assert.equal(result.total,0);assert.equal(result.message,WALL_CLOSURE);
    }
  }
  assert.ok(activeDocumentTrip(find("101"),"2026-11-25"));
  assert.ok(activeDocumentTrip(find("101"),"2026-11-30"));
  assert.equal(activeDocumentTrip(find("501",true),"2026-11-30"),false);
  assert.equal(activeDocumentTrip(find("501",true),"2027-11-26"),false);
});
test("weekday, Friday-only and weekend patterns do not leak into each other",()=>{
  assert.ok(activeDocumentTrip(find("181"),"2026-11-02"));
  assert.equal(activeDocumentTrip(find("181"),"2026-11-06"),false);
  assert.ok(activeDocumentTrip(find("181F"),"2026-11-06"));
  assert.equal(activeDocumentTrip(find("181F"),"2026-11-02"),false);
  assert.equal(find("181F").points[0].stopId,"transbridge:ABE");
  assert.ok(activeDocumentTrip(find("301"),"2026-11-07"));
  assert.equal(activeDocumentTrip(find("301"),"2026-11-02"),false);
  assert.equal(documentIntercityDepartures({...NY,date:"2026-11-07"}).length,10);
  assert.equal(activeDocumentTrip(find("101"),"2026-07-09"),false);
});
test("geographic table row order is corrected using explicit times and midnight rolls forward",()=>{
  for(const t of transbridgeTrips) {
    const timed=t.points.flatMap(p=>p.minutes==null?[]:[p.minutes]);
    assert.ok(timed.every((m,i)=>i===0||m>=timed[i-1]),t.id);
  }
  const hundred=find("100");
  assert.ok(hundred.points.findIndex(p=>p.stopId==="transbridge:WC")<hundred.points.findIndex(p=>p.stopId==="transbridge:ABE"));
  const night=find("180");
  assert.equal(night.points.find(p=>p.stopId==="transbridge:BTC")?.minutes,1440);
  assert.equal(night.points.find(p=>p.stopId==="transbridge:WES")?.minutes,1480);
  const d=documentIntercityDepartures({...NY,date:"2026-11-02"}).find(d=>d.tripId.endsWith(":180"))!;
  assert.match(d.stops.find(s=>s.id==="transbridge:WES")!.time!,/2026-11-03T00:40:00(?:\.000)?-05:00/);
  assert.match(d.boardingNotes,/gate 6/i);
});
test("airport/casino extracts cannot create extra runs, phantom Friday pickups or invented disputed times",()=>{
  const checks=transbridgeCrossChecks.filter(c=>c.differences.length);
  assert.equal(checks.length,2);
  assert.ok(checks.some(c=>c.run==="181"));assert.ok(checks.some(c=>c.run==="214"));
  const day="2026-11-07";
  const d=documentIntercityDepartures({...NY,date:day}).find(d=>d.tripId.endsWith(":214"))!;
  for(const id of ["HEL","ATC","WES"]) {
    const stop=d.stops.find(s=>s.id===`transbridge:${id}`)!;
    assert.equal(stop.time,undefined);assert.match(stop.address,/conflicting printed/);
  }
  assert.match(d.boardingNotes,/withheld/);
  assert.ok(d.stops.find(s=>s.id==="transbridge:ABE")?.time);
});
test("run 128's un-timed Allentown extension is conditional on airport boarding",()=>{
  const p=documentIntercityDepartures({...NY,date:"2026-11-02"}).find(d=>d.tripId.endsWith(":128"))!;
  assert.equal(p.stops.some(s=>s.id==="transbridge:ATC"),false);
  const ewr=documentStops.find(s=>s.id==="transbridge:EWR")!;
  const a=documentIntercityDepartures({lat:ewr.lat!,lon:ewr.lon!,provider:"transbridge",date:"2026-11-02"}).find(d=>d.tripId.endsWith(":128"))!;
  assert.equal(a.destination,"Allentown Transportation Center");
  assert.equal(a.stops.at(-1)?.time,undefined);
  assert.match(a.boardingNotes,/Newark Airport passengers only/);
  assert.equal(documentTimetable({routeId:"transbridge:allentown-west",stopId:"transbridge:CLI",date:"2026-11-02"}).total,0);
});
test("all corridor addresses, current Flemington pin, gates and source notes reach shared catalogs",()=>{
  const c=documentCatalog(),f=c.stops.find(s=>s.id==="transbridge:FLE")!;
  assert.ok(Math.abs(f.lat-40.5136559)<0.0001);
  assert.match(f.neighborhood!,/80 Park Avenue/);
  assert.equal(f.type,"intercity");
  assert.ok(c.stops.some(s=>s.id==="transbridge:NY"));
  assert.ok(c.stops.some(s=>s.id==="transbridge:EWR"));
  assert.ok(c.stops.some(s=>s.id==="transbridge:WC"));
  assert.equal(c.routes.filter(r=>r.agencyId==="transbridge").length,6);
  const route=documentRoute("transbridge:doylestown-west")!;
  assert.ok(route.timetableStops.some(s=>s.id==="transbridge:QUA"));
  assert.deepEqual(route.shape,[]);assert.deepEqual(route.vehicles,[]);
  assert.match(documentRoute("transbridge:allentown-west")!.route.scheduleNotes!.join(" "),/214/);
});
