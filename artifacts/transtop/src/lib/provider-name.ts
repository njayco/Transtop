/** Provider filters select a feed, not a different carrier on each result page. */
export function providerName(id:string,operatorName:string){
  return id==="idfm"?"Île-de-France Mobilités":operatorName;
}
