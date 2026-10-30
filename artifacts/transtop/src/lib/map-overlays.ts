import type { MapLine, MapStop, MapVehicle } from '../components/transit-map';
import { MODE_COLOR } from '../components/transit';
import { vehicleBadge } from './vehicle-badge';

type LineEntry={paths:google.maps.Polyline[];listener?:google.maps.MapsEventListener;signature:string};
type MarkerEntry<T>={marker:google.maps.Marker;listener:google.maps.MapsEventListener;data:T;signature:string;iconUrl?:string;frame?:number;lat:number;lon:number};

/** Reconcile SDK objects by identity. Input refreshes must never tear down layers. */
export class MapOverlays {
  private lines=new Map<string,LineEntry>();
  private stops=new Map<string,MarkerEntry<MapStop>>();
  private vehicles=new Map<string,MarkerEntry<MapVehicle>>();
  private popup:google.maps.InfoWindow;
  private openId?:string;
  constructor(private map:google.maps.Map,private Marker:typeof google.maps.Marker,InfoWindow:typeof google.maps.InfoWindow,
    private onStop:(id:string)=>void,private onRoute:(id:string)=>void,private onTrain:(id:string)=>void) {
    this.popup=new InfoWindow();
  }
  setLines(network:MapLine[],shape?:{coords:number[][];color:string}|null) {
    const keep=new Set<string>();
    const entries=[...network.map(l=>({key:`${l.id}|${l.shapeId||JSON.stringify(l.coords)}`,line:l,selected:false})),
      ...(shape?[{key:'selected-route',line:{id:'selected-route',name:'',coords:shape.coords,color:shape.color} as MapLine,selected:true}]:[])];
    for(const {key,line,selected} of entries){
      if(line.coords.length<2)continue;
      keep.add(key);
      const signature=JSON.stringify([line.coords,line.color,line.type,selected]);
      let entry=this.lines.get(key);
      if(entry?.signature===signature)continue;
      const path=line.coords.map(([lng,lat])=>({lat,lng}));
      const halo={path,strokeColor:selected?line.color:MODE_COLOR[line.type||'']||line.color,strokeWeight:selected?11:9,strokeOpacity:selected?.2:.4,clickable:false,zIndex:selected?3:1};
      const visible={path,strokeColor:line.color,strokeWeight:selected?4:line.type==='rail'?5:3,strokeOpacity:line.type==='bus'?.35:1,zIndex:selected?4:line.type==='subway'?3:2,
        icons:line.type==='bus'?[{icon:{path:'M 0,-1 0,1',strokeOpacity:1,scale:2},offset:'0',repeat:'14px'}]:[]};
      if(entry){entry.paths[0].setOptions(halo);entry.paths[1].setOptions(visible);entry.signature=signature;}
      else{
        const paths=[new google.maps.Polyline({...halo,map:this.map}),new google.maps.Polyline({...visible,map:this.map})];
        entry={paths,signature,listener:selected?undefined:paths[1].addListener('click',()=>this.onRoute(line.id))};
        this.lines.set(key,entry);
      }
    }
    for(const [key,entry] of this.lines)if(!keep.has(key)){entry.listener?.remove();entry.paths.forEach(p=>p.setMap(null));this.lines.delete(key);}
  }
  private content(title:string,actions:{label:string;run:()=>void}[]){
    const content=document.createElement('div');content.style.cssText='color:#111;font:600 13px Arial,sans-serif;max-width:260px';
    const text=document.createElement('p');text.textContent=title;content.append(text);
    for(const a of actions){const b=document.createElement('button');b.type='button';b.textContent=a.label;b.style.cssText='display:block;text-decoration:underline;padding:8px 0;cursor:pointer';b.onclick=a.run;content.append(b);}
    return content;
  }
  setStops(stops:MapStop[],activeId?:string|null,labelStops=false){
    const keep=new Set<string>();
    stops.forEach((s,index)=>{
      keep.add(s.id);let entry=this.stops.get(s.id);
      const active=s.id===activeId,color=s.color||MODE_COLOR[s.type]||'#888';
      const title=`${s.name} stop${s.routes?.length?` · ${s.routes.map(r=>r.name).join(', ')}`:''}`;
      const options={position:{lat:s.lat,lng:s.lon},title,zIndex:active?100:20,
        icon:{path:google.maps.SymbolPath.CIRCLE,scale:labelStops?12:active?11:7,fillColor:color,fillOpacity:1,strokeColor:'#fff',strokeWeight:active?3:1.5},
        label:labelStops?{text:String(index+1),color:'#111',fontSize:'11px',fontWeight:'800'}:s.label||active?{text:s.name,color:'#fff',fontSize:'12px',className:'map-stop-label'}:null};
      const signature=JSON.stringify(options);
      if(entry){entry.data=s;if(signature!==entry.signature){entry.marker.setOptions(options);entry.signature=signature;}}
      else {
        const marker=new this.Marker({...options,map:this.map});
        const listener=marker.addListener('click',()=>{
          const data=this.stops.get(s.id)!.data;this.openId=s.id;
          this.popup.setContent(this.content(`${data.name} · ${data.routes?.map(r=>r.name).join(', ')||''}`,[{label:'Select stop for details',run:()=>this.onStop(s.id)}]));
          this.popup.open({map:this.map,anchor:marker});this.onStop(s.id);
        });
        this.stops.set(s.id,{marker,listener,data:s,signature,lat:s.lat,lon:s.lon});
      }
    });
    this.removeMissing(this.stops,keep);
  }
  setVehicles(vehicles:MapVehicle[]){
    const keep=new Set<string>();
    for(const v of vehicles){
      keep.add(v.id);let entry=this.vehicles.get(v.id);
      const badge=vehicleBadge(v);
      const title=`${v.routeName||badge.text}${v.trainNumber?` · train ${v.trainNumber}`:''}${v.destination?` · to ${v.destination}`:''} · ${v.source} · observed ${v.updatedAt||'unknown'}`;
      const options={title,zIndex:60,icon:{url:badge.url,scaledSize:new google.maps.Size(badge.width,badge.height),anchor:new google.maps.Point(badge.width/2,17)}};
      const signature=JSON.stringify([title,badge.url]);
      if(entry){
        const moved=entry.data.lat!==v.lat||entry.data.lon!==v.lon;
        entry.data=v;
        if(signature!==entry.signature){entry.marker.setOptions(entry.iconUrl===badge.url?{title}:options);entry.signature=signature;entry.iconUrl=badge.url;}
        if(!moved)continue;
        if(entry.frame!==undefined){cancelAnimationFrame(entry.frame);entry.frame=undefined;}
        const from={lat:entry.lat,lon:entry.lon},target=entry;
        // Ease only between two observed GPS points. Never extrapolate, or
        // invent travel between station reports. Large jumps snap to the report.
        const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('reduce-motion');
        const animate=!reduced&&!/not GPS|community/i.test(v.source)&&Math.hypot(from.lat-v.lat,from.lon-v.lon)<.04&&(from.lat!==v.lat||from.lon!==v.lon);
        if(animate){
          const start=performance.now();
          const step=(now:number)=>{const t=Math.min(1,Math.max(0,(now-start)/1200));target.lat=from.lat+(v.lat-from.lat)*t;target.lon=from.lon+(v.lon-from.lon)*t;
            target.marker.setPosition({lat:target.lat,lng:target.lon});target.frame=t<1?requestAnimationFrame(step):undefined;};
          entry.frame=requestAnimationFrame(step);
        }else{entry.lat=v.lat;entry.lon=v.lon;entry.marker.setPosition({lat:v.lat,lng:v.lon});}
      }else{
        const marker=new this.Marker({...options,map:this.map,position:{lat:v.lat,lng:v.lon}});
        const listener=marker.addListener('click',()=>{
          const data=this.vehicles.get(v.id)!.data;this.openId=v.id;
          this.popup.setContent(this.content(`${data.routeName||data.trainNumber||'Vehicle'} · ${data.source} · observed ${data.updatedAt}${data.destination?` · to ${data.destination}`:''}`,[
            ...(data.runId?[{label:'View train and ordered stops',run:()=>this.onTrain(data.runId!)}]:[]),
            ...(data.routeId?[{label:'View route',run:()=>this.onRoute(data.routeId!)}]:[])]));
          this.popup.open({map:this.map,anchor:marker});
        });
        this.vehicles.set(v.id,{marker,listener,data:v,signature,iconUrl:badge.url,lat:v.lat,lon:v.lon});
      }
    }
    this.removeMissing(this.vehicles,keep);
  }
  private removeMissing<T>(registry:Map<string,MarkerEntry<T>>,keep:Set<string>){
    for(const [id,entry]of registry)if(!keep.has(id)){
      if(entry.frame!==undefined)cancelAnimationFrame(entry.frame);
      if(this.openId===id){this.popup.close();this.openId=undefined;}
      entry.listener.remove();entry.marker.setMap(null);registry.delete(id);
    }
  }
  dispose(){
    this.popup.close();this.removeMissing(this.stops,new Set());this.removeMissing(this.vehicles,new Set());
    for(const entry of this.lines.values()){entry.listener?.remove();entry.paths.forEach(p=>p.setMap(null));}this.lines.clear();
  }
}
