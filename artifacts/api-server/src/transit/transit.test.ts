import { test } from "node:test";
import assert from "node:assert/strict";
import { DateTime } from "luxon";
import { activeService,gtfsSeconds,serviceInstant,serviceDates,ZONE } from "./time";
import { decodePolyline } from "./journeys";
import { patternLabel,matchesPattern,resolvePattern } from "./catalog";

test("GTFS time accepts overnight service and rejects invalid minutes",()=>{
  assert.equal(gtfsSeconds("25:10:00"),90600);
  assert.throws(()=>gtfsSeconds("00:60:00"));
  assert.throws(()=>gtfsSeconds("12:01"));
});
test("holiday exceptions override a weekly timetable and can add service",()=>{
  const calendar={start_date:"20260101",end_date:"20261231",thursday:"1"};
  assert.equal(activeService(calendar,[],"20261029"),true);
  assert.equal(activeService(calendar,[{date:"20261029",exception_type:"2"}],"20261029"),false);
  assert.equal(activeService(undefined,[{date:"20261031",exception_type:"1"}],"20261031"),true);
  assert.equal(activeService(calendar,[],"20271029"),false);
});
test("overnight departures stay attached to their service day",()=>{
  const at=serviceInstant("20261029",gtfsSeconds("25:10:00"));
  assert.equal(DateTime.fromMillis(at,{zone:ZONE}).toFormat("yyyy-MM-dd HH:mm"),"2026-10-30 01:10");
  assert.ok(serviceDates(at).includes("20261029"));
});
test("GTFS day anchor uses noon minus twelve elapsed hours across DST",()=>{
  for(const day of ["20260308","20261101"]){
    const noon=DateTime.fromFormat(day,"yyyyMMdd",{zone:ZONE}).set({hour:12}).toMillis();
    assert.equal(serviceInstant(day,0),noon-12*3600000);
    assert.equal(serviceInstant(day,25*3600)-serviceInstant(day,0),25*3600000);
  }
});
test("directions distinguish branch destinations, not generic uptown bus labels",()=>{
  const trip={direction_id:"1",trip_headsign:"JAMAICA"};
  assert.equal(patternLabel(trip),"1 · JAMAICA");
  assert.equal(matchesPattern(trip,"1 · JAMAICA"),true);
  assert.equal(matchesPattern(trip,"0 · JAMAICA"),false);
  assert.equal(patternLabel({}),"0 · Direction 0");
  assert.equal(resolvePattern(["0 · JAMAICA","1 · PENN"],"Inbound"),"1 · PENN");
  assert.equal(resolvePattern(["0 · JAMAICA","1 · PENN"],"Uptown"),"0 · JAMAICA");
  assert.equal(resolvePattern(["0 · JAMAICA","1 · PENN"],"1 · PENN"),"1 · PENN");
});
test("Google polyline coordinates retain longitude/latitude order",()=>{
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"),[[-120.2,38.5],[-120.95,40.7],[-126.453,43.252]]);
  assert.throws(()=>decodePolyline("_"));
});
