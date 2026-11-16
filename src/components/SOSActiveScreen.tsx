import React, {useEffect, useRef, useState} from 'react';
import L from 'leaflet';
import {
  Check,
  Copy,
  Delete,
  ExternalLink,
  Lock,
  MessageSquare,
  PhoneCall,
  Radio,
  Share2,
} from 'lucide-react';
import type {AlertDispatchResult} from '../services/SmsAlertService';
import {SmsAlertService} from '../services/SmsAlertService';
import {AudioService} from '../services/AudioService';
import type {
  CachedCoordinates,
  EmergencyContact,
  LiveShareSession,
  TriggerSource,
} from '../types/safety';

interface SOSActiveScreenProps {
  userName: string;
  sosPin: string;
  sirenInitiallyEnabled: boolean;
  triggerSource: TriggerSource;
  coords: CachedCoordinates | null;
  liveSession: LiveShareSession | null;
  dispatchResult: AlertDispatchResult | null;
  contacts: EmergencyContact[];
  onStopSOS: () => void;
}

export const SOSActiveScreen: React.FC<SOSActiveScreenProps> = ({
  userName,
  sosPin,
  sirenInitiallyEnabled,
  triggerSource,
  coords,
  liveSession,
  dispatchResult,
  contacts,
  onStopSOS,
}) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showPinPad, setShowPinPad] = useState(false);
  const [enteredPin, setEnteredPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [copied, setCopied] = useState(false);

  const miniMapRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const accuracyCircleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    if (sirenInitiallyEnabled) {
      AudioService.startSiren();
    }
    AudioService.startSOSVibration();

    const timer = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);

    return () => {
      clearInterval(timer);
      AudioService.stopSiren();
      AudioService.stopSOSVibration();
    };
  }, [sirenInitiallyEnabled]);

  // Live Mini-Map showing the automated broadcasted SOS pin
  useEffect(() => {
    if (showPinPad || !miniMapRef.current || !coords) return;

    if (!leafletMapRef.current) {
      const map = L.map(miniMapRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
      }).setView([coords.lat, coords.lng], 16);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      leafletMapRef.current = map;
    }

    const map = leafletMapRef.current;
    const sosPinIcon = L.divIcon({
      className: '',
      html: `<div style="width:22px;height:22px;border-radius:9999px;background:#DC2626;border:3px solid #ffffff;box-shadow:0 0 14px rgba(220,38,38,0.85);"></div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });

    if (!markerRef.current) {
      markerRef.current = L.marker([coords.lat, coords.lng], {icon: sosPinIcon}).addTo(map);
    } else {
      markerRef.current.setLatLng([coords.lat, coords.lng]);
    }

    if (!accuracyCircleRef.current) {
      accuracyCircleRef.current = L.circle([coords.lat, coords.lng], {
        radius: Math.max(15, coords.accuracy),
        color: '#EF4444',
        fillColor: '#EF4444',
        fillOpacity: 0.18,
        weight: 1.5,
      }).addTo(map);
    } else {
      accuracyCircleRef.current.setLatLng([coords.lat, coords.lng]);
      accuracyCircleRef.current.setRadius(Math.max(15, coords.accuracy));
    }

    map.panTo([coords.lat, coords.lng]);
  }, [coords, showPinPad]);

  useEffect(() => {
    if (showPinPad && leafletMapRef.current) {
      leafletMapRef.current.remove();
      leafletMapRef.current = null;
      markerRef.current = null;
      accuracyCircleRef.current = null;
    }
  }, [showPinPad]);

  useEffect(() => {
    return () => {
      leafletMapRef.current?.remove();
      leafletMapRef.current = null;
    };
  }, []);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const smsBackupUri = SmsAlertService.buildSmsComposerUri(
    contacts,
    SmsAlertService.buildEmergencyMessage({
      userName,
      coords,
      trackingUrl: liveSession?.trackingUrl,
    }),
  );

  const copyTrackingLink = async () => {
    const url = liveSession?.trackingUrl || SmsAlertService.buildGoogleMapsLink(coords) || '';
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const shareTrackingLink = async () => {
    const text = SmsAlertService.buildEmergencyMessage({
      userName,
      coords,
      trackingUrl: liveSession?.trackingUrl,
    });
    if (navigator.share) {
      try {
        await navigator.share({
          title: `SOS Emergency — ${userName || 'Safe Her'}`,
          text,
          url: liveSession?.trackingUrl,
        });
        return;
      } catch {
        // Fall through to copy
      }
    }
    await copyTrackingLink();
  };

  const handleDigitPress = (digit: string) => {
    if (enteredPin.length >= 4) return;
    const next = enteredPin + digit;
    setEnteredPin(next);
    setPinError('');

    if (next.length === 4) {
      if (next === sosPin) {
        AudioService.stopSiren();
        AudioService.stopSOSVibration();
        onStopSOS();
      } else {
        AudioService.vibrate([120, 80, 120]);
        setPinError('Incorrect PIN. Enter your 4-digit safety PIN to stop SOS.');
        window.setTimeout(() => setEnteredPin(''), 350);
      }
    }
  };

  const trustedContacts = contacts.filter((c) => !c.builtIn);

  return (
    <div className="fixed inset-0 z-50 bg-white text-slate-900 overflow-y-auto flex flex-col justify-between select-none">
      {/* Flashing Red Strobe Layer (Compositor Opacity Only) */}
      <div
        className="fixed inset-0 bg-red-600 pointer-events-none sos-strobe-overlay"
        aria-hidden="true"
      />

      {/* Main Content */}
      <div className="relative z-10 max-w-lg w-full mx-auto px-5 py-5 flex-1 flex flex-col justify-between gap-4">
        {/* Top Emergency Header */}
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-red-600 text-white px-4 py-3 shadow-md">
          <div>
            <div className="text-xs font-medium text-red-100">
              <span>{triggerSource}</span>
              <span aria-hidden="true"> · </span>
              <span className="font-mono tabular-nums">{formatTimer(elapsedSeconds)}</span>
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-white mt-0.5">
              SOS ACTIVE
            </h1>
          </div>
        </div>

        {/* Automated Live Location Stream & Contact Delivery Status */}
        {!showPinPad ? (
          <div className="space-y-3.5 my-auto">
            {/* Automated Live Location Sharing Card */}
            <div className="rounded-3xl surface-red overflow-hidden">
              <div className="p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-bold text-emerald-700">
                    <Radio className="w-4 h-4" />
                    <span>Live Location Auto-Shared · Zero Action Needed</span>
                  </span>
                  <span className="font-mono text-red-700 font-semibold tabular-nums">
                    {liveSession
                      ? `${liveSession.updateCount} pushes${
                          liveSession.activeViewers && liveSession.activeViewers > 0
                            ? ` · ${liveSession.activeViewers} watching`
                            : ''
                        }`
                      : 'Streaming...'}
                  </span>
                </div>

                <p className="text-xs text-slate-700 leading-relaxed">
                  {trustedContacts.length === 0
                    ? 'Continuous 3s live GPS stream is active. Add trusted contacts or call 112 / 1091 directly below.'
                    : dispatchResult?.channel === 'offline-sms'
                      ? `Offline Mode: Alert for all ${trustedContacts.length} trusted contacts is queued for silent automatic delivery as soon as signal returns (zero Send prompt).`
                      : `Your live tracking map was pushed automatically to all ${trustedContacts.length} trusted contacts with zero Send confirmation—updating every 3 seconds.`}
                </p>

                {/* Per-Contact Automated Dispatch Confirmation */}
                {trustedContacts.length > 0 && (
                  <div className="pt-1.5 border-t border-red-200 divide-y divide-red-200/70 max-h-28 overflow-y-auto">
                    {trustedContacts.map((c) => (
                      <div
                        key={c.id}
                        className="py-1.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="font-medium text-slate-900 truncate">
                          {c.name}{' '}
                          <span className="text-slate-500 font-normal">· {c.relationship}</span>
                        </span>
                        <span className="text-emerald-700 font-semibold whitespace-nowrap shrink-0 flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" />
                          <span>
                            {dispatchResult?.channel === 'offline-sms'
                              ? 'Queued Auto-Send'
                              : 'Auto-Shared Live'}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {coords ? (
                  <div className="pt-1 text-[11px] text-red-800 font-mono tabular-nums flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>
                      GPS {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>±{Math.round(coords.accuracy)}m</span>
                    <span aria-hidden="true">·</span>
                    <span>Auto-streaming every 3s</span>
                  </div>
                ) : (
                  <p className="text-xs text-amber-800 font-medium">
                    Locking satellite GPS — live map updates automatically the instant coordinates lock.
                  </p>
                )}
              </div>

              {/* Live Broadcast Mini-Map */}
              {coords && (
                <div className="border-t border-red-200 h-[140px] w-full relative">
                  <div ref={miniMapRef} className="w-full h-full" />
                </div>
              )}
            </div>

            {/* Direct Emergency Voice Calls */}
            <div className="grid grid-cols-2 gap-2.5">
              <a
                href="tel:112"
                className="min-h-[52px] px-4 rounded-2xl btn-red text-sm font-bold flex items-center justify-center gap-2 transition-all"
              >
                <PhoneCall className="w-4 h-4 shrink-0" />
                <span>Call Police 112</span>
              </a>
              <a
                href="tel:1091"
                className="min-h-[52px] px-4 rounded-2xl btn-white text-sm font-bold flex items-center justify-center gap-2 transition-all"
              >
                <PhoneCall className="w-4 h-4 text-red-600 shrink-0" />
                <span>Helpline 1091</span>
              </a>
            </div>

            {/* Quiet Secondary Backup Tools (No Manual Send Prompt Required) */}
            <details className="rounded-2xl surface-white px-4 py-2.5 text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold text-slate-900 select-none py-1">
                Optional manual backup tools (Cellular SMS / Copy URL)
              </summary>
              <div className="pt-3 pb-1 space-y-2.5">
                {liveSession?.trackingUrl && (
                  <div className="rounded-xl surface-well px-3 py-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] text-slate-700 truncate">
                      {liveSession.trackingUrl}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={copyTrackingLink}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg hover:bg-slate-200"
                        aria-label="Copy live tracking URL"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                      {coords && (
                        <a
                          href={`https://maps.google.com/?q=${coords.lat},${coords.lng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg hover:bg-slate-200"
                          aria-label="Open coordinates in Google Maps"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {smsBackupUri && (
                    <a
                      href={smsBackupUri}
                      className="min-h-[44px] px-3.5 rounded-xl btn-red font-semibold flex items-center justify-center gap-2 transition-all"
                    >
                      <MessageSquare className="w-4 h-4 shrink-0" />
                      <span>Cellular SMS Fallback</span>
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={shareTrackingLink}
                    className="min-h-[44px] px-3.5 rounded-xl btn-white font-semibold flex items-center justify-center gap-2 transition-all"
                  >
                    <Share2 className="w-4 h-4 shrink-0" />
                    <span>Copy / Share Link</span>
                  </button>
                </div>
              </div>
            </details>
          </div>
        ) : (
          /* PIN-Protected Stop Keypad in Thumb Zone */
          <div className="my-auto rounded-3xl surface-white p-5 space-y-4">
            <div className="text-center">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
                <Lock className="w-3.5 h-3.5" />
                <span>PIN Protection Active</span>
              </div>
              <h2 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                Enter 4-Digit PIN to Stop SOS
              </h2>
              <div className="flex items-center justify-center gap-3 mt-3">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`w-4 h-4 rounded-full border-2 transition-colors ${
                      enteredPin.length > i
                        ? 'bg-red-600 border-red-600'
                        : 'border-slate-300 bg-transparent'
                    }`}
                  />
                ))}
              </div>
              {pinError && <p className="text-xs text-red-700 mt-2 font-medium">{pinError}</p>}
            </div>

            <div className="grid grid-cols-3 gap-2.5 max-w-xs mx-auto">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  type="button"
                  onClick={() => handleDigitPress(digit)}
                  className="min-h-[54px] rounded-2xl btn-white font-mono text-xl font-bold text-slate-900 transition-all tabular-nums"
                >
                  {digit}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setShowPinPad(false);
                  setEnteredPin('');
                  setPinError('');
                }}
                className="min-h-[54px] rounded-2xl surface-well hover:bg-slate-200 text-xs font-semibold text-slate-700"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => handleDigitPress('0')}
                className="min-h-[54px] rounded-2xl btn-white font-mono text-xl font-bold text-slate-900 transition-all tabular-nums"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setEnteredPin((p) => p.slice(0, -1))}
                className="min-h-[54px] rounded-2xl surface-well hover:bg-slate-200 flex items-center justify-center text-slate-700"
                aria-label="Delete digit"
              >
                <Delete className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Bottom Stop SOS Button */}
        <div className="pb-2">
          {!showPinPad && (
            <button
              type="button"
              onClick={() => setShowPinPad(true)}
              className="w-full min-h-[58px] rounded-2xl bg-slate-900 text-white text-base font-bold hover:bg-slate-800 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-xl"
            >
              <Lock className="w-4 h-4 text-red-400" />
              <span>Stop SOS &amp; Live Share (Enter PIN)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
