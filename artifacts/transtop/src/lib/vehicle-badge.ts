import type { MapVehicle } from '../components/transit-map';

const subwayColors:Record<string,string>={1:'#EE352E',2:'#EE352E',3:'#EE352E',4:'#00933C',5:'#00933C',6:'#00933C',7:'#B933AD',A:'#0039A6',C:'#0039A6',E:'#0039A6',B:'#FF6319',D:'#FF6319',F:'#FF6319',M:'#FF6319',G:'#6CBE45',J:'#996633',Z:'#996633',N:'#FCCC0A',Q:'#FCCC0A',R:'#FCCC0A',W:'#FCCC0A',L:'#A7A9AC',S:'#808183'};
const escape=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
export function vehicleBadge(v:MapVehicle) {
  const agency=v.agencyId||v.routeId?.split(':')[0]||'';
  const subway=agency==='mta-subway',bus=v.vehicleType==='bus'||v.vehicleType==='intercity'||agency==='mta-bus'||agency==='cttransit'||agency==='intercity';
  const name=v.routeName||v.routeId?.split(':').slice(1).join(':')||'';
  const text=(v.trainNumber||name|| (bus?'BUS':'TRAIN')).slice(0,10);
  const color=subway?subwayColors[text.replace(/X$/,'')]||v.color||'#808183':v.color||'#1769AA';
  const safeColor=/^#[0-9a-f]{6}$/i.test(color)?color:'#1769AA';
  const rgb=[1,3,5].map(i=>parseInt(safeColor.slice(i,i+2),16));
  const ink=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>155?'#111111':'#ffffff';
  const width=subway?34:Math.max(56,Math.min(104,text.length*7+26));
  const glyph=bus?'<rect x="7" y="9" width="12" height="13" rx="2"/><path d="M7 15h12M10 23v2m6-2v2"/>':'<rect x="7" y="8" width="12" height="14" rx="4"/><path d="M7 15h12m-9 8-3 3m9-3 3 3"/>';
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="34" viewBox="0 0 ${width} 34">${/community/i.test(v.source)?'<circle cx="17" cy="17" r="14" fill="#5cc2f2" fill-opacity=".2" stroke="#5cc2f2" stroke-width="2" stroke-dasharray="3 3"/>':`${subway?`<circle cx="17" cy="17" r="15.5" fill="${safeColor}" stroke="white" stroke-width="2"/>`:`<rect x="1" y="2" width="${width-2}" height="30" rx="8" fill="${safeColor}" stroke="white" stroke-width="2"/><g fill="none" stroke="${ink}" stroke-width="1.5">${glyph}</g>`}<text x="${subway?17:26+(width-26)/2}" y="22" text-anchor="middle" fill="${ink}" font-family="Arial,sans-serif" font-size="${subway?19:11}" font-weight="bold">${escape(text)}</text>`}</svg>`;
  return {url:`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,width,height:34,text,color:safeColor};
}
