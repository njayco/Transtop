import { Router, type IRouter } from "express";
import { GetStopsQueryParams, GetStopsResponse, GetStopParams, GetStopQueryParams, GetStopResponse, GetRouteParams, GetRouteQueryParams, GetRouteResponse, GetSourcesResponse, GetAlertsQueryParams, GetAlertsResponse } from "@workspace/api-zod";
import { nearby, stopDetail, routeDetail, sources } from "../transit/service";
import { demoAlerts } from "../transit/demo";
import { liveAlerts } from "../transit/realtime";
import { contributionLimit, start, authorize, end, sample, report } from "../transit/rides";
import { GetNetworkQueryParams, GetNetworkResponse } from "@workspace/api-zod";
import { network } from "../transit/network";
const router:IRouter=Router();
router.use("/transit",(_req,res,next)=>{res.set("Cache-Control","no-store");next();});
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
  res.json(GetNetworkResponse.parse(await network(p.data.mode||"demo",p.data.type,p.data.lat,p.data.lon)));
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
