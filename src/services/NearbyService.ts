import type {NearbyCacheBundle, NearbyPlace} from '../types/safety';
import {StorageService} from './StorageService';

/**
 * Multiple independent global OpenStreetMap Overpass API instances raced in parallel
 * via Promise.any so a busy or rate-limited mirror never stalls emergency lookups.
 */
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

interface OverpassElement {
  id: number;
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
  center?: {lat: number; lon: number};
  tags?: Record<string, string>;
}

interface NominatimPlaceResult {
  place_id: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  type?: string;
  category?: string;
  extratags?: Record<string, string>;
  address?: Record<string, string>;
}

export interface GeocodedLocation {
  id: string;
  label: string;
  subLabel: string;
  lat: number;
  lng: number;
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${meters} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

function computeBoundingBox(lat: number, lng: number, radiusKm: number) {
  const dLat = radiusKm / 110.574;
  const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  const dLng = radiusKm / (111.32 * cosLat);
  return {
    south: Math.max(-89.9, lat - dLat),
    north: Math.min(89.9, lat + dLat),
    west: Math.max(-179.9, lng - dLng),
    east: Math.min(179.9, lng + dLng),
  };
}

function cleanPhoneNumber(raw?: string): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(/[;,/]/)[0]?.trim();
  if (!first) return undefined;
  const digits = first.replace(/\D/g, '');
  return digits.length >= 3 ? first : undefined;
}

/**
 * NearbyService provides fast, resilient OpenStreetMap lookups for nearby police stations
 * and hospitals (1 km – 20 km):
 * 1. Uses indexed bounding-box (`nwr`) Overpass QL with quadtree sorting (`out center qt`)
 *    for sub-second spatial execution.
 * 2. Races multiple global Overpass mirrors concurrently via `Promise.any` and aborts
 *    slower mirrors the instant the fastest server responds.
 * 3. Automatically falls back to OpenStreetMap Nominatim bounded `viewbox` search if all
 *    Overpass mirrors are unreachable or rate-limited.
 * 4. Caches results in IndexedDB + localStorage for instant offline availability.
 */
class NearbyServiceClass {
  async fetchNearbyHelp(params: {
    lat: number;
    lng: number;
    radiusKm: number;
    forceRefresh?: boolean;
  }): Promise<{
    bundle: NearbyCacheBundle;
    fromCache: boolean;
    source: 'overpass' | 'nominatim' | 'cache';
    warning?: string;
  }> {
    const clampedRadiusKm = Math.min(20, Math.max(1, Math.round(params.radiusKm)));
    const cached = StorageService.getNearbyCache();
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : false;

    if (!isOnline) {
      if (cached) {
        return {
          bundle: this.recalculateDistances(cached, params.lat, params.lng),
          fromCache: true,
          source: 'cache',
          warning: 'Offline mode — showing cached OpenStreetMap police stations and hospitals.',
        };
      }
      throw new Error(
        'You are offline and no nearby stations have been cached yet. Connect briefly to load OpenStreetMap data, or call 112 / 1091 directly.',
      );
    }

    // Reuse recent cache if already fetched for >= current radius within 250m in last 4 minutes
    if (
      !params.forceRefresh &&
      cached &&
      cached.places.length > 0 &&
      cached.radiusKm >= clampedRadiusKm &&
      Date.now() - cached.fetchedAt < 4 * 60 * 1000 &&
      haversineMeters(params.lat, params.lng, cached.centerLat, cached.centerLng) < 250
    ) {
      return {
        bundle: this.recalculateDistances(cached, params.lat, params.lng),
        fromCache: false,
        source: 'overpass',
      };
    }

    // 1. Race fast bounding-box Overpass QL across mirrors concurrently
    try {
      const elements = await this.raceOverpassMirrors(
        params.lat,
        params.lng,
        clampedRadiusKm,
      );
      let places = this.parseOverpassElements(
        elements,
        params.lat,
        params.lng,
        clampedRadiusKm * 1000,
      );

      // If Overpass returned 0 places (extremely sparse tags), supplement with Nominatim
      if (places.length === 0) {
        const nomPlaces = await this.fetchViaNominatimBounded(
          params.lat,
          params.lng,
          clampedRadiusKm,
        ).catch(() => [] as NearbyPlace[]);
        if (nomPlaces.length > 0) {
          places = nomPlaces;
        }
      }

      const bundle: NearbyCacheBundle = {
        places,
        fetchedAt: Date.now(),
        centerLat: params.lat,
        centerLng: params.lng,
        radiusKm: clampedRadiusKm,
      };
      StorageService.saveNearbyCache(bundle);
      return {bundle, fromCache: false, source: 'overpass'};
    } catch {
      // 2. Fallback to OpenStreetMap Nominatim bounded viewbox API
      try {
        const places = await this.fetchViaNominatimBounded(
          params.lat,
          params.lng,
          clampedRadiusKm,
        );
        const bundle: NearbyCacheBundle = {
          places,
          fetchedAt: Date.now(),
          centerLat: params.lat,
          centerLng: params.lng,
          radiusKm: clampedRadiusKm,
        };
        StorageService.saveNearbyCache(bundle);
        return {bundle, fromCache: false, source: 'nominatim'};
      } catch {
        // 3. Final fallback to offline cache
        if (cached) {
          return {
            bundle: this.recalculateDistances(cached, params.lat, params.lng),
            fromCache: true,
            source: 'cache',
            warning:
              'OpenStreetMap servers are temporarily busy — displaying your cached stations.',
          };
        }
        throw new Error(
          'Unable to reach OpenStreetMap right now. Check your connection or call 112 / 1091 directly.',
        );
      }
    }
  }

