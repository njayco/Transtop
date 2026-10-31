/** Provider filters select a feed, not a different carrier on each result page. */
export function providerName(id:string,operatorName:string){
  return id==="idfm"?"Île-de-France Mobilités":operatorName;
}
/** A combined feed can legitimately appear under more than one mode. */
export function sourceMatchesMode(source:{id:string;type?:string},mode:string){
  return !mode||mode==="all"||source.type===mode||
    source.id==="idfm"&&["bus","subway","rail"].includes(mode)||
    source.id==="wmata"&&["bus","subway"].includes(mode);
}
