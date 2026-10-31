import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeFeed, licenseOf, archiveUrl, routeMode, duplicateSource, publicUrl } from "../src/transit/mobility/model";
import { directDuplicate, identity } from "../src/transit/transitland/model";
import { serviceInstant } from "../src/transit/time";
import { GetMobilityFeedsQueryParams, GetMobilityFeedsResponse } from "@workspace/api-zod";

const now = Date.parse("2026-11-01T05:00:00Z");
const raw = {
  id:"mdb-935",data_type:"gtfs",provider:"Canberra Metro Operations",official:true,status:"active",
  source_info:{authentication_type:0,producer_url:"https://www.transport.act.gov.au/googletransit/google_transit_lr.zip",
    license_id:"CC-BY-4.0",license_is_spdx:true,license_url:"https://creativecommons.org/licenses/by/4.0/legalcode"},
  locations:[{country_code:"AU",country:"Australia",subdivision_name:"ACT",municipality:"Canberra"}],
  external_ids:[{source:"tld",external_id:"f-test-canberra"}],
  latest_dataset:{id:"mdb-935-20261030",hosted_url:"https://files.mobilitydatabase.org/mdb-935/mdb-935-20261030/mdb-935-20261030.zip",
    agency_timezone:"Australia/Sydney",service_date_range_start:"2026-01-01T00:00:00Z",service_date_range_end:"2026-12-31T12:59:00Z",
    downloaded_at:"2026-10-30T01:00:00Z",zipped_folder_size_mb:0.2,unzipped_folder_size_mb:2}
};
test("official licensed current small feeds normalize with safe provenance",()=>{
  const f=normalizeFeed(raw,[],false,now)!;
  assert.equal(f.eligible,true);assert.equal(f.timezone,"Australia/Sydney");assert.equal(f.transitlandId,"f-test-canberra");
  assert.equal(f.license,"CC-BY-4.0");assert.equal(f.regions[0],"Canberra, ACT, Australia");
  assert.equal("feed_contact_email" in f,false);
  assert.equal(publicUrl("https://example.org/feed?api_key=not-a-real-key"),"https://example.org/feed");
  const response=GetMobilityFeedsResponse.parse({feeds:[f],offset:0,hasMore:false,status:"Catalog only"});
  assert.equal("hostedUrl" in response.feeds[0],false);
  assert.equal("producerUrl" in response.feeds[0],false);
});
test("unknown, contradictory, share-alike, stale, future, auth and oversize feeds are withheld",()=>{
  for(const patch of [
    {status:"deprecated"},{official:false},
    {source_info:{...raw.source_info,license_is_spdx:false}},
    {source_info:{...raw.source_info,license_id:"CC-BY-SA-4.0"}},
    {source_info:{...raw.source_info,license_url:"https://example.org/CC-BY-4.0"}},
    {source_info:{...raw.source_info,authentication_type:1}},
    ...[{service_date_range_end:"2025-01-01"},{service_date_range_start:"2030-01-01"},{service_date_range_end:"invalid"},
      {agency_timezone:"Not/AZone"},{zipped_folder_size_mb:21},{unzipped_folder_size_mb:101},
      {hosted_url:"https://127.0.0.1/feed.zip"}].map(p=>({latest_dataset:{...raw.latest_dataset,...p}}))
  ])assert.equal(normalizeFeed({...raw,...patch},[],false,now)!.eligible,false,JSON.stringify(patch));
  assert.equal(licenseOf({source_info:{...raw.source_info,license_id:"CC0-1.0"}}),undefined);
});
test("fixed archive host and credential redaction prevent catalog URL escalation",()=>{
  for(const url of ["http://files.mobilitydatabase.org/a/b/c.zip","https://files.mobilitydatabase.org.evil.org/a/b/c.zip",
    "https://files.mobilitydatabase.org:8443/a/b/c.zip","https://user:pass@files.mobilitydatabase.org/a/b/c.zip",
    "https://files.mobilitydatabase.org/a/b/c.zip?token=secret","https://files.mobilitydatabase.org/a/../x.zip"])assert.equal(archiveUrl(url),undefined);
  assert.equal(publicUrl("https://user:pass@example.org/"),undefined);
});
test("mixed and extended modes preserve buses versus intercity and omit unsupported modes",()=>{
  for(const [native,mode] of [["0","rail"],["1","subway"],["2","rail"],["3","bus"],["109","rail"],["201","intercity"],["202","intercity"],["208","bus"],["702","bus"],["900","rail"]])assert.equal(routeMode(native),mode);
  assert.equal(routeMode("4"),undefined);assert.equal(routeMode("6"),undefined);
});
test("exact direct URL precedence and Transitland crosswalk suppress only matching routes",()=>{
  const direct={id:"direct",name:"Direct",type:"rail" as const,staticUrl:raw.source_info.producer_url,realtimeUrls:[],documentation:"",status:"",setup:""};
  assert.equal(duplicateSource(raw,[direct]),true);
  const local={id:"mobility-mdb-935:R1",name:"1",type:"rail" as const,color:"#123456",agency:"Agency",
    mobility:{feedId:"mdb-935",datasetId:"d",url:"",license:"CC-BY-4.0",licenseUrl:"",attribution:"",timezone:"Australia/Sydney",downloadedAt:"",validFrom:"",validThrough:"",transitlandId:"f-test-canberra"}};
  const remote={...local,mobility:undefined,id:identity("f-test-canberra","R1"),
    transitland:{feedId:"f-test-canberra",fetchedAt:"",license:"CC-BY-4.0",attribution:"",url:""}};
  assert.equal(directDuplicate(remote,[local]),true);
  assert.equal(directDuplicate({...remote,id:identity("f-test-canberra","R2")},[local]),false);
});
test("source-zone overnight times and bounded catalog parameters",()=>{
  assert.equal(new Date(serviceInstant("20261101",25*3600,"Australia/Sydney")).toISOString(),"2026-11-01T14:00:00.000Z");
  assert.equal(GetMobilityFeedsQueryParams.safeParse({country:"AU",kind:"gtfs_rt",offset:"20"}).success,true);
  for(const params of [{country:"Australia"},{offset:"-1"},{offset:"10001"},{kind:"http://localhost"}])assert.equal(GetMobilityFeedsQueryParams.safeParse(params).success,false);
});
