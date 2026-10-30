export const CHECKED_AT = "2026-10-30T18:40:00.000Z";
export const MARTZ_URL = "https://martzbus.com/new-york/";
export interface Provider {
  id: string; name: string; status: string; description: string; url: string;
  checkedAt: string; terminalService: string; access: string; aliases: string[];
  updatedAt?: string; lastError?: string;
}
const entry = (id: string, name: string, url: string, status: string, description: string,
  terminalService = "Listed in supplied terminal directory; current service requires confirmation",
  aliases: string[] = []): Provider => ({
  id, name, url, status, description, terminalService, aliases, checkedAt: CHECKED_AT,
  access: status === "access required" ? "Authorized developer access or reuse permission required" :
    "Official links only; no authorized, current bulk timetable verified",
});

// One entry per supplied directory row. Aliases never create duplicate trips.
export const providerInventory: Provider[] = [
  entry("academy", "Academy", "https://commuter.academybus.com/", "access required", "Official site could not be verified by automated retrieval. No schedules copied."),
  entry("adirondack", "Adirondack Trailways", "https://trailways.com/", "access required", "NYSDOT public GTFS archive last modified in 2021; long calendar dates do not verify current service. Current booking feed access required.", undefined, ["Trailways"]),
  entry("bonanza", "Bonanza (Peter Pan)", "https://peterpanbus.com/", "link-only", "Peter Pan brand alias; use the Peter Pan schedule service. No duplicate departures.", undefined, ["Peter Pan"]),
  entry("cj", "C&J Bus Lines", "https://www.ridecj.com/", "link-only", "Official booking search is available; no permitted bulk schedule verified."),
  entry("coach-company", "Coach Company", "https://coachco.com/", "service unverified", "Current homepage advertises charter services. Scheduled terminal service is not verified."),
  entry("community-coach", "Community (Coach USA)", "https://www.coachusa.com/community-coach/schedules", "link-only", "Official current schedule search; automated timetable reuse has not been verified."),
  entry("community-lines", "Community Lines", "https://www.panynj.gov/bus-terminals/en/carriers-routes.html", "service unverified", "No official website supplied; do not confuse with Community Coach."),
  entry("spanish-transportation", "Express Bus Service (Spanish Transportation)", "https://www.panynj.gov/bus-terminals/en/carriers-routes.html", "service unverified", "No official timetable source verified. Frequency-based jitneys must not be shown as exact departures."),
  entry("fullington", "Fullington Trailways", "https://fullingtontours.com/daily-bus-departures/", "link-only", "Official daily-service page. Licensed NYSDOT archive last modified in 2024; not used for current departure predictions."),
  entry("greyhound", "Greyhound", "https://www.greyhound.com/bus/new-york-ny/new-york-port-authority", "link-only", "Official terminal page and date-specific booking links. No authorized current schedule feed verified.",
    "Port Authority stop confirmed on current official location page", ["FlixBus"]),
  entry("lakeland", "Lakeland", "https://www.lakelandbus.com/bus-schedules/", "link-only", "Direction-specific schedule pages available; some PDF links explicitly say unavailable. Validated import and reuse permission still required."),
  entry("martz", "Martz Trailways", MARTZ_URL, "link-only", "Public timetable tables are checked against official location and calendar notes. Only unambiguous trips are imported.",
    "Current official timetable and customer-service page confirm terminal boarding", ["Martz Bus"]),
  entry("megabus", "Megabus", "https://us.megabus.com/", "link-only", "Official booking portal; a listed brand alone does not verify a specific terminal departure."),
  entry("newark-airport", "Newark Airport Express (Coach USA)", "https://www.coachusa.com/airport-transportation/newark-airport", "link-only", "Old supplied URL redirects to the airport service directory. Curbside boarding must be verified separately from terminal gates."),
  entry("new-york-trailways", "New York Trailways", "https://trailways.com/", "access required", "Current booking system needs authorized feed access; the known feed directory reports failed current retrieval.", undefined, ["Trailways"]),
  entry("nj-transit", "NJ TRANSIT", "https://www.njtransit.com/developer-tools", "access required", "Developer portal requires an account and applicable data terms. No credentials requested or login bypass attempted."),
  entry("peter-pan", "Peter Pan", "https://peterpanbus.com/", "link-only", "Official schedules are date-specific booking results. No current authorized bulk timetable verified.", undefined, ["Bonanza"]),
  entry("pine-hill", "Pine Hill Trailways", "https://trailways.com/", "access required", "Shared Trailways booking platform. Old NYSDOT feeds do not establish current trip times.", undefined, ["Trailways"]),
  entry("rockland", "Rockland Coaches (Coach USA)", "https://www.coachusa.com/rockland-coaches/schedules", "link-only", "Official operator schedule search; no validated automated import yet."),
  entry("shortline", "ShortLine (Coach USA)", "https://www.coachusa.com/shortline/schedules", "link-only", "Operator instructs riders to use its current route widget because schedules are limited.", undefined, ["ShortLine Hudson"]),
  entry("stewart-airport", "Stewart Airport Express (Megabus)", "https://us.megabus.com/stewart-airport-express", "service unverified", "Old service URL resolves to generic Megabus booking. Current service and boarding location are unverified."),
  entry("suburban", "Suburban Transit (Coach USA)", "https://www.coachusa.com/suburban-transit/schedules", "link-only", "Official commuter schedule search; no permitted current bulk timetable verified."),
  entry("transbridge", "Trans-Bridge Lines", "https://transbridgelines.com/schedules-stops/schedules", "link-only", "Dated PDF schedules, stop directory and separate holiday notices are available. Import remains link-only until PDF footnotes and reuse are validated.",
    "Current official stop directory and 2026 schedules confirm terminal service"),
];
