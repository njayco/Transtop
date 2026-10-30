/** Limit a shared publisher archive to explicitly approved operator IDs.
 * Unfiltered adapters retain the existing importer behavior. */
export class GtfsSelection {
  private agencies: Set<string>;
  private routes=new Set<string>();
  private trips=new Set<string>();
  private services=new Set<string>();
  private shapes=new Set<string>();
  private stops=new Set<string>();
  constructor(agencyIds?:string[],private routeTypes?:string[]) { this.agencies=new Set(agencyIds); }
  accept(table:string,row:Record<string,string>):boolean {
    if(!this.agencies.size)return true;
    if(table==="agency")return this.agencies.has(row.agency_id);
    if(table==="routes"){
      if(!this.agencies.has(row.agency_id))return false;
      if(this.routeTypes&&!this.routeTypes.includes(row.route_type))return false;
      this.routes.add(row.route_id);return true;
    }
    if(table==="trips"){
      if(!this.routes.has(row.route_id))return false;
      this.trips.add(row.trip_id);this.services.add(row.service_id);
      if(row.shape_id)this.shapes.add(row.shape_id);
      return true;
    }
    if(table==="calendar"||table==="calendar_dates")return this.services.has(row.service_id);
    if(table==="stop_times"){
      if(!this.trips.has(row.trip_id))return false;
      this.stops.add(row.stop_id);return true;
    }
    if(table==="shapes")return this.shapes.has(row.shape_id);
    return false;
  }
  retainStops(all:Map<string,Record<string,string>>){
    if(!this.agencies.size)return;
    const used=new Set(this.stops);
    for(const id of used){
      const parent=all.get(id)?.parent_station;
      if(parent)used.add(parent);
    }
    for(const id of all.keys())if(!used.has(id))all.delete(id);
  }
}

export function isExpressRoute(agency:string,name:string,description:string) {
  return /^(?:BM|BXM|QM|SIM|X)\d/i.test(name)||/\dX$/i.test(name)||/\bexpress\b/i.test(description)||
    (agency==="cttransit"&&/^9\d{2}(?:\/9\d{2})?[A-Z]?$/i.test(name));
}
