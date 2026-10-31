import test from 'node:test';
import assert from 'node:assert/strict';
import { amtrakVisible,vehicleFresh,safeAmtrakArrival } from '../src/lib/vehicle-visibility.ts';

test('numbered Amtrak markers survive missing route geometry, while respecting chosen place, mode and operator',()=>{
  const v={lat:39,lon:-105,routeId:'amtrak:96'};
  assert.equal(amtrakVisible(v,{agency:'amtrak',type:'rail',west:-106,east:-104,south:38,north:40}),true);
  for(const filters of [{agency:'mta-mnr'},{type:'bus'},{routeId:'amtrak:other'},{serviceClass:'express'},{west:-74,east:-72,south:40,north:42}])
    assert.equal(amtrakVisible(v,filters),false);
  assert.equal(amtrakVisible({lat:39,lon:-105},{}),true);
});
test('offline or failed refresh cannot extend a live prediction beyond its source expiry',()=>{
  const now=Date.parse('2026-10-31T14:00:00Z');
  const live={source:'live',trainNumber:'5',updatedAt:new Date(now).toISOString(),
    expiresAt:new Date(now+300_000).toISOString(),publishedAt:new Date(now+600_000).toISOString()};
  assert.equal(safeAmtrakArrival(live,now).source,'live');
  const fallback=safeAmtrakArrival(live,now+300_001);
  assert.equal(fallback.source,'scheduled');assert.equal(fallback.scheduledAt,live.publishedAt);
  assert.equal(fallback.minutes,5);
  assert.equal(safeAmtrakArrival({...live,publishedAt:undefined},now+300_001).source,'unavailable');
});
test('map independently enforces five-minute source expiry and future-clock tolerance, not generic agency TTL',()=>{
  const now=Date.parse('2026-10-31T14:00:00Z');
  const v={agencyId:'amtrak',updatedAt:new Date(now).toISOString(),expiresAt:new Date(now+300_000).toISOString()};
  for(const age of [-30_001,-30_000,0,300_000,300_001])
    assert.equal(vehicleFresh(v,now+age),age>=-30_000&&age<=300_000);
  assert.equal(vehicleFresh({...v,expiresAt:undefined},now),false);
  assert.equal(vehicleFresh({...v,expiresAt:new Date(now+999_999).toISOString()},now+300_001),false);
  assert.equal(vehicleFresh({...v,agencyId:'mta-mnr'},now+60_001),false);
});
test('Metrobus GPS cannot outlive the supplied expiry or refresh a stale observation',()=>{
  const now=Date.parse('2026-10-31T14:00:00Z');
  const v={agencyId:'wmata',updatedAt:new Date(now-10_000).toISOString(),expiresAt:new Date(now+20_000).toISOString()};
  assert.equal(vehicleFresh(v,now),true);
  assert.equal(vehicleFresh(v,now+20_001),false);
  assert.equal(vehicleFresh({...v,expiresAt:'invalid'},now),false);
  assert.equal(vehicleFresh({...v,expiresAt:new Date(now+999_999).toISOString()},now+50_001),false);
});
