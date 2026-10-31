import { Router, type IRouter } from "express";
import { GetEntryCountryResponse } from "@workspace/api-zod";
import { ingressClientAddress, lookupEntryCountry, type EntryCountry } from "../lib/entry-country";

export function createEntryRouter(lookup = lookupEntryCountry): IRouter {
  const router: IRouter = Router();
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
