import React, {useEffect, useMemo, useRef, useState} from 'react';
import L from 'leaflet';
import {
  AlertCircle,
  Cross,
  LocateFixed,
  MapPin,
  Navigation,
  PhoneCall,
  RefreshCw,
  Search,
  Shield,
  X,
} from 'lucide-react';
import type {GeocodedLocation} from '../services/NearbyService';
import {formatDistance, haversineMeters, NearbyService} from '../services/NearbyService';
import {StorageService} from '../services/StorageService';
import type {CachedCoordinates, NearbyPlace} from '../types/safety';

interface MapScreenProps {
  coords: CachedCoordinates | null;
  geoError: string;
  isOnline: boolean;
  onRefreshLocation: () => Promise<void>;
}

const PRESET_RADII = [1, 3, 5, 10, 20] as const;

const DEFAULT_FALLBACK_CENTER = {
  lat: 12.9716,
  lng: 77.5946,
  label: 'Bengaluru City Center (Default Pin)',
};

export const MapScreen: React.FC<MapScreenProps> = ({
  coords,
  geoError,
  isOnline,
  onRefreshLocation,
}) => {
  const [radiusKm, setRadiusKm] = useState<number>(() => {
    const cachedRad = StorageService.getNearbyCache()?.radiusKm;
    return cachedRad && cachedRad >= 1 && cachedRad <= 20 ? cachedRad : 5;
  });
  const [sliderKm, setSliderKm] = useState<number>(radiusKm);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'police' | 'hospital'>('all');
  const [filterText, setFilterText] = useState<string>('');

  // Custom OpenStreetMap search center (if user searches an area or pans & clicks "Search This Area")
  const [customCenter, setCustomCenter] = useState<{
    lat: number;
    lng: number;
    label: string;
  } | null>(null);

  // Track if user panned the map away from active search center
  const [pannedCenter, setPannedCenter] = useState<{lat: number; lng: number} | null>(null);

  // OpenStreetMap Nominatim area search box state
  const [locationQuery, setLocationQuery] = useState<string>('');
  const [geocoding, setGeocoding] = useState<boolean>(false);
  const [geocodeResults, setGeocodeResults] = useState<GeocodedLocation[]>([]);
  const [geocodeError, setGeocodeError] = useState<string>('');

  const [places, setPlaces] = useState<NearbyPlace[]>(() => {
    return StorageService.getNearbyCache()?.places || [];
  });
  const [cachedAt, setCachedAt] = useState<number | null>(() => {
    return StorageService.getNearbyCache()?.fetchedAt || null;
  });
  const [fromCache, setFromCache] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const markerMapRef = useRef<Map<string, L.Marker>>(new Map());

  // Determine active search center: Custom area -> Live/Cached GPS -> Saved NearbyCache center -> Default city pin
  const activeCenter = useMemo(() => {
    if (customCenter) {
      return {...customCenter, isCustom: true, isFallback: false};
    }
    if (coords) {
      return {
        lat: coords.lat,
        lng: coords.lng,
        label: 'Your GPS Location',
        isCustom: false,
        isFallback: false,
      };
    }
    const prevCache = StorageService.getNearbyCache();
    if (prevCache) {
      return {
        lat: prevCache.centerLat,
        lng: prevCache.centerLng,
        label: 'Last Cached Location',
        isCustom: false,
        isFallback: true,
      };
    }
    return {
      ...DEFAULT_FALLBACK_CENTER,
      isCustom: false,
      isFallback: true,
    };
  }, [customCenter, coords]);

  // Automatically request fresh GPS on mount if missing
  useEffect(() => {
    if (!coords) {
      void onRefreshLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce slider drags into active radiusKm
  useEffect(() => {
    if (sliderKm === radiusKm) return;
    const t = window.setTimeout(() => {
      setRadiusKm(sliderKm);
    }, 280);
    return () => clearTimeout(t);
  }, [sliderKm, radiusKm]);

  const loadPlaces = async (lat: number, lng: number, rad: number, forceRefresh = false) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await NearbyService.fetchNearbyHelp({
        lat,
        lng,
        radiusKm: rad,
        forceRefresh,
      });
      setPlaces(res.bundle.places);
      setCachedAt(res.bundle.fetchedAt);
      setFromCache(res.fromCache);
      if (res.warning) {
        setErrorMsg(res.warning);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Unable to fetch nearby police stations and hospitals right now.',
      );
    } finally {
      setLoading(false);
    }
  };

  // Fetch OpenStreetMap places whenever activeCenter or radiusKm changes
  useEffect(() => {
    void loadPlaces(activeCenter.lat, activeCenter.lng, radiusKm);
    setPannedCenter(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCenter.lat, activeCenter.lng, radiusKm, isOnline]);

  // Category counts within current radius
  const {withinRadiusPlaces, policeCount, hospitalCount, filteredPlaces} = useMemo(() => {
    const inRad = places.filter((p) => p.distanceMeters <= radiusKm * 1000);
    const pCount = inRad.filter((p) => p.category === 'police').length;
    const hCount = inRad.filter((p) => p.category === 'hospital').length;

    const q = filterText.trim().toLowerCase();
    const list = inRad.filter((p) => {
      const matchesCat = categoryFilter === 'all' || p.category === categoryFilter;
      if (!matchesCat) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.address && p.address.toLowerCase().includes(q)) ||
        (p.subType && p.subType.toLowerCase().includes(q))
      );
    });

    return {
      withinRadiusPlaces: inRad,
      policeCount: pCount,
      hospitalCount: hCount,
      filteredPlaces: list,
    };
  }, [places, radiusKm, categoryFilter, filterText]);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
    }).setView([activeCenter.lat, activeCenter.lng], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    mapInstanceRef.current = map;

    map.on('moveend', () => {
      const c = map.getCenter();
      setPannedCenter({lat: c.lat, lng: c.lng});
    });

    // Ensure crisp tile layout after tab transition
    const invalidateTimer = window.setTimeout(() => {
      map.invalidateSize();
    }, 120);

    return () => {
      clearTimeout(invalidateTimer);
      mapInstanceRef.current?.remove();
      mapInstanceRef.current = null;
      markersLayerRef.current = null;
      markerMapRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit map bounds cleanly around search radius whenever center or radius changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const boundsCircle = L.circle([activeCenter.lat, activeCenter.lng], {
      radius: radiusKm * 1000,
    });
    // Temporarily add to compute accurate pixel bounds, then remove
    boundsCircle.addTo(map);
    const bounds = boundsCircle.getBounds();
    boundsCircle.remove();

    map.fitBounds(bounds, {padding: [18, 18], maxZoom: 15});
  }, [activeCenter.lat, activeCenter.lng, radiusKm]);

  // Render search boundary circle, active center marker, and OpenStreetMap facility markers
  useEffect(() => {
    const group = markersLayerRef.current;
    if (!group) return;

    group.clearLayers();
    markerMapRef.current.clear();

    // Search radius ring
    L.circle([activeCenter.lat, activeCenter.lng], {
      radius: radiusKm * 1000,
      color: '#EF4444',
      fillColor: '#DC2626',
      fillOpacity: 0.06,
      weight: 1.75,
      dashArray: '5 5',
    }).addTo(group);

    // Center position marker
    const centerIcon = L.divIcon({
      className: '',
      html: `<div style="width:22px;height:22px;border-radius:9999px;background:#DC2626;border:3px solid #FFFFFF;box-shadow:0 2px 12px rgba(220,38,38,0.55);"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

    L.marker([activeCenter.lat, activeCenter.lng], {icon: centerIcon})
      .bindPopup(`<strong>${activeCenter.label}</strong>`)
      .addTo(group);

    // Police & Hospital markers
    filteredPlaces.forEach((place) => {
      const isPolice = place.category === 'police';
      const bg = isPolice ? '#1E3A8A' : '#DC2626';
      const glyph = isPolice ? 'P' : 'H';
      const isSelected = place.id === selectedPlaceId;
      const size = isSelected ? 34 : 28;

      const placeIcon = L.divIcon({
        className: '',
        html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${bg};color:#ffffff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;border:2.5px solid #ffffff;box-shadow:0 3px 10px rgba(0,0,0,0.3);">${glyph}</div>`,
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });

      const directionsHref = NearbyService.buildDirectionsUrl(
        place.lat,
        place.lng,
        place.distanceMeters,
      );
      const fallbackNum = isPolice ? '112' : '108';
      const callNum = place.phone ? place.phone.replace(/[^\d+]/g, '') : fallbackNum;

      const marker = L.marker([place.lat, place.lng], {
        icon: placeIcon,
        zIndexOffset: isSelected ? 1000 : 0,
      })
        .bindPopup(
          `<div style="min-width:190px;font-family:sans-serif;line-height:1.35;">
            <div style="font-weight:700;font-size:13px;color:#0f172a;">${place.name}</div>
            <div style="font-size:11px;color:#475569;margin-top:2px;">${
              place.subType || (isPolice ? 'Police Station' : 'Hospital')
            } · <strong>${formatDistance(place.distanceMeters)}</strong></div>
            ${
              place.address
                ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${place.address}</div>`
                : ''
            }
            <div style="display:flex;gap:10px;margin-top:8px;font-size:12px;font-weight:600;">
              <a href="${directionsHref}" target="_blank" rel="noopener noreferrer" style="color:#09090B;text-decoration:underline;">Directions</a>
              <a href="tel:${callNum}" style="color:#DC2626;text-decoration:underline;">Call ${
                place.phone ? 'Station' : fallbackNum
              }</a>
            </div>
          </div>`,
        )
        .addTo(group);

      marker.on('click', () => setSelectedPlaceId(place.id));
      markerMapRef.current.set(place.id, marker);
    });
  }, [activeCenter, radiusKm, filteredPlaces, selectedPlaceId]);

  const focusPlaceOnMap = (place: NearbyPlace) => {
    setSelectedPlaceId(place.id);
    const map = mapInstanceRef.current;
    if (map) {
      map.setView([place.lat, place.lng], 16, {animate: true});
      const marker = markerMapRef.current.get(place.id);
      if (marker) {
        window.setTimeout(() => marker.openPopup(), 220);
      }
    }
  };

  const selectPresetRadius = (km: number) => {
    setSliderKm(km);
    setRadiusKm(km);
  };

  const handleAreaGeocodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationQuery.trim()) return;
    setGeocoding(true);
    setGeocodeError('');
    try {
      const hits = await NearbyService.searchOpenStreetMapLocation(locationQuery);
      setGeocodeResults(hits);
      if (hits.length === 0) {
        setGeocodeError('No matching locality found on OpenStreetMap. Try a city or street name.');
      }
    } catch {
      setGeocodeError('Could not search OpenStreetMap locations while offline.');
    } finally {
      setGeocoding(false);
    }
  };

  const showSearchThisAreaButton =
    pannedCenter !== null &&
    haversineMeters(activeCenter.lat, activeCenter.lng, pannedCenter.lat, pannedCenter.lng) > 600;

  return (
    <div className="space-y-5">
      {/* Header & Category Tabs */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div>
          <p className="text-xs text-slate-500">
            <span>OpenStreetMap Live Directory</span>
            <span aria-hidden="true"> · </span>
            <span>{activeCenter.label}</span>
            {cachedAt && (
              <>
                <span aria-hidden="true"> · </span>
                <span>
                  {fromCache || !isOnline ? 'Cached' : 'Synced'}{' '}
                  {new Date(cachedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </>
            )}
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
            Nearby Police &amp; Hospitals
          </h1>
        </div>

        {/* Category Filter with Live Tabular Counts + Refresh */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 surface-well p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 tabular-nums ${
                categoryFilter === 'all'
                  ? 'btn-red'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All ({withinRadiusPlaces.length})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('police')}
              className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 tabular-nums ${
                categoryFilter === 'police'
                  ? 'btn-red'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Police ({policeCount})
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter('hospital')}
              className={`min-h-[40px] px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 tabular-nums ${
                categoryFilter === 'hospital'
                  ? 'btn-red'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Hospitals ({hospitalCount})
            </button>
          </div>

          {customCenter ? (
            <button
              type="button"
              onClick={() => {
                setCustomCenter(null);
                void onRefreshLocation();
              }}
              className="min-h-[44px] px-3.5 rounded-xl btn-red text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <LocateFixed className="w-4 h-4" />
              <span>Use My GPS</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={async () => {
                await onRefreshLocation();
                void loadPlaces(activeCenter.lat, activeCenter.lng, radiusKm, true);
              }}
              className="min-h-[44px] min-w-[44px] rounded-xl btn-white flex items-center justify-center"
              aria-label="Refresh GPS and OpenStreetMap places"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>
      </div>

      {/* Radius Controls (1–20 km Presets + Range Slider) & OpenStreetMap Locality Search */}
      <div className="rounded-3xl surface-white p-4 space-y-3.5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-1 surface-well p-1 rounded-xl overflow-x-auto">
            {PRESET_RADII.map((km) => (
              <button
                key={km}
                type="button"
                onClick={() => selectPresetRadius(km)}
                className={`flex-1 min-h-[40px] px-3 rounded-lg text-xs font-semibold transition-all whitespace-nowrap shrink-0 tabular-nums ${
                  sliderKm === km
                    ? 'btn-red'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {km} km
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3 md:min-w-[250px]">
            <label
              htmlFor="radius-slider"
              className="text-xs font-semibold text-slate-700 whitespace-nowrap shrink-0 tabular-nums"
            >
              Radius: <span className="font-mono text-red-600">{sliderKm} km</span>
            </label>
            <input
              id="radius-slider"
              type="range"
              min={1}
              max={20}
              step={1}
              value={sliderKm}
              onChange={(e) => setSliderKm(Number(e.target.value))}
              className="w-full h-2 accent-red-600 cursor-pointer"
            />
          </div>
        </div>

        {/* OpenStreetMap Locality Search (Ideal if GPS is blocked or checking another neighborhood) */}
        <form
          onSubmit={handleAreaGeocodeSubmit}
          className="pt-3 border-t border-slate-200 flex flex-col sm:flex-row gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={locationQuery}
              onChange={(e) => {
                setLocationQuery(e.target.value);
                if (!e.target.value.trim()) {
                  setGeocodeResults([]);
                  setGeocodeError('');
                }
              }}
              placeholder="Search any area, street, or city on OpenStreetMap..."
              className="w-full min-h-[44px] pl-10 pr-9 rounded-xl surface-input text-xs sm:text-sm"
            />
            {locationQuery && (
              <button
                type="button"
                onClick={() => {
                  setLocationQuery('');
                  setGeocodeResults([]);
                  setGeocodeError('');
                }}
                className="min-h-[36px] min-w-[36px] absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center text-slate-400 hover:text-slate-900"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={geocoding || !locationQuery.trim()}
            className="min-h-[44px] px-4 rounded-xl btn-red disabled:opacity-50 text-xs font-semibold whitespace-nowrap shrink-0 transition-all"
          >
            {geocoding ? 'Locating...' : 'Search Area'}
          </button>
        </form>

        {geocodeError && <p className="text-xs text-amber-800">{geocodeError}</p>}

        {geocodeResults.length > 0 && (
          <div className="rounded-xl surface-well divide-y divide-slate-200 overflow-hidden">
            {geocodeResults.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => {
                  setCustomCenter({
                    lat: hit.lat,
                    lng: hit.lng,
                    label: hit.label,
                  });
                  setGeocodeResults([]);
                  setLocationQuery('');
                }}
                className="w-full min-h-[44px] px-3.5 py-2.5 text-left hover:bg-red-50 flex items-center justify-between gap-3 transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 truncate">{hit.label}</div>
                  {hit.subLabel && (
                    <div className="text-[11px] text-slate-500 truncate">{hit.subLabel}</div>
                  )}
                </div>
                <span className="text-xs font-semibold text-red-600 whitespace-nowrap shrink-0 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  <span>Search Here</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* GPS Fallback or Offline Info */}
      {(activeCenter.isFallback || errorMsg) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-amber-900">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              {errorMsg
                ? errorMsg
                : geoError
                  ? `${geoError} Showing stations near ${activeCenter.label} — use Search Area above or enable GPS.`
                  : `Showing OpenStreetMap stations near ${activeCenter.label}. Tap Locate Me to lock onto your exact GPS coordinates.`}
            </span>
          </div>
          {!coords && (
            <button
              type="button"
              onClick={onRefreshLocation}
              className="min-h-[42px] px-4 rounded-xl btn-red text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <LocateFixed className="w-4 h-4" />
              <span>Locate Me</span>
            </button>
          )}
        </div>
      )}

      {/* Map + Distance-Sorted Results Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Interactive Leaflet Map with "Search This Map Area" Pan Affordance */}
        <div className="lg:col-span-7 rounded-3xl surface-white overflow-hidden relative">
          <div ref={mapContainerRef} className="w-full h-[320px] sm:h-[440px] lg:h-[540px]" />

          {showSearchThisAreaButton && pannedCenter && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
              <button
                type="button"
                onClick={() => {
                  setCustomCenter({
                    lat: pannedCenter.lat,
                    lng: pannedCenter.lng,
                    label: `Pinned Map Area (${pannedCenter.lat.toFixed(3)}, ${pannedCenter.lng.toFixed(3)})`,
                  });
                  setPannedCenter(null);
                }}
                className="min-h-[40px] px-4 rounded-xl btn-red text-xs font-bold shadow-lg flex items-center gap-1.5 whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Search This Map Area</span>
              </button>
            </div>
          )}
        </div>

        {/* Distance-Sorted Results List */}
        <div className="lg:col-span-5 rounded-3xl surface-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                {loading
                  ? `Searching OpenStreetMap (${radiusKm} km)...`
                  : `Nearest Help (${filteredPlaces.length})`}
              </h2>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                Within {radiusKm} km
              </span>
            </div>

            {withinRadiusPlaces.length > 5 && (
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter results by station or hospital name..."
                className="w-full min-h-[38px] px-3 rounded-xl surface-input text-xs"
              />
            )}
          </div>

          {loading && filteredPlaces.length === 0 ? (
            <div className="p-5 space-y-3">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className="rounded-2xl border border-slate-200 p-3.5 space-y-2 animate-pulse"
                >
                  <div className="h-4 bg-slate-200 rounded w-2/3" />
                  <div className="h-3 bg-slate-100 rounded w-1/2" />
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="h-10 bg-slate-100 rounded-xl" />
                    <div className="h-10 bg-slate-100 rounded-xl" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredPlaces.length === 0 ? (
            <div className="p-6 text-center space-y-3">
              <p className="text-sm text-slate-600">
                {filterText
                  ? `No stations matching “${filterText}” within ${radiusKm} km.`
                  : `No stations mapped within ${radiusKm} km of this pin. Expand the search radius up to 20 km or call emergency services directly.`}
              </p>
              <div className="flex flex-wrap justify-center gap-2.5 pt-1">
                {filterText ? (
                  <button
                    type="button"
                    onClick={() => setFilterText('')}
                    className="min-h-[44px] px-4 rounded-xl btn-white text-xs font-semibold"
                  >
                    Clear Filter
                  </button>
                ) : (
                  radiusKm < 20 && (
                    <button
                      type="button"
                      onClick={() => selectPresetRadius(20)}
                      className="min-h-[44px] px-4 rounded-xl btn-white text-xs font-bold whitespace-nowrap"
                    >
                      Expand to 20 km
                    </button>
                  )
                )}
                <a
                  href="tel:112"
                  className="min-h-[44px] px-4 rounded-xl btn-red text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  <span>Call Police 112</span>
                </a>
                <a
                  href="tel:1091"
                  className="min-h-[44px] px-4 rounded-xl btn-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
                >
                  <PhoneCall className="w-3.5 h-3.5 text-red-600" />
                  <span>Helpline 1091</span>
                </a>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-[490px] overflow-y-auto">
              {filteredPlaces.map((place) => {
                const isPolice = place.category === 'police';
                const fallbackNumber = isPolice ? '112' : '108';
                const callPhone = place.phone
                  ? place.phone.replace(/[^\d+]/g, '')
                  : fallbackNumber;

                return (
                  <div
                    key={place.id}
                    className={`p-4 space-y-3 transition-colors ${
                      selectedPlaceId === place.id
                        ? 'bg-red-50'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => focusPlaceOnMap(place)}
                      className="w-full text-left flex items-start gap-3"
                    >
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          isPolice
                            ? 'bg-slate-900 text-white'
                            : 'btn-red text-white'
                        }`}
                      >
                        {isPolice ? (
                          <Shield className="w-4 h-4 text-red-300" />
                        ) : (
                          <Cross className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {place.name}
                        </div>
                        <div className="text-xs text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span>
                            {place.subType || (isPolice ? 'Police Station' : 'Hospital')}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono font-semibold text-red-700 tabular-nums">
                            {formatDistance(place.distanceMeters)}
                          </span>
                          {place.phone && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">{place.phone}</span>
                            </>
                          )}
                        </div>
                        {place.address && (
                          <div className="text-xs text-slate-500 truncate mt-0.5">
                            {place.address}
                          </div>
                        )}
                      </div>
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                      <a
                        href={NearbyService.buildDirectionsUrl(
                          place.lat,
                          place.lng,
                          place.distanceMeters,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] px-3 rounded-xl btn-white text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-all"
                      >
                        <Navigation className="w-3.5 h-3.5 shrink-0" />
                        <span>Get Directions</span>
                      </a>

                      <a
                        href={`tel:${callPhone}`}
                        className="min-h-[44px] px-3 rounded-xl btn-red text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-all"
                      >
                        <PhoneCall className="w-3.5 h-3.5 shrink-0" />
                        <span>{place.phone ? 'Call Station' : `Call ${fallbackNumber}`}</span>
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
