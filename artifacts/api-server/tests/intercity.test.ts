import { test } from "node:test";
import assert from "node:assert/strict";
import { clockMinutes, holidayDate, orderedPoints, parseMartz, printedInstant } from "../src/transit/intercity/martz";
import { providerInventory } from "../src/transit/intercity/providers";

const weekdayIn=["FMT#","WB","WVM","SCR","MTP","SR209","DWG","PV","NY",""];
const weekdayOut=["FMT#","Gate","NY","PV","DWG","SR209","MTP","SCR","WVM","WB"];
const weekendIn=["FMT#","WB","WVM","SCR","MTP","DWG","NY"];
const weekendOut=["FMT#","Gate","NY","DWG","MTP","SCR","WVM","WB"];
function table(headers:string[],rows:string[][]) {
  return `<table><tbody>${[headers,...rows].map(row=>`<tr>${row.map(cell=>`<td><b>${cell}</b></td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function fixture() {
  const heads=[weekdayIn,weekdayOut,weekendIn,weekendOut,weekendIn,weekendOut];
  const rows=heads.map((h,i)=>Array.from({length:4},(_,n)=>h.map(k=>k==="FMT#"?String(100+i*10+n):k==="Gate"?"25":
    k==="NY"?(i%2?"8:30am":"11:00am"):k==="DWG"?"10:00am":k==="MTP"?(i%2?"10:30am":"9:30am"):"")));
  return {heads,rows,html:()=>`Weekday Schedule Saturday Schedule Sunday Schedule Updated Schedule Effective April 6th, 2026 ${heads.map((h,i)=>table(h,rows[i])).join("")}`};
}
test("all 23 supplied rows are audited; aliases do not generate duplicate timetable sources",()=>{
  assert.equal(providerInventory.length,23);
  assert.equal(new Set(providerInventory.map(p=>p.id)).size,23);
  assert.ok(providerInventory.find(p=>p.id==="bonanza")?.aliases.includes("Peter Pan"));
  assert.ok(providerInventory.every(p=>p.checkedAt&&p.url.startsWith("https://")&&p.terminalService));
  assert.ok(providerInventory.find(p=>p.id==="nj-transit")?.status.includes("access"));
});
test("HTML normalization retains trip-specific patterns and calendar groups",()=>{
  const f=fixture();
  f.rows[1][0][f.heads[1].indexOf("PV")]="9:30am";
  const result=parseMartz(f.html(),Date.parse("2026-10-30T12:00:00Z"));
  assert.equal(result.trips.length,24);
  assert.equal(result.effectiveDate,"2026-04-06");
  assert.deepEqual(result.trips.find(t=>t.id==="martz:1:110")?.points.map(s=>s.code),["NY","PV","DWG","MTP"]);
  assert.deepEqual(result.trips.find(t=>t.id==="martz:1:111")?.points.map(s=>s.code),["NY","DWG","MTP"]);
  assert.deepEqual(result.trips.find(t=>t.id==="martz:3:130")?.days,[6]);
  assert.deepEqual(result.trips.find(t=>t.id==="martz:5:150")?.days,[7]);
});
test("footnotes, continuation trips, invalid times and changed layouts fail safely",()=>{
  const f=fixture();
  f.rows[0][0][0]="113*";
  f.rows[0][1][f.heads[0].indexOf("")]="Downtown";
  f.rows[5][0][f.heads[5].indexOf("NY")]="8:30am*";
  const result=parseMartz(f.html());
  assert.equal(result.omittedTrips,3);
  assert.equal(result.trips.length,21);
  assert.throws(()=>parseMartz("<table>missing timetable</table>"));
  assert.throws(()=>parseMartz(f.html().replace("FMT#","unexpected")));
  assert.throws(()=>clockMinutes("12:61pm"));
  assert.throws(()=>clockMinutes("8:30"));
  assert.throws(()=>clockMinutes("8:30am*"));
});
test("midnight rollover and New York DST are not silently guessed",()=>{
  const p=orderedPoints([{code:"NY",value:"11:30pm"},{code:"DWG",value:"12:55am"},{code:"MTP",value:"1:15am"}]);
  assert.deepEqual(p.map(v=>v.minutes),[1410,1495,1515]);
  assert.equal(printedInstant("2026-10-30",1495),"2026-10-31T00:55:00.000-04:00");
  assert.throws(()=>printedInstant("2026-11-01",75),"Ambiguous fall-back hour");
  assert.throws(()=>printedInstant("2026-03-08",150),"Nonexistent spring-forward hour");
  assert.equal(clockMinutes("12:00am"),0);
  assert.equal(clockMinutes("12:00pm"),720);
  assert.throws(()=>orderedPoints([{code:"NY",value:"11:30pm"},{code:"DWG",value:"12:55pm"},{code:"MTP",value:"1:15am"}]));
});
test("unverified holiday calendars suppress regular-day departures",()=>{
  assert.equal(holidayDate("2026-11-11"),true);
  assert.equal(holidayDate("2026-11-26"),true);
  assert.equal(holidayDate("2026-11-27"),true);
  assert.equal(holidayDate("2026-10-30"),false);
  assert.equal(holidayDate("2026-11-02"),false);
});
