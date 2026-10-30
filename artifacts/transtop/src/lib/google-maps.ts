import { importLibrary, setOptions } from '@googlemaps/js-api-loader';

let libraries: Promise<[google.maps.MapsLibrary, google.maps.MarkerLibrary]> | undefined;

/** Browser key is intentionally public; secure it with Google website/API restrictions. */
export function loadGoogleMaps() {
  if (!libraries) {
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    if (!key?.trim()) return Promise.reject(new Error('Google Maps key is not configured'));
    setOptions({ key, v: 'weekly', authReferrerPolicy: 'origin' });
    libraries = Promise.all([
      importLibrary('maps') as Promise<google.maps.MapsLibrary>,
      importLibrary('marker') as Promise<google.maps.MarkerLibrary>,
    ]).catch((error: unknown) => { libraries = undefined; throw error; });
  }
  return libraries;
}
