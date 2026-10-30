import { test } from "node:test";
import assert from "node:assert/strict";
import { documentTrips,documentRoutes,WALL_CLOSURE } from "../src/transit/intercity/uploaded-data";
import { documentTimetable,documentIntercityDepartures,documentRoute,documentCatalog,activeDocumentTrip } from "../src/transit/intercity/uploaded-service";

test("both Wall Street directions close on exactly the supplied 2026 holiday dates",()=>{
  for(const date of ["2026-11-26","2026-11-27"])for(const direction of ["east","west"]) {
    const result=documentTimetable({routeId:`transbridge:wall-${direction}`,date});
    assert.equal(result.total,0);
    assert.equal(result.message,WALL_CLOSURE);
  }
  for(const date of ["2026-11-25","2026-11-30"]) {
    assert.equal(documentTimetable({routeId:"transbridge:wall-west",date}).total,2);
    assert.equal(documentTimetable({routeId:"transbridge:wall-east",date}).total,2);
  }
  assert.equal(documentTimetable({routeId:"transbridge:wall-east",date:"2026-11-20"}).total,1);
  assert.equal(documentTimetable({routeId:"transbridge:wall-west",date:"2026-11-28"}).total,0);
});
test("Wall Street drop-offs do not become boardable departures or invented clock times",()=>{
  const east=documentTrips.find(t=>t.number==="401")!;
  assert.equal(east.points.length,10);
  assert.equal(east.points.find(p=>p.stopId==="transbridge:VAR")?.minutes,380);
  assert.ok(east.points.slice(4).every(p=>p.minutes==null&&!p.pickup));
  assert.equal(documentTimetable({stopId:"transbridge:WPH",routeId:"transbridge:wall-west",date:"2026-11-02"}).total,0);
  const ny=documentIntercityDepartures({lat:40.703284765181,lon:-74.010092405239,date:"2026-11-02"});
  assert.equal(ny.length,2);assert.ok(ny.every(d=>d.tripId.endsWith("400")||d.tripId.endsWith("404")));
  const pa=documentIntercityDepartures({lat:40.651834,lon:-75.441415,date:"2026-11-02"}).filter(d=>d.routeId.startsWith("transbridge:wall-"));
  assert.equal(pa.length,2);assert.equal(pa[0].stops.at(-1)?.name,"Water and Wall");
  assert.equal(pa[0].stops.at(-1)?.time,undefined);
});
test("890/891 are local buses with all 29 raster-table trips, not intercity services",()=>{
  const trips=documentTrips.filter(t=>t.providerId==="nj-transit");
  assert.equal(trips.length,29);
  assert.equal(new Set(trips.map(t=>t.id)).size,29);
  assert.ok(documentRoutes.filter(r=>r.providerId==="nj-transit").every(r=>r.type==="bus"));
  const local=documentCatalog().routes.filter(r=>r.agencyId==="nj-transit");
  assert.equal(local.length,2);
  for(const trip of trips)assert.ok(trip.points.every((p,i)=>p.minutes!=null&&(i===0||p.minutes>=trip.points[i-1].minutes!)));
  const mapIds=new Set(trips.flatMap(t=>t.points.map(p=>p.stopId)));
  assert.equal(mapIds.size,16);
});
test("NJT noon rollovers, short workings, school and flex notes are preserved",()=>{
  const noon=documentTrips.find(t=>t.id==="nj-transit:890:out:1157:a")!;
  assert.equal(noon.points[0].minutes,717);
  assert.equal(noon.points.at(-1)?.minutes,750);
  const short=documentTrips.find(t=>t.id==="nj-transit:890:out:127:p")!;
  assert.equal(short.points.at(-1)?.stopId,"nj-transit:7");
  assert.match(short.note,/Flex/);
  const noFlex=documentTrips.find(t=>t.id==="nj-transit:890:in:157:p")!;
  assert.match(noFlex.note,/does not flex/);
  assert.equal(noFlex.points[0].stopId,"nj-transit:7");
  const school=documentTrips.find(t=>t.id==="nj-transit:891:in:725:a")!;
  assert.match(school.note,/school/);
  const row=documentTimetable({routeId:"nj-transit:890",stopId:"nj-transit:7",date:"2026-11-02",from:"13:50",direction:"To Easton"});
  assert.ok(row.departures.some(d=>d.time.includes("T13:57")));
});
test("unmapped timepoints remain selectable; unverified NJT holidays/weekends do not get weekday times",()=>{
  const route=documentRoute("nj-transit:891","To Easton")!;
  assert.ok(route.timetableStops.some(s=>s.id==="nj-transit:13"));
  assert.match(route.route.scheduleNotes!.join(" "),/adult \$1\.90/);
  assert.match(route.route.scheduleNotes!.join(" "),/610-253-0110/);
  assert.equal(documentTimetable({routeId:"nj-transit:891",date:"2026-11-07"}).total,0);
  const holiday=documentTimetable({routeId:"nj-transit:891",date:"2026-11-26"});
  assert.equal(holiday.total,0);assert.match(holiday.message,/not verified/);
  assert.equal(documentTimetable({routeId:"nj-transit:891",date:"2026-11-02"}).total,12);
  assert.equal(activeDocumentTrip(documentTrips.find(t=>t.providerId==="nj-transit")!,"2026-07-10"),false);
  assert.throws(()=>documentTimetable({routeId:"nj-transit:890",date:"2026-02-30"}));
});