  /**
   * Geocodes an area, street, landmark, or city name using OpenStreetMap Nominatim
   * so users can search any locality even if browser GPS is disabled or inaccurate.
   */
  async searchOpenStreetMapLocation(queryText: string): Promise<GeocodedLocation[]> {
    const q = queryText.trim();
    if (q.length < 2) return [];

    const url = `${NOMINATIM_SEARCH_URL}?q=${encodeURIComponent(
      q,
    )}&format=jsonv2&addressdetails=1&limit=5`;

    const res = await fetch(url, {
      headers: {Accept: 'application/json'},
    });
    if (!res.ok) {
      throw new Error('Location search failed');
    }

    const rows = (await res.json()) as NominatimPlaceResult[];
    return rows.map((r) => {
      const parts = r.display_name.split(',').map((s) => s.trim());
      return {
        id: String(r.place_id),
        label: r.name || parts[0] || q,
        subLabel: parts.slice(1, 4).join(', '),
        lat: Number(r.lat),
        lng: Number(r.lon),
      };
    });
  }

  buildDirectionsUrl(destLat: number, destLng: number, distanceMeters?: number): string {
    const mode = distanceMeters && distanceMeters > 2500 ? 'driving' : 'walking';
    return `https://www.google.com/maps/dir/?api=1&destination=${destLat.toFixed(6)},${destLng.toFixed(6)}&travelmode=${mode}`;
  }

  private async raceOverpassMirrors(
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<OverpassElement[]> {
    const {south, west, north, east} = computeBoundingBox(lat, lng, radiusKm);
    const bbox = `${south.toFixed(5)},${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)}`;
    const maxItems = radiusKm >= 10 ? 280 : 160;

    // Single-pass indexed bounding-box union with quadtree (`qt`) ordering
    const query = `[out:json][timeout:14];(nwr["amenity"~"^(police|hospital|clinic)$"](${bbox});nwr["healthcare"="hospital"](${bbox});nwr["police"]["police"!="checkpoint"](${bbox}););out center qt ${maxItems};`;

    const controllers = OVERPASS_MIRRORS.map(() => new AbortController());

    const attempts = OVERPASS_MIRRORS.map(async (endpoint, idx) => {
      const timer = window.setTimeout(() => controllers[idx].abort(), 12000);
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
          body: `data=${encodeURIComponent(query)}`,
          signal: controllers[idx].signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as {elements?: OverpassElement[]};
        if (!Array.isArray(data.elements)) {
          throw new Error('Malformed Overpass payload');
        }
        return data.elements;
      } finally {
        clearTimeout(timer);
      }
    });

    try {
      const winner = await Promise.any(attempts);
      // Cancel remaining slower mirror requests immediately
      controllers.forEach((c) => c.abort());
      return winner;
    } catch {
      controllers.forEach((c) => c.abort());
      throw new Error('All Overpass mirrors timed out or returned errors');
    }
  }

