import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import {trackedVehicleVisible} from '../src/lib/vehicle-visibility.ts';

async function setup(){
  const paths=[],markers=[],popups=[],frames=new Map();let now=0,id=0;
  class Layer{
    detached=0;updates=0;handlers=new Map();
    constructor(options){this.options=options;}
    setOptions(options){Object.assign(this.options,options);this.updates++;}
    setMap(map){if(map===null)this.detached++;}
    addListener(name,fn){this.handlers.set(name,fn);return {remove:()=>this.handlers.delete(name)};}
  }
  class Polyline extends Layer{constructor(options){super(options);paths.push(this);}}
  class Marker extends Layer{
    constructor(options){super(options);markers.push(this);}
    setPosition(position){this.options.position=position;}
  }
  class InfoWindow{closed=0;constructor(){popups.push(this);}close(){this.closed++;}setContent(){}open(){}}
  const context=vm.createContext({console,Map,Set,JSON,Math,
    performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    window:{matchMedia:()=>({matches:false})},document:{documentElement:{classList:{contains:()=>false}},createElement:()=>({style:{},append(){}})},
    google:{maps:{Polyline,SymbolPath:{CIRCLE:'circle'},Size:class {constructor(w,h){this.width=w;this.height=h;}},Point:class{constructor(x,y){this.x=x;this.y=y;}}}}
  });
  const loaded=new Map();
  async function load(name){
    if(loaded.has(name))return loaded.get(name);
    if(name==='../components/transit'){
      const m=new vm.SyntheticModule(['MODE_COLOR'],function(){this.setExport('MODE_COLOR',{subway:'#EE352E',bus:'#008800'});},{context});loaded.set(name,m);return m;
    }
    const code=await readFile(new URL(`../src/lib/${name}.ts`,import.meta.url),'utf8');
    const output=ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
    const m=new vm.SourceTextModule(output,{context});loaded.set(name,m);
    await m.link(spec=>load(spec==='./vehicle-badge'?'vehicle-badge':spec));return m;
  }
  const m=await load('map-overlays');await m.evaluate();
  const badge=loaded.get('vehicle-badge').namespace.vehicleBadge;
  return {layers:new m.namespace.MapOverlays({},Marker,InfoWindow,()=>{},()=>{},()=>{}),paths,markers,popups,badge,
    frame(at){now=at;const work=[...frames.values()];frames.clear();work.forEach(fn=>fn(at));}};
}
const line={id:'mta-subway:2',shapeId:'shape-2',type:'subway',name:'2',color:'#EE352E',coords:[[-74,40.7],[-73.9,40.8]]};
const stop={id:'stop-1',name:'Station',lat:40.7,lon:-74,type:'subway'};
const vehicle={id:'train-1',lat:40.7,lon:-74,source:'official GPS vehicle',routeId:'mta-subway:2',routeName:'2',updatedAt:'2026-10-30T21:00:00Z'};
test('refreshes retain line, stop and vehicle objects; selection restyles instead of removing lines',async()=>{
  const s=await setup();s.layers.setLines([line]);s.layers.setStops([stop]);s.layers.setVehicles([vehicle]);
  const originals=[...s.paths,...s.markers];s.markers[1].handlers.get('click')();
  for(let i=0;i<4;i++){s.layers.setLines([JSON.parse(JSON.stringify(line))]);s.layers.setStops([{...stop}]);s.layers.setVehicles([{...vehicle}]);}
  assert.equal(s.paths.length,2);assert.equal(s.markers.length,2);assert.equal(s.popups[0].closed,0);
  s.layers.setLines([{...line,color:'#555555'}]);assert.equal(s.paths.length,2);assert.equal(s.paths[1].options.strokeColor,'#555555');
  originals.forEach(o=>assert.equal(o.detached,0));s.layers.dispose();originals.forEach(o=>assert.equal(o.detached,1));
});
test('GPS movement updates the same marker between observations without disturbing routes or stops',async()=>{
  const s=await setup();s.layers.setLines([line]);s.layers.setStops([stop]);s.layers.setVehicles([vehicle]);
  s.layers.setVehicles([{...vehicle,lat:40.702}]);s.frame(600);
  assert.ok(Math.abs(s.markers[1].options.position.lat-40.701)<1e-8);
  s.frame(1200);assert.equal(s.markers[1].options.position.lat,40.702);
  assert.equal(s.markers.length,2);assert.equal(s.paths.length,2);
  s.layers.setVehicles([]);assert.equal(s.markers[1].detached,1);assert.equal(s.markers[0].detached,0);assert.equal(s.paths[0].detached,0);
});
test('station reports snap to the reported station, never animate invented GPS travel',async()=>{
  const s=await setup();s.layers.setVehicles([{...vehicle,source:'next station report (not GPS)'}]);
  s.layers.setVehicles([{...vehicle,source:'next station report (not GPS)',lat:40.702}]);
  assert.equal(s.markers[0].options.position.lat,40.702);
});
test('2 train has a red circle badge, with readable safe route labels for other modes',async()=>{
  const {badge}=await setup();const svg=decodeURIComponent(badge(vehicle).url);
  assert.match(svg,/<circle/);assert.match(svg,/#EE352E/);assert.match(svg,/>2<\/text>/);
  assert.match(decodeURIComponent(badge({...vehicle,routeId:'cttransit:1',routeName:'101',vehicleType:'bus'}).url),/>101<\/text>/);
  assert.ok(!decodeURIComponent(badge({...vehicle,routeName:'<script>',color:'bad'}).url).includes('<script>'));
});
test('real positions do not require a loaded shape and obey mode, operator, service and viewport filters',()=>{
  const filters={west:-75,east:-73,south:40,north:42,type:'subway'};
  assert.equal(trackedVehicleVisible(vehicle,filters,undefined,'subway'),true);
  assert.equal(trackedVehicleVisible(vehicle,{...filters,type:'bus'},undefined,'subway'),false);
  assert.equal(trackedVehicleVisible(vehicle,{...filters,agency:'cttransit'},undefined,'subway'),false);
  assert.equal(trackedVehicleVisible(vehicle,{...filters,serviceClass:'express'},undefined,'subway'),false);
  assert.equal(trackedVehicleVisible({...vehicle,lat:43},filters,undefined,'subway'),false);
});
