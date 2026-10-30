import { Router, type IRouter } from "express";
import { GetStopsQueryParams, GetStopsResponse, GetStopParams, GetStopQueryParams, GetStopResponse, GetRouteParams, GetRouteQueryParams, GetRouteResponse, GetSourcesResponse, GetAlertsQueryParams, GetAlertsResponse } from "@workspace/api-zod";
import { nearby, stopDetail, routeDetail, sources, trackedVehicles } from "../transit/service";
import { demoAlerts } from "../transit/demo";
import { liveAlerts } from "../transit/realtime";
import { contributionLimit, start, authorize, end, sample, report } from "../transit/rides";
import { GetNetworkQueryParams, GetNetworkResponse } from "@workspace/api-zod";
import { network, mapVehicles } from "../transit/network";
import { validBounds } from "../transit/map-geometry";
import { GetMapVehiclesQueryParams, GetMapVehiclesResponse } from "@workspace/api-zod";
import { GetCatalogQueryParams,GetCatalogResponse,GetTimetableQueryParams,GetTimetableResponse,PlanJourneyBody,PlanJourneyResponse } from "@workspace/api-zod";
import { catalog,timetable } from "../transit/catalog";
import { journeyLimit,planJourney,JourneyError } from "../transit/journeys";
const router:IRouter=Router();
import { GetIntercityProvidersResponse, GetIntercityDeparturesQueryParams, GetIntercityDeparturesResponse } from "@workspace/api-zod";
import { intercityProviders, intercityDepartures } from "../transit/intercity/service";
import { amtrakTrainDetail } from "../transit/amtrak-service";
import { GetTrainResponse } from "@workspace/api-zod";
router.use("/transit",(_req,res,next)=>{res.set("Cache-Control","no-store");next();});
router.get("/transit/trains/:id",async(req,res):Promise<void>=>{
  if(typeof req.params.id!=="string"||req.params.id.length>180){res.status(400).json({error:"Invalid train identity"});return;}
  const train=await amtrakTrainDetail(req.params.id);
  if(!train){res.status(404).json({error:"No observation or published service for this dated train run"});return;}
  res.json(GetTrainResponse.parse(train));
});
router.get("/transit/intercity/providers",async(_req,res):Promise<void>=>{
  res.json(GetIntercityProvidersResponse.parse(await intercityProviders()));
});
router.get("/transit/intercity/departures",async(req,res):Promise<void>=>{
  const p=GetIntercityDeparturesQueryParams.safeParse(req.query);
  if(!p.success){res.status(400).json({error:"Choose valid coordinates, date and time"});return;}
  try{res.json(GetIntercityDeparturesResponse.parse(await intercityDepartures(p.data)));}
  catch(error){if(error instanceof Error&&error.message==="Invalid intercity date or time"){
    res.status(400).json({error:error.message});return;
  }throw error;}
});
router.get("/transit/catalog",async(req,res):Promise<void>=>{
  const p=GetCatalogQueryParams.safeParse(req.query);
  if(!p.success){res.status(400).json({error:"Invalid catalog filters or page"});return;}
  res.json(GetCatalogResponse.parse(await catalog(p.data)));
});
router.get("/transit/timetable",async(req,res):Promise<void>=>{
  const p=GetTimetableQueryParams.safeParse(req.query);
  if(!p.success){res.status(400).json({error:"Choose a valid date, time and timetable page"});return;}
  let result;
  try{result=await timetable(p.data);}catch(error){
    if(error instanceof Error&&["Invalid timetable date or time","Select a stop or route","Stop and route must belong to the same operator"].includes(error.message)){
      res.status(400).json({error:error.message});return;
    }throw error;
  }
  res.json(GetTimetableResponse.parse(result));
});
router.post("/transit/journeys",journeyLimit,async(req,res):Promise<void>=>{
  const p=PlanJourneyBody.safeParse(req.body);
  if(!p.success||!p.data.origin.trim()||!p.data.destination.trim()){res.status(400).json({error:"Enter both journey locations and valid preferences"});return;}
  try{res.json(PlanJourneyResponse.parse(await planJourney(p.data)));}
  catch(error){if(error instanceof JourneyError){res.status(error.status).json({error:error.message});return;}throw error;}
});
router.get("/transit/stops",async(req,res):Promise<void>=>{
  const p=GetStopsQueryParams.safeParse(req.query);
  if(!p.success||p.data.lat!=null&&Math.abs(p.data.lat)>90||p.data.lon!=null&&Math.abs(p.data.lon)>180){res.status(400).json({error:"Invalid search coordinates"});return;}
  res.json(GetStopsResponse.parse(await nearby(p.data)));
});
router.get("/transit/stops/:id",async(req,res):Promise<void>=>{
  const p=GetStopParams.safeParse(req.params),q=GetStopQueryParams.safeParse(req.query);
  if(!p.success||!q.success){res.status(400).json({error:"Invalid stop request"});return;}
  const s=await stopDetail(p.data.id,q.data.mode||"demo");
  if(!s){res.status(404).json({error:"Stop unavailable in this data mode"});return;}
  res.json(GetStopResponse.parse(s));
});
router.get("/transit/routes/:id",async(req,res):Promise<void>=>{
  const p=GetRouteParams.safeParse(req.params),q=GetRouteQueryParams.safeParse(req.query);
  if(!p.success||!q.success){res.status(400).json({error:"Invalid route request"});return;}
  const r=await routeDetail(p.data.id,q.data.mode||"demo",q.data.direction);
  if(!r){res.status(404).json({error:"Route unavailable in this data mode"});return;}
  res.json(GetRouteResponse.parse(r));
});
router.get("/transit/sources",async(_req,res):Promise<void>=>{res.json(GetSourcesResponse.parse(await sources()));});
router.get("/transit/network",async(req,res):Promise<void>=>{
  const p=GetNetworkQueryParams.safeParse(req.query);
  if(!p.success||p.data.lat!=null&&Math.abs(p.data.lat)>90||p.data.lon!=null&&Math.abs(p.data.lon)>180){res.status(400).json({error:"Invalid map request"});return;}
  const b=p.data, count=[b.west,b.south,b.east,b.north].filter(v=>v!=null).length;
  if(count!==0&&(count!==4||!validBounds(b as {west:number;south:number;east:number;north:number}))){
    res.status(400).json({error:"Supply ordered west, south, east and north map bounds"});return;
  }
  if((b.lat==null)!==(b.lon==null)){res.status(400).json({error:"Supply both map center coordinates"});return;}
  res.json(GetNetworkResponse.parse(await network(b)));
});
router.get("/transit/map-vehicles",async(req,res):Promise<void>=>{
  const p=GetMapVehiclesQueryParams.safeParse(req.query);
  if(!p.success){res.status(400).json({error:"Invalid data mode"});return;}
  res.json(GetMapVehiclesResponse.parse(await trackedVehicles(p.data.mode)));
});
router.get("/transit/alerts",async(req,res):Promise<void>=>{
  const p=GetAlertsQueryParams.safeParse(req.query);
  if(!p.success){res.status(400).json({error:"Invalid data mode"});return;}
  res.json(GetAlertsResponse.parse(p.data.mode==="live"?liveAlerts():demoAlerts));
});
router.post("/transit/rides",contributionLimit,start);
router.delete("/transit/rides/:id",authorize,end);
router.post("/transit/rides/:id/samples",contributionLimit,authorize,sample);
router.post("/transit/rides/:id/reports",contributionLimit,authorize,report);
export default router;
