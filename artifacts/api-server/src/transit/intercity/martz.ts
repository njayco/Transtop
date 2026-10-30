import { DateTime } from "luxon";
import { ZONE } from "../time";

export type ScheduledPoint = { code: string; minutes: number };
export type PublishedTrip = { id: string; number: string; days: number[]; points: ScheduledPoint[]; gate?: string };
export type MartzDataset = { trips: PublishedTrip[]; fetchedAt: string; effectiveDate: string; omittedTrips: number };
export const cleanText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;|\u00a0/g, " ")
  .replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Explicit meridiem only. Footnotes or ambiguous times are not guessed. */
export function clockMinutes(value: string) {
  const m = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(value.trim());
  if (!m || +m[1] < 1 || +m[1] > 12 || +m[2] > 59) throw new Error("Ambiguous timetable time");
  return (+m[1] % 12 + (m[3].toLowerCase() === "pm" ? 12 : 0)) * 60 + +m[2];
}
export function orderedPoints(values: { code: string; value: string }[]) {
  let previous = -1, day = 0;
  return values.map(({ code, value }) => {
    let minutes = clockMinutes(value) + day * 1440;
    if (minutes < previous) { day++; minutes += 1440; }
    if (minutes > 2880 || previous >= 0 && minutes - previous > 360) throw new Error("Inconsistent trip chronology");
    previous = minutes;
    return { code, minutes };
  });
}
export function parseMartz(html: string, now = Date.now()): MartzDataset {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map(m => m[1])
    .filter(t => cleanText(t).includes("FMT#"));
  // The six directional/day sections are positional only after validating headers.
  if (tables.length !== 6 || !/Weekday Schedule/.test(html) || !/Saturday Schedule/.test(html) || !/Sunday Schedule/.test(html))
    throw new Error("Martz timetable layout changed");
  const effective = /Updated Schedule Effective\s+([A-Za-z]+\s+\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i.exec(cleanText(html));
  if (!effective) throw new Error("Missing published effective date");
  const effectiveDate = DateTime.fromFormat(`${effective[1]} ${effective[2]}`, "LLLL d yyyy", { zone: ZONE }).toISODate();
  if (!effectiveDate) throw new Error("Invalid published effective date");
  const trips: PublishedTrip[] = [];
  let omittedTrips = 0;
  tables.forEach((table, index) => {
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m =>
      [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => cleanText(c[1])));
    const headers = rows.shift()!;
    const outbound = index % 2 === 1;
    const expected = index < 2 ? outbound ? ["FMT#", "Gate", "NY", "PV", "DWG", "SR209", "MTP", "SCR", "WVM", "WB"] :
      ["FMT#", "WB", "WVM", "SCR", "MTP", "SR209", "DWG", "PV", "NY", ""] :
      outbound ? ["FMT#", "Gate", "NY", "DWG", "MTP", "SCR", "WVM", "WB"] : ["FMT#", "WB", "WVM", "SCR", "MTP", "DWG", "NY"];
    if (headers.join("|") !== expected.join("|")) throw new Error("Martz table headers changed");
    for (const row of rows) {
      try {
        if (row.length !== headers.length || !/^\d+[A-Z]?$/.test(row[0])) throw new Error("Special trip footnote");
        if (headers.some((code,i)=>!code&&row[i])) throw new Error("Continuation/footnote has no complete stop sequence");
        const values = headers.flatMap((code, i) => code && !["FMT#", "Gate"].includes(code) && row[i] ? [{ code, value: row[i] }] : []);
        const points = orderedPoints(values);
        if (points.length < 2 || (outbound ? points[0].code !== "NY" : points.at(-1)!.code !== "NY")) throw new Error("Invalid terminal service");
        // Customer-service page says weekday 06:15–08:30 DWG boardings use PNR.
        // Without an explicit matching timetable timepoint, withhold these rows.
        if (index === 0 && points.some(p => p.code === "DWG" && p.minutes >= 375 && p.minutes <= 510))
          throw new Error("Boarding location exception");
        trips.push({ id: `martz:${index}:${row[0]}`, number: row[0], days: index < 2 ? [1,2,3,4,5] : index < 4 ? [6] : [7],
          points, gate: outbound ? row[1] : undefined });
      } catch { omittedTrips++; }
    }
  });
  if (trips.length < 20 || trips.length > 150 || [1,6,7].some(day => !trips.some(t => t.days.includes(day))))
    throw new Error("Martz timetable incomplete");
  return { trips, omittedTrips, fetchedAt: new Date(now).toISOString(), effectiveDate };
}

/** No regular-day schedules on dates whose holiday overrides are unverified. */
export function holidayDate(date: string) {
  const d = DateTime.fromISO(date, { zone: ZONE }), y = d.year;
  const fixed = [[1,1],[6,19],[7,4],[11,11],[12,25]].flatMap(([month,day]) => {
    const v = DateTime.fromObject({ year:y, month, day }, {zone:ZONE});
    return [v.toISODate(), v.weekday===6?v.minus({days:1}).toISODate():v.weekday===7?v.plus({days:1}).toISODate():v.toISODate()];
  });
  return fixed.includes(date) || d.month===1&&d.weekday===1&&d.day>=15&&d.day<=21 ||
    d.month===2&&d.weekday===1&&d.day>=15&&d.day<=21 || d.month===5&&d.weekday===1&&d.day>=25 ||
    d.month===9&&d.weekday===1&&d.day<=7 || d.month===10&&d.weekday===1&&d.day>=8&&d.day<=14 ||
    d.month===11&&d.day>=22&&d.day<=28&&d.weekday===4 || d.month===11&&d.day>=23&&d.day<=29&&d.weekday===5 ||
    d.month===12&&[24,26,31].includes(d.day);
}
/** Printed civil-clock times, unlike GTFS elapsed service-day seconds. */
export function printedInstant(date: string, minutes: number) {
  const day = DateTime.fromISO(date, { zone: ZONE }).plus({days:Math.floor(minutes/1440)});
  const local = day.set({ hour: Math.floor(minutes%1440/60), minute:minutes%60, second:0, millisecond:0 });
  // Reject spring-forward gaps and fall-back ambiguous civil times.
  if(local.hour!==Math.floor(minutes%1440/60)||local.minute!==minutes%60||local.getPossibleOffsets().length>1)
    throw new Error("Ambiguous daylight-saving time");
  return local.toISO()!;
}
