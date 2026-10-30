/** All timetable controls use New York time, regardless of the browser's zone. */
function parts(at:Date,zone='America/New_York') {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).formatToParts(at).map(p=>[p.type,p.value]));
}
export function newYorkDate(at=new Date()) {return zonedDate(at,'America/New_York');}
export function newYorkTime(at=new Date()) {return zonedTime(at,'America/New_York');}
export function zonedDate(at=new Date(),zone='America/New_York') {const p=parts(at,zone);return `${p.year}-${p.month}-${p.day}`;}
export function zonedTime(at=new Date(),zone='America/New_York') {const p=parts(at,zone);return `${p.hour}:${p.minute}`;}
export function newYorkInstant(date:string,time:string) {
  const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number);
  const wall=Date.UTC(y,m-1,d,h,min);
  let instant=wall;
  for(let i=0;i<3;i++){
    const p=parts(new Date(instant));
    const rendered=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute);
    instant+=wall-rendered;
  }
  if(newYorkDate(new Date(instant))!==date||newYorkTime(new Date(instant))!==time)throw new Error('That New York time does not exist because the clocks change. Choose another time.');
  return new Date(instant).toISOString();
}
