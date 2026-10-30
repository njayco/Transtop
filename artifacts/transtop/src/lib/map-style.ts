// Raster + embedded styles deliberately avoid a cloud map ID / WebGL dependency.
// Do not combine these styles with a map ID, which ignores client styles.
export const DARK_ROADMAP: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#242b34' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#202630' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#b9c8d4' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#f0e6cc' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#d9d2bc' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#3b4651' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#202630' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#665e4e' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#c6cfd8' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#101f30' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#8eb5d0' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263d35' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.line', stylers: [{ visibility: 'off' }] },
];
