import type { OdptInfo } from '@workspace/api-client-react';
export function OdptDetails({info}:{info?:OdptInfo}){
  if(!info)return null;
  return <section className="space-y-2 rounded-xl border border-white/10 p-4 text-sm text-muted-foreground" aria-label="ODPT source and coverage">
    <h2 className="font-bold text-foreground">ODPT · {info.modeDetail}</h2>
    <p>{info.attribution}</p>
    <p>Published source update: {new Date(info.publishedAt).toLocaleString()}. Version: {info.version}.</p>
    <p>Valid {info.validFrom}–{info.validThrough} · {info.timezone}. {info.realtime}</p>
    <p>Selected operators only, not complete Japan coverage. No shapes means no route line; schedules never become moving vehicles. Accessibility is only confirmed when explicitly supplied.</p>
    <div className="flex flex-wrap gap-x-4">
      <a href={info.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center underline">Official dataset and resources</a>
      <a href={info.license} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center underline">CC BY 4.0</a>
      <a href={info.terms} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center underline">ODPT credit terms</a>
    </div>
  </section>;
}
