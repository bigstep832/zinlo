import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
let records, buckets;
const countries = new Intl.DisplayNames(['en'], { type: 'region' });
function initialize() {
  if (records) return;
  records = new Map(); buckets = new Map();
  const zones = new Map();
  for (const [id, name, ascii, aliases, country, region, timezone, population] of JSON.parse(gunzipSync(readFileSync(new URL('./locations/cities.json.gz', import.meta.url))))) {
    if (!zones.has(timezone)) { try { new Intl.DateTimeFormat('en', { timeZone: timezone }); zones.set(timezone, true); } catch { zones.set(timezone, false); } }
    if (!zones.get(timezone)) continue;
    const countryName = countries.of(country) || country;
    const names = [...new Set([name, ascii, ...aliases.split(',')].map(normalize).filter(Boolean))];
    const record = { id, name, region, country, countryName, timezone, label: [name, region, countryName].filter(Boolean).join(', '), names, population };
    records.set(id, record);
    const keys = new Set(names.flatMap(alias => [alias, ...alias.split(' ')].map(word => word.slice(0, 2))));
    for (const key of keys) { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(record); }
  }
}
function publicCity({ id, name, label, timezone }) { return { id, name, label, timezone }; }
export function getCity(id) { initialize(); const city = records.get(String(id)); return city ? publicCity(city) : null; }
export function searchCities(query) {
  const text = normalize(String(query).slice(0, 100));
  if (text.length < 2) return [];
  initialize();
  const parts = text.split(' ');
  return (buckets.get(parts[0].slice(0, 2)) || []).map(city => {
    const full = city.names.some(name => name === text);
    const prefix = city.names.some(name => name.startsWith(text));
    const matches = parts.every(part => city.names.some(name => name.split(' ').some(word => word.startsWith(part))) || normalize(`${city.region} ${city.country} ${city.countryName}`).split(' ').some(word => word.startsWith(part)));
    return { city, score: full ? 3 : prefix ? 2 : matches ? 1 : 0 };
  }).filter(hit => hit.score).sort((a,b) => b.score-a.score || b.city.population-a.city.population).slice(0, 8).map(hit => publicCity(hit.city));
}
