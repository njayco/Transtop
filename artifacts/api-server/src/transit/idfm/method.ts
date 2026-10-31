/** Public, free, machine-downloadable method notice for Licence Mobilités 5.8(b).
 * Kept independent of unrelated agencies and of application source-code licensing.
 */
export const idfmMethod=`Transtop IDFM derived-database method and reuse notice
Licence Mobilités, version 03.02.2021
License: https://cloud.fabmob.io/s/eYWWJBdM3fQiFNm/download
Original: Horaires prévus sur les lignes de transport en commun d'Île-de-France
Publisher: Île-de-France Mobilités, consolidated from its source operators.
Dataset: https://data.iledefrance-mobilites.fr/explore/dataset/offre-horaires-tc-gtfs-idfm/
Resource: https://eu.ftp.opendatasoft.com/stif/GTFS/IDFM-gtfs.zip
Official PAN: https://transport.data.gouv.fr/datasets/reseau-urbain-et-interurbain-dile-de-france-mobilites

Contient des informations des Horaires prévus Île-de-France Mobilités,
mises à disposition aux conditions de la Licence Mobilités.
IDFM-derived records remain subject to that license. No additional reuse
restriction is imposed on them. Unrelated source databases and application code
are not relicensed by this notice.

All differences / method (no additional transit observations or corrected source facts):
1. Download the exact public resource above using ETag / Last-Modified revalidation.
   Record last source publication, import timestamp, service range and source URLs.
   ZIP and CSV validation reject unsafe, duplicate, oversized, invalid or expired editions.
2. Retain each raw agency, route, stop, trip, calendar, calendar_dates, stop_times,
   shape, frequency and supplied translation/attribution field independently of other
   sources. Technical mode keys distinguish staging from current data.
3. Database record IDs prefix original GTFS IDs with "idfm:". Calendar exception
   keys append ":" and date; stop_time keys append ":" and stop_sequence. Original
   reference IDs in raw fields are unchanged. Raw source names/accents/colors remain.
4. Select fixed-route bus/coach, metro, train and tram services. Basic GTFS types
   0/1/2/3 become broad rail/subway/rail/bus filters. Extended types 100-199 become
   rail, 200-299 bus (coach), 400-402 subway, 700-799 bus, 900-999 rail (tramway).
    Source short-name TàD demand-responsive routes and other types, including this edition's cable car/funicular, are excluded from
   rider routes/trips. Unreferenced raw stops and timings can remain in storage but
   never become displayed services. Source operator attribution is retained.
 5. Route display fields copy short_name (else long_name), long_name, source operator
    names from attributions (else commercial agency/network name),
   color (# prefix; missing/invalid color uses neutral #468AC4), and native type.
   No express status, intercity status, direction name, GPS or shape is inferred.
6. Stop display fields copy name, coordinates, parent, platform, wheelchair field;
   accessible=true only for explicitly supplied wheelchair_boarding=1. All other
   accessibility states are described as supplied not-accessible or unknown.
   SQL joins source trip/route/call references to form distinct route memberships,
   also aggregated to source parent stations. Platforms retain separate identities.
7. stop_times clock strings become seconds since the GTFS service-day origin;
   blank arrival/departure clocks become -1, never interpolated. Shape rows group
    by original shape_id in sequence order, omitting individual shapes over 20,000
    vertices with missing-geometry disclosure. No stop-to-stop substitute is generated.
   Supplied frequency windows retain headway_secs and exact_times, not invented
   individual departures. Exact repeating windows are labeled as such.
8. Public query outputs select by geographic bounds, native broad mode, provider,
   name, route or stop, with pagination/caps. Timetables apply calendar_dates
   additions/removals before weekly calendars. Times use Europe/Paris noon minus
   12 elapsed hours plus GTFS seconds, preserving DST and extended hours. Restricted
   pickup, untimed/window/template and explicitly approximate timepoint calls do
   not become exact boardable departures. source headsigns/directions are displayed.
   Approximate frequencies show service-window information only.
9. Map polylines can be simplified using Douglas-Peucker tolerance
   0.00002 * 2^max(0,14-zoom). Returned paths are independent segments, not motion.
   Missing geometries remain absent. Route detail shows one supplied stop pattern
   with clearly stated caps; other branches may exist. Search/nearby pages and
   visible map paths do not claim regional completeness.
10. Refreshes publish complete generations atomically. Failed editions retain the
    last complete generation; expired source windows never supply current clocks.
    Source and error status are visible in Settings. No catalog HTML is rendered.

Source databases remain independent; no supplemental ODbL datasets are imported.
No guaranteed cross-source identity is inferred from a name or coordinate.
Application retrieval timestamps never mean a live transit observation.

Separate optional PRIM working cache (not part of the scheduled GTFS edition):
Source and API terms:
https://prim.iledefrance-mobilites.fr/fr/jeux-de-donnees/idfm-ivtr-requete_unitaire
The publisher page lists Licence Mobilité and separately links ODbL/API conditions.
The owner confirmed that this discrepancy and the applicable public-use obligations
are resolved for this use, and authorized separate PRIM public-use confirmation.
Both notices remain linked; this method does not claim either supersedes the other.
This is an owner confirmation, not an independent legal determination.
Requests use existing account credentials server-side; no signup or new terms
are accepted. Only selected-stop queries run, not full-network polling.
GTFS numeric boarding/station IDs map to documented SIRI references. Exact
line and stop references must agree with supplied memberships; names/proximity
and RATP technical counters never establish trip identities.
Only fresh Expected clocks become separately labelled PRIM estimates. Aimed-only
and old production timestamps do not become live. Source destinations, directions,
platforms and cancelled-call notices are retained when supplied. Estimates and
notices expire without extending their production timestamps on refresh failure.
No GPS is produced, no vehicle path inferred, and no general traffic/fare/planner
API is enabled. The small independent working cache is not a historical archive.

Owner confirmation before public use:
Licence 5.6(d) can require PAN publication under the original dataset in original
format for derivatives of the same nature/granularity/time/geographic extent.
This normalized regional database is treated conservatively as affected. The owner
confirmed that all applicable original-format PAN publication and required IDFM/PAN
notifications (including 5.10 notifications) are complete, and authorized the
separate schedule public-use confirmation. This downloadable method implements the
5.8(b) method option, not a substitute for any 5.6(d) duty. Transtop did not perform
an external upload or contact; the owner's confirmation was not independently
verified against external evidence. Published deployments withhold IDFM browsing
until owner confirmation.
`;
