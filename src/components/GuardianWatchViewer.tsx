import React, {useCallback, useEffect, useRef, useState} from 'react';
import L from 'leaflet';
import {
  ArrowLeft,
  Bell,
  Check,
  ExternalLink,
  Navigation,
  PhoneCall,
  Radio,
  Shield,
  ShieldAlert,
  Volume2,
} from 'lucide-react';
import {AudioService} from '../services/AudioService';

interface GuardianWatchViewerProps {
  initialGuardianId: string | null;
  initialPhone: string | null;
  onExitGuardianView: () => void;
}

interface GuardianPairingInfo {
  guardianId: string;
  userName: string;
  contactName: string;
  contactPhone: string;
  relationship: string;
  updatedAt: number;
}

interface GuardianRemoteSession {
  id: string;
  userName: string;
  mode: 'sos' | 'live';
  active: boolean;
  startedAt: number;
  updatedAt: number;
  triggerSource?: string;
  activeViewers?: number;
  currentLocation: {
    lat: number;
    lng: number;
    accuracy?: number;
    timestamp: number;
  } | null;
  trail: Array<{lat: number; lng: number; timestamp: number}>;
}

const GUARDIAN_SAVED_PHONE_KEY = 'safeher_guardian_watch_phone_v1';

export const GuardianWatchViewer: React.FC<GuardianWatchViewerProps> = ({
  initialGuardianId,
  initialPhone,
  onExitGuardianView,
}) => {
  const [guardianId] = useState<string | null>(() =>
    initialGuardianId && initialGuardianId !== 'watch' ? initialGuardianId : null,
  );
  const [phoneInput, setPhoneInput] = useState<string>(() => {
    if (initialPhone) return initialPhone;
    try {
      return localStorage.getItem(GUARDIAN_SAVED_PHONE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [subscribedPhone, setSubscribedPhone] = useState<string>(() => {
    if (initialPhone) return initialPhone;
    try {
      return localStorage.getItem(GUARDIAN_SAVED_PHONE_KEY) || '';
    } catch {
      return '';
    }
  });

  const [pairing, setPairing] = useState<GuardianPairingInfo | null>(null);
  const [session, setSession] = useState<GuardianRemoteSession | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [alertsArmed, setAlertsArmed] = useState<boolean>(false);
  const [notifGranted, setNotifGranted] = useState<boolean>(() =>
    typeof Notification !== 'undefined' ? Notification.permission === 'granted' : false,
  );

  const alertedSessionIdRef = useRef<string | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const polylineRef = useRef<L.Polyline | null>(null);

  const triggerIncomingEmergencyCue = useCallback(
    (incoming: GuardianRemoteSession) => {
      if (!incoming.active) return;
      if (alertedSessionIdRef.current === incoming.id) return;
      alertedSessionIdRef.current = incoming.id;

      if (incoming.mode === 'sos') {
        AudioService.previewRingtone('chime');
        AudioService.vibrate([500, 200, 500, 200, 600]);
      } else {
        AudioService.vibrate([200, 100, 200]);
      }

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const coordText = incoming.currentLocation
            ? `(${incoming.currentLocation.lat.toFixed(4)}, ${incoming.currentLocation.lng.toFixed(4)})`
            : '(locking GPS coordinates...)';
          new Notification(
            incoming.mode === 'sos'
              ? `EMERGENCY SOS: ${incoming.userName}`
              : `Live Location Shared: ${incoming.userName}`,
            {
              body: `${incoming.userName} is streaming live GPS coordinates ${coordText}.`,
            },
          );
        } catch {
          // Ignore notification constructor limitation on some mobile browsers
        }
      }
    },
    [],
  );

  // Connect to Server-Sent Events stream + resilient status polling
  useEffect(() => {
    if (!guardianId && subscribedPhone.replace(/\D/g, '').length < 7) {
      return;
    }

    let disposed = false;
    const params = new URLSearchParams();
    if (guardianId) params.set('guardianId', guardianId);
    if (subscribedPhone.trim()) params.set('phone', subscribedPhone.trim());

    const fetchStatus = async () => {
      try {
        const res = await fetch(`/api/guardian/status?${params.toString()}`);
        if (!res.ok || disposed) return;
        const data = (await res.json()) as {
          pairing: GuardianPairingInfo | null;
          session: GuardianRemoteSession | null;
        };
        if (disposed) return;
        if (data.pairing) setPairing(data.pairing);
        if (data.session) {
          setSession(data.session);
          triggerIncomingEmergencyCue(data.session);
        }
        setConnected(true);
      } catch {
        if (!disposed) setConnected(false);
      }
    };

    void fetchStatus();

    let es: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      es = new EventSource(`/api/guardian/stream?${params.toString()}`);

      es.onopen = () => {
        if (!disposed) setConnected(true);
      };

      es.addEventListener('init', (evt) => {
        if (disposed) return;
        try {
          const parsed = JSON.parse((evt as MessageEvent).data) as {
            pairing: GuardianPairingInfo | null;
            session: GuardianRemoteSession | null;
          };
          if (parsed.pairing) setPairing(parsed.pairing);
          if (parsed.session) {
            setSession(parsed.session);
            triggerIncomingEmergencyCue(parsed.session);
          }
          setConnected(true);
        } catch {
          // Ignore malformed event
        }
      });

      const handleLiveEvent = (evt: Event) => {
        if (disposed) return;
        try {
          const parsed = JSON.parse((evt as MessageEvent).data) as {
            session: GuardianRemoteSession;
          };
          if (parsed.session) {
            setSession(parsed.session);
            triggerIncomingEmergencyCue(parsed.session);
          }
        } catch {
          // Ignore malformed event
        }
      };

      es.addEventListener('sos_alert', handleLiveEvent);
      es.addEventListener('session_update', handleLiveEvent);

      es.onerror = () => {
        if (!disposed) setConnected(false);
      };
    }

    const pollInterval = window.setInterval(fetchStatus, 4000);

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        bc = new BroadcastChannel('safeher_live_alerts');
        bc.onmessage = (evt) => {
          if (disposed || !evt.data || evt.data.type !== 'dispatch_alert') return;
          const p = evt.data.payload as {
            sessionId: string;
            userName: string;
            mode: 'sos' | 'live';
            triggerSource?: string;
            location: {lat: number; lng: number; accuracy?: number; timestamp: number} | null;
            contacts: Array<{phone: string; guardianId?: string}>;
          };
          const normalizedSub = subscribedPhone.replace(/\D/g, '').slice(-10);
          const matchesId = Boolean(guardianId) && p.contacts.some((c) => c.guardianId === guardianId);
          const matchesPhone =
            normalizedSub.length >= 7 &&
            p.contacts.some((c) => c.phone.replace(/\D/g, '').slice(-10) === normalizedSub);
          if (!matchesId && !matchesPhone) return;

          const localSession: GuardianRemoteSession = {
            id: p.sessionId,
            userName: p.userName,
            mode: p.mode,
            active: true,
            startedAt: Date.now(),
            updatedAt: Date.now(),
            triggerSource: p.triggerSource,
            currentLocation: p.location,
            trail: p.location ? [p.location] : [],
          };
          setSession(localSession);
          triggerIncomingEmergencyCue(localSession);
        };
      } catch {
        // Ignore BroadcastChannel unavailability
      }
    }

    return () => {
      disposed = true;
      clearInterval(pollInterval);
      es?.close();
      bc?.close();
    };
  }, [guardianId, subscribedPhone, triggerIncomingEmergencyCue]);

  // Render & update live Leaflet map whenever session has coordinates
  useEffect(() => {
    const loc = session?.currentLocation;
    if (!mapContainerRef.current || !loc) return;

    if (!mapRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
      }).setView([loc.lat, loc.lng], 16);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      mapRef.current = map;
    }

    const map = mapRef.current;
    const isSos = session?.mode === 'sos' && session.active;
    const pinColor = isSos ? '#DC2626' : '#09090B';

    const icon = L.divIcon({
      className: '',
      html: `<div style="width:28px;height:28px;border-radius:9999px;background:${pinColor};border:3px solid #ffffff;box-shadow:0 4px 14px rgba(0,0,0,0.38);"></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });

    if (!markerRef.current) {
      markerRef.current = L.marker([loc.lat, loc.lng], {icon}).addTo(map);
    } else {
      markerRef.current.setLatLng([loc.lat, loc.lng]);
      markerRef.current.setIcon(icon);
    }

    const accuracy = loc.accuracy ?? 25;
    if (!circleRef.current) {
      circleRef.current = L.circle([loc.lat, loc.lng], {
        radius: Math.max(15, accuracy),
        color: pinColor,
        fillColor: pinColor,
        fillOpacity: 0.14,
        weight: 1.5,
      }).addTo(map);
    } else {
      circleRef.current.setLatLng([loc.lat, loc.lng]);
      circleRef.current.setRadius(Math.max(15, accuracy));
      circleRef.current.setStyle({color: pinColor, fillColor: pinColor});
    }

    if (session?.trail && session.trail.length > 1) {
      const latlngs: [number, number][] = session.trail.map((pt) => [pt.lat, pt.lng]);
      if (!polylineRef.current) {
        polylineRef.current = L.polyline(latlngs, {
          color: pinColor,
          weight: 4,
          opacity: 0.85,
        }).addTo(map);
      } else {
        polylineRef.current.setLatLngs(latlngs);
        polylineRef.current.setStyle({color: pinColor});
      }
    }

    map.panTo([loc.lat, loc.lng]);
  }, [session]);

  useEffect(() => {
    if (!session?.currentLocation && mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
      markerRef.current = null;
      circleRef.current = null;
      polylineRef.current = null;
    }
  }, [session]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  const handlePairByPhone = (e: React.FormEvent) => {
    e.preventDefault();
    if (phoneInput.replace(/\D/g, '').length < 7) return;
    try {
      localStorage.setItem(GUARDIAN_SAVED_PHONE_KEY, phoneInput.trim());
    } catch {
      // Ignore storage restriction
    }
    setSubscribedPhone(phoneInput.trim());
  };

  const handleArmAudioAndNotifications = async () => {
    AudioService.previewRingtone('pulse');
    setAlertsArmed(true);
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        const perm = await Notification.requestPermission();
        setNotifGranted(perm === 'granted');
      } catch {
        // Ignore
      }
    }
  };

  const isSosActive = Boolean(session?.active && session.mode === 'sos');
  const isLiveActive = Boolean(session?.active && session.mode === 'live');
  const needsPhonePairing = !guardianId && subscribedPhone.replace(/\D/g, '').length < 7;

  return (
    <div className="min-h-screen text-slate-900 flex flex-col">
      <header
        className={`${
          isSosActive
            ? 'bg-red-600 text-white border-b border-red-700'
            : 'bg-white/95 backdrop-blur-xl border-b border-red-200 text-slate-900'
        } px-5 py-4 transition-colors`}
      >
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {isSosActive ? (
              <ShieldAlert className="w-5 h-5 text-white shrink-0" />
            ) : (
              <Shield className="w-5 h-5 text-red-600 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="font-display text-base sm:text-lg font-bold truncate">
                {isSosActive
                  ? `EMERGENCY SOS — ${session?.userName}`
                  : isLiveActive
                    ? `Live Location Active — ${session?.userName}`
                    : pairing
                      ? `Guardian Watch · ${pairing.userName}`
                      : 'Safe Her Guardian Receiver'}
              </div>
              <div
                className={`text-[11px] truncate ${
                  isSosActive ? 'text-red-100' : 'text-slate-500'
                }`}
              >
                {pairing
                  ? `Trusted Contact: ${pairing.contactName} (${pairing.relationship})`
                  : 'Real-time automated live location receiver'}
                <span aria-hidden="true"> · </span>
                <span>{connected ? 'Live Stream Connected' : 'Connecting...'}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onExitGuardianView}
            className="min-h-[42px] px-3.5 rounded-xl btn-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>My Safe Her</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 flex flex-col gap-4">
        {needsPhonePairing ? (
          <form
            onSubmit={handlePairByPhone}
            className="max-w-lg mx-auto w-full rounded-3xl surface-white p-6 space-y-4 my-auto"
          >
            <h1 className="font-display text-xl font-bold text-slate-900">
              Connect Trusted Contact Receiver
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              Enter the mobile number your contact saved inside Safe Her. Once connected, any SOS or Live Location share will open automatically on this screen without asking her to press Send.
            </p>
            <div>
              <label
                htmlFor="guardian-phone-input"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Your Mobile Number
              </label>
              <input
                id="guardian-phone-input"
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder="+91 98201 34011"
                className="w-full min-h-[48px] px-3.5 rounded-xl surface-input font-mono text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full min-h-[48px] rounded-2xl btn-red text-sm font-semibold"
            >
              Connect Live Guardian Stream
            </button>
          </form>
        ) : (
          <>
            {/* Zero-Prompt Standby Banner when no active emergency */}
            {!session?.active && (
              <div className="rounded-3xl surface-white p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
                    <Radio className="w-4 h-4" />
                    <span>Zero-Prompt Automated Watch Armed</span>
                  </div>
                  <h1 className="font-display text-lg sm:text-xl font-bold text-slate-900">
                    {pairing
                      ? `Listening for ${pairing.userName}'s SOS & Live Location`
                      : 'Listening for Trusted Contact SOS Alerts'}
                  </h1>
                  <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                    The instant SOS is activated, her live-updating GPS map appears here automatically every 3 seconds—she never receives a Send prompt.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleArmAudioAndNotifications}
                  className="min-h-[46px] px-4 rounded-xl btn-red text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  {alertsArmed || notifGranted ? (
                    <>
                      <Check className="w-4 h-4 text-white" />
                      <span>Sound &amp; Alerts Ready</span>
                    </>
                  ) : (
                    <>
                      <Bell className="w-4 h-4" />
                      <span>Enable Sound &amp; Alerts</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Active SOS / Live Alert Waiting for Initial GPS Lock */}
            {session?.active && !session.currentLocation && (
              <div
                className={`rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                  isSosActive ? 'surface-red' : 'surface-white'
                }`}
              >
                <div className="space-y-1">
                  <div className="text-xs font-bold text-red-700 flex items-center gap-1.5">
                    <Radio className="w-4 h-4" />
                    <span>
                      {isSosActive
                        ? 'EMERGENCY SOS ACTIVE · Locking Satellite GPS'
                        : 'Live Location Share Active · Locking GPS'}
                    </span>
                  </div>
                  <div className="font-display text-lg font-bold text-slate-900">
                    {session.userName} triggered an automated alert
                    {session.triggerSource ? ` (${session.triggerSource})` : ''}
                  </div>
                  <p className="text-xs text-slate-600">
                    The live map pin will appear here automatically the instant GPS coordinates arrive.
                  </p>
                </div>
                <a
                  href="tel:112"
                  className="min-h-[46px] px-4 rounded-xl btn-red text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0"
                >
                  <PhoneCall className="w-4 h-4" />
                  <span>Call Police 112</span>
                </a>
              </div>
            )}

            {/* Active or Recent Live Location Map */}
            {session?.currentLocation && (
              <>
                <div
                  className={`rounded-3xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    isSosActive ? 'surface-red' : 'surface-white'
                  }`}
                >
                  <div>
                    <div className="text-xs text-slate-500">
                      <span className="font-semibold text-slate-900">
                        {session.active
                          ? session.mode === 'sos'
                            ? 'ACTIVE SOS · Streaming live every 3s'
                            : 'Live Walk Share · Streaming live every 3s'
                          : 'Session Ended · Showing last reported GPS pin'}
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span>
                        Updated{' '}
                        {new Date(session.updatedAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      {session.triggerSource && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span>{session.triggerSource}</span>
                        </>
                      )}
                    </div>
                    <div className="font-mono text-sm font-bold text-slate-900 mt-1 tabular-nums">
                      {session.currentLocation.lat.toFixed(6)},{' '}
                      {session.currentLocation.lng.toFixed(6)}
                      {session.currentLocation.accuracy
                        ? ` (±${Math.round(session.currentLocation.accuracy)}m)`
                        : ''}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    {isSosActive && (
                      <button
                        type="button"
                        onClick={() => AudioService.previewRingtone('chime')}
                        className="min-h-[46px] px-3.5 rounded-xl btn-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Volume2 className="w-4 h-4" />
                        <span>Sound Chime</span>
                      </button>
                    )}
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${session.currentLocation.lat},${session.currentLocation.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[46px] px-4 rounded-xl btn-white text-xs font-semibold flex items-center gap-2 whitespace-nowrap"
                    >
                      <Navigation className="w-4 h-4" />
                      <span>Navigate to Her</span>
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
                  <span>Automated Real-Time Guardian Stream</span>
                  <a
                    href={`https://maps.google.com/?q=${session.currentLocation.lat},${session.currentLocation.lng}`}
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
          </>
        )}
      </main>
    </div>
  );
};
