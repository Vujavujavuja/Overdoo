import { distanceBetween, airport, isEuEeaCh, loadAirports } from '../airports.js';

console.log('airports loaded:', loadAirports().size);
const d = distanceBetween('BEG', 'FRA');
console.log('BEG->FRA haversine:', d?.toFixed(2), 'km  | AeroDataBox reported 1058.05');
for (const code of ['BEG', 'FRA', 'JFK', 'LHR', 'CDG', 'OSL', 'ZRH']) {
  const a = airport(code);
  console.log(` ${code}: ${a?.country} icao=${a?.icao} euEeaCh=${isEuEeaCh(a?.country)}`);
}
console.log('JFK->CDG:', distanceBetween('JFK', 'CDG')?.toFixed(0), 'km (expect ~5837)');
console.log('BEG->CDG:', distanceBetween('BEG', 'CDG')?.toFixed(0), 'km');
