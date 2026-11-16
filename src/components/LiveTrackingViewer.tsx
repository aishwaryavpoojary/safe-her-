import React, {useEffect, useRef, useState} from 'react';
import L from 'leaflet';
import {ArrowLeft, ExternalLink, Navigation, PhoneCall, Shield} from 'lucide-react';

interface LiveTrackingViewerProps {
  sessionId: string;
  fallbackLat: number | null;
  fallbackLng: number | null;
  onExitTrackingView: () => void;
}

interface RemoteSession {
  id: string;
  userName: string;
  mode: 'sos' | 'live';
  active: boolean;
  startedAt: number;
  updatedAt: number;
  currentLocation: {
    lat: number;
    lng: number;
    accuracy?: number;
    timestamp: number;
  } | null;
  trail: Array<{lat: number; lng: number; timestamp: number}>;
}

export const LiveTrackingViewer: React.FC<LiveTrackingViewerProps> = ({
  sessionId,
  fallbackLat,
  fallbackLng,
  onExitTrackingView,
}) => {
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);

  useEffect(() => {
    let active = true;

    const fetchSession = async () => {
      try {
        const res = await fetch(`/api/tracking/${encodeURIComponent(sessionId)}`);
        if (!res.ok) {
          throw new Error('Live session ended or unavailable on server.');
        }
        const data = (await res.json()) as {session: RemoteSession};
        if (active) {
          setSession(data.session);
          setError('');
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setLoading(false);
          setError(
            err instanceof Error
              ? err.message
              : 'Unable to reach live tracking server — displaying URL coordinates if available.',
          );
        }
      }
    };

    void fetchSession();
    const interval = window.setInterval(fetchSession, 4000);

    let es: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      es = new EventSource(`/api/guardian/stream?sessionId=${encodeURIComponent(sessionId)}`);
      const onStreamUpdate = (evt: Event) => {
        if (!active) return;
        try {
          const parsed = JSON.parse((evt as MessageEvent).data) as {
            session: RemoteSession | null;
          };
          if (parsed.session) {
            setSession(parsed.session);
            setError('');
            setLoading(false);
          }
        } catch {
          // Ignore malformed event
        }
      };
      es.addEventListener('init', onStreamUpdate);
      es.addEventListener('sos_alert', onStreamUpdate);
      es.addEventListener('session_update', onStreamUpdate);
    }

    return () => {
      active = false;
      clearInterval(interval);
      es?.close();
    };
  }, [sessionId]);

  const activeLat = session?.currentLocation?.lat ?? fallbackLat;
  const activeLng = session?.currentLocation?.lng ?? fallbackLng;

  useEffect(() => {
    if (!mapContainerRef.current || activeLat === null || activeLng === null) return;

    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
      }).setView([activeLat, activeLng], 16);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
    }

    const map = mapRef.current;
    const isSos = session?.mode === 'sos';
    const pinColor = isSos ? '#DC2626' : '#09090B';

    const icon = L.divIcon({
      className: '',
      html: `<div style="width:28px;height:28px;border-radius:9999px;background:${pinColor};border:3px solid #ffffff;box-shadow:0 4px 12px rgba(0,0,0,0.35);"></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    if (!markerRef.current) {
      markerRef.current = L.marker([activeLat, activeLng], {icon}).addTo(map);
    } else {
      markerRef.current.setLatLng([activeLat, activeLng]);
      markerRef.current.setIcon(icon);
    }

    const accuracy = session?.currentLocation?.accuracy ?? 25;
    if (!circleRef.current) {
      circleRef.current = L.circle([activeLat, activeLng], {
        radius: accuracy,
        color: pinColor,
        fillColor: pinColor,
        fillOpacity: 0.12,
        weight: 1.5,
      }).addTo(map);
    } else {
      circleRef.current.setLatLng([activeLat, activeLng]);
      circleRef.current.setRadius(accuracy);
    }

    if (session?.trail && session.trail.length > 1) {
      const latlngs: [number, number][] = session.trail.map((pt) => [pt.lat, pt.lng]);
      if (!polylineRef.current) {
        polylineRef.current = L.polyline(latlngs, {
          color: pinColor,
          weight: 4,
          opacity: 0.8,
        }).addTo(map);
      } else {
        polylineRef.current.setLatLngs(latlngs);
      }
    }

    map.panTo([activeLat, activeLng]);
  }, [activeLat, activeLng, session]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div className="min-h-screen text-slate-900 flex flex-col">
      <header
        className={`${
          session?.mode === 'sos'
            ? 'bg-red-600 text-white border-b border-red-700'
            : 'bg-white/95 backdrop-blur-xl border-b border-red-200 text-slate-900'
        } px-5 py-4 transition-colors`}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <Shield
              className={`w-5 h-5 shrink-0 ${
                session?.mode === 'sos' ? 'text-white' : 'text-red-600'
              }`}
            />
            <span className="font-display text-base sm:text-lg font-bold truncate">
              {session
                ? `${session.userName} — ${
                    session.mode === 'sos' ? 'EMERGENCY SOS TRACKING' : 'Live Location Share'
                  }`
                : 'Safe Her Live Location'}
            </span>
          </div>
          <button
            type="button"
            onClick={onExitTrackingView}
            className="min-h-[40px] px-3.5 rounded-xl btn-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Open My Safe Her</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 flex flex-col gap-4">
        {loading && (
          <div className="rounded-3xl surface-white p-5 text-sm text-slate-600">
            Connecting to live GPS feed...
          </div>
        )}

        {error && !session && activeLat === null && (
          <div className="rounded-3xl surface-red p-5 text-sm text-red-900">
            {error}
          </div>
        )}

        {session && activeLat === null && (
          <div className="rounded-3xl surface-red p-5 space-y-2">
            <div className="font-display text-lg font-bold text-slate-900">
              {session.userName} — Live Session Active · Locking GPS Coordinates
            </div>
            <p className="text-xs text-slate-600">
              Emergency tracking has started and is waiting for the device&apos;s first satellite GPS fix. The live map will load automatically once coordinates lock.
            </p>
          </div>
        )}

        {activeLat !== null && activeLng !== null && (
          <>
            <div
              className={`rounded-3xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                session?.mode === 'sos' ? 'surface-red' : 'surface-white'
              }`}
            >
              <div>
                <div className="text-xs text-slate-500">
                  <span>
                    {session?.active
                      ? 'Updating live every 3 seconds'
                      : 'Showing last reported coordinates'}
                  </span>
                  {session?.updatedAt && (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span>
                        Last update{' '}
                        {new Date(session.updatedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </>
                  )}
                </div>
                <div className="font-mono text-sm font-semibold text-slate-900 mt-1 tabular-nums">
                  {activeLat.toFixed(6)}, {activeLng.toFixed(6)}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${activeLat},${activeLng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[46px] px-4 rounded-xl btn-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap"
                >
                  <Navigation className="w-4 h-4" />
                  <span>Navigate in Google Maps</span>
                </a>
                <a
                  href="tel:112"
                  className="min-h-[46px] px-4 rounded-xl btn-red text-xs font-semibold flex items-center gap-2 whitespace-nowrap"
                >
                  <PhoneCall className="w-4 h-4" />
                  <span>Call Police 112</span>
                </a>
              </div>
            </div>

            <div className="rounded-3xl surface-white overflow-hidden flex-1 min-h-[420px]">
              <div ref={mapContainerRef} className="w-full h-[460px] sm:h-[540px]" />
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 px-1">
              <span>Safe Her Encrypted Live Share</span>
              <a
                href={`https://maps.google.com/?q=${activeLat},${activeLng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-red-600 hover:text-red-700 hover:underline"
              >
                <span>Open raw coordinates</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  );
};
