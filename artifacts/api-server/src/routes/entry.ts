import { Router, type IRouter } from "express";
import { GetEntryCountryResponse, GetEntryLocationResponse } from "@workspace/api-zod";
import { ingressClientAddress, lookupEntryCountry, type EntryCountry } from "../lib/entry-country";
import { lookupEntryLocation, unknownLocation, type EntryLocation } from "../lib/entry-location";

export function createEntryRouter(lookup = lookupEntryCountry, locationLookup = lookupEntryLocation): IRouter {
  const router: IRouter = Router();
  router.get("/entry/location",async(req,res):Promise<void>=>{
    res.set({"Cache-Control":"private, no-store, max-age=0","CDN-Cache-Control":"no-store","Surrogate-Control":"no-store",Pragma:"no-cache",Expires:"0",Vary:"*"});
    let timeout:ReturnType<typeof setTimeout>|undefined;
    let location:EntryLocation=unknownLocation();
    try{
      location=await Promise.race([
        locationLookup(ingressClientAddress(req)),
        new Promise<EntryLocation>(resolve=>{timeout=setTimeout(()=>resolve(unknownLocation()),350);}),
      ]);
      const checked=GetEntryLocationResponse.safeParse(location);
      location=checked.success?checked.data:unknownLocation();
    }catch{/* Never log an exception/address or block access for cosmetic geolocation. */}
    finally{clearTimeout(timeout);}
    res.json(GetEntryLocationResponse.parse(location));
  });
  router.get("/entry/country", async (req, res): Promise<void> => {
    res.set({
      "Cache-Control": "private, no-store, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Surrogate-Control": "no-store",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "*",
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let country: EntryCountry = null;
    try {
      country = await Promise.race([
        lookup(ingressClientAddress(req)),
        new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 200); }),
      ]);
    } catch { /* Styling must never prevent entry or leak exception/address text. */ }
    finally { clearTimeout(timeout); }
    res.json(GetEntryCountryResponse.parse({ country }));
  });
  return router;
}
export default createEntryRouter();
