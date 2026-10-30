/** The CT feed's optional display extensions decode to control-encoded
 * strings with this protobuf binding. NUL cannot be stored in PostgreSQL JSONB.
 * Discard only invalid, unused display metadata, never identifiers or times. */
export function normalizeCtRealtime(entities:any[]) {
  for(const entity of entities){
    const tripProperties=entity.tripUpdate?.tripProperties;
    if(typeof tripProperties?.tripShortName==="string"&&tripProperties.tripShortName.includes("\u0000"))
      delete tripProperties.tripShortName;
    for(const update of entity.tripUpdate?.stopTimeUpdate||[]){
      const properties=update.stopTimeProperties;
      if(typeof properties?.stopHeadsign==="string"&&properties.stopHeadsign.includes("\u0000"))
        delete properties.stopHeadsign;
    }
  }
}