  private async fetchViaNominatimBounded(
    lat: number,
    lng: number,
    radiusKm: number,
  ): Promise<NearbyPlace[]> {
    const {south, west, north, east} = computeBoundingBox(lat, lng, radiusKm);
    const viewbox = `${west.toFixed(5)},${north.toFixed(5)},${east.toFixed(5)},${south.toFixed(5)}`;
    const maxMeters = radiusKm * 1000;

    const [policeRes, hospitalRes] = await Promise.all([
      fetch(
        `${NOMINATIM_SEARCH_URL}?q=police&format=jsonv2&viewbox=${viewbox}&bounded=1&addressdetails=1&extratags=1&limit=40`,
        {headers: {Accept: 'application/json'}},
      ),
      fetch(
        `${NOMINATIM_SEARCH_URL}?q=hospital&format=jsonv2&viewbox=${viewbox}&bounded=1&addressdetails=1&extratags=1&limit=50`,
        {headers: {Accept: 'application/json'}},
      ),
    ]);

    if (!policeRes.ok && !hospitalRes.ok) {
      throw new Error('Nominatim fallback failed');
    }

    const policeRows = policeRes.ok
      ? ((await policeRes.json()) as NominatimPlaceResult[])
      : [];
    const hospitalRows = hospitalRes.ok
      ? ((await hospitalRes.json()) as NominatimPlaceResult[])
      : [];

    const combined: NearbyPlace[] = [];
    const seen = new Set<string>();

    const ingest = (rows: NominatimPlaceResult[], category: 'police' | 'hospital') => {
      for (const row of rows) {
        const pLat = Number(row.lat);
        const pLng = Number(row.lon);
        if (Number.isNaN(pLat) || Number.isNaN(pLng)) continue;

        const dist = haversineMeters(lat, lng, pLat, pLng);
        if (dist > maxMeters) continue;

        const firstLabel = row.display_name.split(',')[0]?.trim();
        const name = (row.name || firstLabel || (category === 'police' ? 'Police Station' : 'Hospital')).trim();
        const dedupe = `${category}_${name.toLowerCase()}_${pLat.toFixed(3)}_${pLng.toFixed(3)}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);

        const addr = row.address || {};
        const addressParts = [
          addr.road,
          addr.neighbourhood || addr.suburb,
          addr.city || addr.town || addr.state_district,
        ].filter(Boolean);

        const extra = row.extratags || {};
        const phone = cleanPhoneNumber(
          extra.phone || extra['contact:phone'] || extra['emergency:phone'],
        );

        combined.push({
          id: `nom_${row.osm_type || 'n'}_${row.osm_id || row.place_id}`,
          name,
          category,
          subType: category === 'police' ? 'Police Station' : 'Hospital',
          lat: pLat,
          lng: pLng,
          distanceMeters: dist,
          phone,
          address: addressParts.join(', ') || row.display_name.split(',').slice(1, 4).join(', ').trim(),
          openingHours: extra.opening_hours,
          emergency: extra.emergency === 'yes',
        });
      }
    };

    ingest(policeRows, 'police');
    ingest(hospitalRows, 'hospital');

    return combined.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  private parseOverpassElements(
    elements: OverpassElement[],
    userLat: number,
    userLng: number,
    maxRadiusMeters: number,
  ): NearbyPlace[] {
    const seen = new Set<string>();
    const mainPlaces: NearbyPlace[] = [];
    const nonEmergencyClinics: NearbyPlace[] = [];

    for (const el of elements) {
      const lat = el.lat ?? el.center?.lat;
      const lng = el.lon ?? el.center?.lon;
      if (typeof lat !== 'number' || typeof lng !== 'number') continue;

      const distanceMeters = haversineMeters(userLat, userLng, lat, lng);
      // Filter strictly to the circular Haversine search radius (since bbox has corners)
      if (distanceMeters > maxRadiusMeters) continue;

      const tags = el.tags || {};
      const amenity = tags.amenity;
      const healthcare = tags.healthcare;
      const policeTag = tags.police;

      const isPolice = amenity === 'police' || Boolean(policeTag);
      const isHospital = amenity === 'hospital' || healthcare === 'hospital';
      const isClinic = amenity === 'clinic';

      if (!isPolice && !isHospital && !isClinic) continue;

      const category: 'police' | 'hospital' = isPolice ? 'police' : 'hospital';
      const locality =
        tags['addr:suburb'] ||
        tags['addr:neighbourhood'] ||
        tags['addr:street'] ||
        tags['addr:city'] ||
        '';

      const fallbackBase = isPolice
        ? policeTag === 'traffic_police'
          ? 'Traffic Police Post'
          : 'Police Station'
        : isClinic
          ? 'Medical Clinic'
          : 'Hospital';

      const rawName =
        tags.name ||
        tags['name:en'] ||
        tags.official_name ||
        tags.short_name ||
        tags.alt_name ||
        tags.operator ||
        (locality ? `${fallbackBase} — ${locality}` : fallbackBase);

      const name = rawName.trim();

      // Deduplicate when both an OSM building `way` and entrance `node` share the same name nearby
      const dedupeKey = `${category}_${name.toLowerCase()}_${Math.round(lat * 250)}_${Math.round(lng * 250)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const phone = cleanPhoneNumber(
        tags.phone ||
          tags['contact:phone'] ||
          tags['phone:mobile'] ||
          tags['contact:mobile'] ||
          tags['emergency:phone'],
      );

      const address =
        [
          tags['addr:housenumber'],
          tags['addr:street'],
          tags['addr:neighbourhood'] || tags['addr:suburb'],
          tags['addr:city'] || tags['addr:district'],
        ]
          .filter(Boolean)
          .join(', ') ||
        tags['addr:full'] ||
        undefined;

      const isEmergency24h =
        tags.emergency === 'yes' || tags.opening_hours === '24/7';

      const subType = isPolice
        ? policeTag === 'traffic_police'
          ? 'Traffic Police'
          : 'Police Station'
        : isClinic
          ? isEmergency24h
            ? '24/7 Emergency Clinic'
            : 'Medical Clinic'
          : isEmergency24h
            ? '24/7 Emergency Hospital'
            : 'Hospital';

      const item: NearbyPlace = {
        id: `${el.type}_${el.id}`,
        name,
        category,
        subType,
        lat,
        lng,
        distanceMeters,
        phone,
        address,
        openingHours: tags.opening_hours || undefined,
        emergency: isEmergency24h,
        osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      };

      // Prioritize full hospitals & 24/7 emergency clinics; keep regular clinics if hospitals are scarce
      if (isClinic && !isEmergency24h && !isHospital) {
        nonEmergencyClinics.push(item);
      } else {
        mainPlaces.push(item);
      }
    }

    const hospitalCount = mainPlaces.filter((p) => p.category === 'hospital').length;
    const merged =
      hospitalCount < 5
        ? [...mainPlaces, ...nonEmergencyClinics.slice(0, 15)]
        : mainPlaces;

    return merged.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  private recalculateDistances(
    bundle: NearbyCacheBundle,
    lat: number,
    lng: number,
  ): NearbyCacheBundle {
    const places = bundle.places
      .map((p) => ({
        ...p,
        distanceMeters: haversineMeters(lat, lng, p.lat, p.lng),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    return {...bundle, places};
  }
}

export const NearbyService = new NearbyServiceClass();
