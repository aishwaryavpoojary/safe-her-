/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Check,
  Copy,
  MapPin,
  PhoneIncoming,
  Settings as SettingsIcon,
  Shield,
  Square,
  Users,
  WifiOff,
} from 'lucide-react';
import {ContactsScreen} from './components/ContactsScreen';
import {FakeCallOverlay} from './components/FakeCallOverlay';
import {FakeCallScreen} from './components/FakeCallScreen';
import {GuardianWatchViewer} from './components/GuardianWatchViewer';
import {HomeScreen} from './components/HomeScreen';
import {LiveTrackingViewer} from './components/LiveTrackingViewer';
import {MapScreen} from './components/MapScreen';
import {OnboardingFlow} from './components/OnboardingFlow';
import {PWAInstallButton} from './components/PWAInstallButton';
import {SettingsScreen} from './components/SettingsScreen';
import {SOSActiveScreen} from './components/SOSActiveScreen';
import {SOSCountdownModal} from './components/SOSCountdownModal';
import {useOnlineStatus} from './hooks/useOnlineStatus';
import {AudioService} from './services/AudioService';
import {LocationService} from './services/LocationService';
import {ShakeService} from './services/ShakeService';
import type {AlertDispatchResult} from './services/SmsAlertService';
import {SmsAlertService} from './services/SmsAlertService';
import {StorageService} from './services/StorageService';
import {TriggerService} from './services/TriggerService';
import type {
  AppSettings,
  CachedCoordinates,
  EmergencyContact,
  FakeCallConfig,
  LiveShareDuration,
  LiveShareSession,
  NavTab,
  SOSLogEntry,
  TriggerSource,
} from './types/safety';

export default function App() {
  // Check if URL was opened via a shared `?track=<sessionId>` link
  const [trackingQuery, setTrackingQuery] = useState<{
    sessionId: string;
    lat: number | null;
    lng: number | null;
  } | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const trackId = params.get('track');
    if (!trackId) return null;
    const lat = params.get('lat') ? Number(params.get('lat')) : null;
    const lng = params.get('lng') ? Number(params.get('lng')) : null;
    return {
      sessionId: trackId,
      lat: lat !== null && !Number.isNaN(lat) ? lat : null,
      lng: lng !== null && !Number.isNaN(lng) ? lng : null,
    };
  });

  // Check if URL was opened via a Trusted Contact `?guardian=<guardianId|watch>` receiver link
  const [guardianQuery, setGuardianQuery] = useState<{
    guardianId: string | null;
    phone: string | null;
  } | null>(() => {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const gId = params.get('guardian');
    if (!gId) return null;
    return {
      guardianId: gId,
      phone: params.get('phone'),
    };
  });

  const isOnline = useOnlineStatus();

  const [settings, setSettings] = useState<AppSettings>(() => StorageService.getSettings());
  const [allContacts, setAllContacts] = useState<EmergencyContact[]>(() =>
    StorageService.getAllContacts(),
  );
  const [coords, setCoords] = useState<CachedCoordinates | null>(() =>
    LocationService.getCachedLocation(),
  );
  const [geoError, setGeoError] = useState<string>('');
  const [sosLogs, setSosLogs] = useState<SOSLogEntry[]>(() => StorageService.getSOSLogs());

  const [activeTab, setActiveTab] = useState<NavTab>('home');

  // SOS State Machine
  const [countdownSource, setCountdownSource] = useState<TriggerSource | null>(null);
  const [sosActive, setSosActive] = useState<boolean>(false);
  const [activeSosLogId, setActiveSosLogId] = useState<string | null>(null);
  const [activeTriggerSource, setActiveTriggerSource] =
    useState<TriggerSource>('One-Tap SOS Button');
  const [dispatchResult, setDispatchResult] = useState<AlertDispatchResult | null>(null);

  // Live Location Sharing Session (SOS or Manual)
  const [liveSession, setLiveSession] = useState<LiveShareSession | null>(null);
  const [copiedBannerLink, setCopiedBannerLink] = useState(false);

  // Fake Call State Machine
  const [activeFakeCall, setActiveFakeCall] = useState<FakeCallConfig | null>(null);
  const [scheduledFakeCallSeconds, setScheduledFakeCallSeconds] = useState<number | null>(null);
  const pendingFakeCallRef = useRef<FakeCallConfig | null>(null);
  const fakeCallIntervalRef = useRef<number | null>(null);

  // Subtle visual toast for logo tap count (1/3, 2/3)
  const [logoTapHint, setLogoTapHint] = useState<string>('');

  // Hydrate IndexedDB fallback on first mount
  useEffect(() => {
    void StorageService.hydrateFromIndexedDB().then(() => {
      setSettings(StorageService.getSettings());
      setAllContacts(StorageService.getAllContacts());
      setSosLogs(StorageService.getSOSLogs());
      const cached = LocationService.getCachedLocation();
      if (cached) setCoords(cached);
    });
  }, []);

  const isReceiverMode = Boolean(trackingQuery || guardianQuery);

  // Subscribe to continuous GPS caching once onboarded
  useEffect(() => {
    if (!settings.onboarded || isReceiverMode) return;

    const unsubscribe = LocationService.subscribe(
      (freshCoords) => {
        setCoords(freshCoords);
        setGeoError('');
      },
      (errMessage) => {
        setGeoError(errMessage);
      },
    );

    LocationService.startContinuousWatch();

    return () => {
      unsubscribe();
    };
  }, [settings.onboarded, isReceiverMode]);

  // Pre-sync saved Trusted Contacts & flush any queued offline alerts with zero Send prompt
  useEffect(() => {
    if (!settings.onboarded || isReceiverMode || !isOnline) return;
    void LocationService.syncGuardianDirectory(
      settings.userId,
      settings.userName,
      allContacts,
    );
    void SmsAlertService.flushPendingDispatches();
  }, [settings.onboarded, settings.userId, settings.userName, allContacts, isOnline, isReceiverMode]);

  const buildQuickFakeCallConfig = useCallback(
    (currentSettings: AppSettings): FakeCallConfig => {
      const defaults: Record<string, {name: string; phone: string}> = {
        Mom: {name: 'Mom', phone: '+91 98201 34011'},
        Dad: {name: 'Dad', phone: '+91 98201 34012'},
        Sister: {name: 'Sister', phone: '+91 98201 77829'},
        Police: {name: 'Police Patrol Dispatch', phone: '112'},
      };
      const preset = currentSettings.defaultFakeCaller;
      const callerName =
        preset === 'Custom'
          ? currentSettings.customFakeCallerName || 'Trusted Caller'
          : defaults[preset]?.name || 'Mom';
      const callerPhone =
        preset === 'Custom'
          ? currentSettings.customFakeCallerPhone || '+91 98201 44120'
          : defaults[preset]?.phone || '+91 98201 34011';

      return {
        preset,
        callerName,
        callerPhone,
        ringtone: currentSettings.defaultRingtone,
        delaySeconds: 0,
      };
    },
    [],
  );

  const cancelScheduledFakeCall = useCallback(() => {
    if (fakeCallIntervalRef.current !== null) {
      clearInterval(fakeCallIntervalRef.current);
      fakeCallIntervalRef.current = null;
    }
    pendingFakeCallRef.current = null;
    setScheduledFakeCallSeconds(null);
  }, []);

  const scheduleOrStartFakeCall = useCallback(
    (config: FakeCallConfig) => {
      cancelScheduledFakeCall();
      if (config.delaySeconds === 0) {
        setActiveFakeCall(config);
        return;
      }

      pendingFakeCallRef.current = config;
      setScheduledFakeCallSeconds(config.delaySeconds);

      fakeCallIntervalRef.current = window.setInterval(() => {
        setScheduledFakeCallSeconds((prev) => {
          if (prev === null) return null;
          if (prev <= 1) {
            if (fakeCallIntervalRef.current !== null) {
              clearInterval(fakeCallIntervalRef.current);
              fakeCallIntervalRef.current = null;
            }
            const readyConfig = pendingFakeCallRef.current;
            pendingFakeCallRef.current = null;
            if (readyConfig) {
              setActiveFakeCall(readyConfig);
            }
            return null;
          }
          return prev - 1;
        });
      }, 1000);
    },
    [cancelScheduledFakeCall],
  );

  const startSOSCountdown = useCallback(
    (source: TriggerSource) => {
      if (sosActive || countdownSource !== null) return;
      setActiveFakeCall(null);
      setCountdownSource(source);
      // Pre-warm high-accuracy GPS immediately during the 5s countdown so coordinates are ready at trigger
      void LocationService.requestSingleFix(4500, 0).catch(() => {});
    },
    [sosActive, countdownSource],
  );

  // Wire Shake-to-Alert
  useEffect(() => {
    if (!settings.onboarded || isReceiverMode) return;

    ShakeService.configure({
      enabled: settings.shakeEnabled && !sosActive && countdownSource === null,
      sensitivity: settings.shakeSensitivity,
      onTrigger: () => {
        startSOSCountdown('Shake-to-Alert (3x Shake)');
      },
    });

    return () => {
      ShakeService.stop();
    };
  }, [
    settings.onboarded,
    settings.shakeEnabled,
    settings.shakeSensitivity,
    sosActive,
    countdownSource,
    isReceiverMode,
    startSOSCountdown,
  ]);

  // Wire Multi-Press & Power-Button Abstraction TriggerService
  useEffect(() => {
    if (!settings.onboarded || isReceiverMode) return;

    TriggerService.configure({
      enabled: settings.multiPressEnabled && !sosActive && countdownSource === null,
      volumeKeysEnabled: settings.multiPressVolumeKeys,
      screenWakeEnabled: settings.multiPressScreenWake,
      logoTripleTapEnabled: settings.multiPressLogoTripleTap,
      onTrigger: (source) => {
        AudioService.vibrate([120, 60, 120]);
        if (settings.multiPressAction === 'fakecall') {
          scheduleOrStartFakeCall(buildQuickFakeCallConfig(settings));
        } else {
          startSOSCountdown(source);
        }
      },
    });

    return () => {
      TriggerService.detachAll();
    };
  }, [
    settings,
    sosActive,
    countdownSource,
    isReceiverMode,
    startSOSCountdown,
    scheduleOrStartFakeCall,
    buildQuickFakeCallConfig,
  ]);

  // Track whether initial SOS dispatch lacked GPS coordinates so we auto-redispatch on first fix
  const pendingGpsCatchupRef = useRef<boolean>(false);

  // Execute Full SOS Trigger when 5s Countdown Finishes (or Immediate Trigger tapped)
  const executeSOSAlert = useCallback(async () => {
    const source = countdownSource || 'One-Tap SOS Button';
    setCountdownSource(null);
    setActiveTriggerSource(source);
    setSosActive(true);

    // 1. Automatically start continuous emergency live location sharing (0ms blocking delay + 3s heartbeat)
    const session = await LocationService.startLiveSession({
      mode: 'sos',
      durationMinutes: 0,
      userName: settings.userName,
      contacts: allContacts,
      triggerSource: source,
      onSessionUpdate: (updated) => setLiveSession(updated),
    });
    setLiveSession(session);

    const latestCoords = LocationService.getCachedLocation() || coords;
    if (latestCoords) {
      setCoords(latestCoords);
      pendingGpsCatchupRef.current = false;
    } else {
      pendingGpsCatchupRef.current = true;
    }

    // 2. Automatically dispatch emergency live tracking link to all saved contacts with zero Send prompt
    const result = await SmsAlertService.dispatchEmergencyAlert({
      sessionId: session.id,
      userId: settings.userId,
      userName: settings.userName,
      mode: 'sos',
      expiresAt: session.expiresAt,
      triggerSource: source,
      contacts: allContacts,
      coords: latestCoords,
      trackingUrl: session.trackingUrl,
    });
    setDispatchResult(result);

    // 3. Log SOS event in offline history
    const logId = `sos_${Date.now()}`;
    setActiveSosLogId(logId);
    const updatedLogs = StorageService.addSOSLog({
      id: logId,
      timestamp: Date.now(),
      triggerSource: source,
      lat: latestCoords?.lat ?? null,
      lng: latestCoords?.lng ?? null,
      mapsUrl: SmsAlertService.buildGoogleMapsLink(latestCoords),
      trackingUrl: session.trackingUrl,
      alertChannel: result.channel,
      contactsCount: result.recipientCount,
    });
    setSosLogs(updatedLogs);
  }, [
    countdownSource,
    allContacts,
    settings.userId,
    settings.userName,
    coords,
  ]);

  // If SOS started before first GPS lock completed, automatically re-dispatch with exact coordinates once locked
  useEffect(() => {
    if (!sosActive || !pendingGpsCatchupRef.current || !coords || !liveSession) return;
    pendingGpsCatchupRef.current = false;

    void SmsAlertService.dispatchEmergencyAlert({
      sessionId: liveSession.id,
      userId: settings.userId,
      userName: settings.userName,
      mode: 'sos',
      expiresAt: liveSession.expiresAt,
      triggerSource: activeTriggerSource,
      contacts: allContacts,
      coords,
      trackingUrl: liveSession.trackingUrl,
    }).then((res) => {
      setDispatchResult(res);
    });

    if (activeSosLogId) {
      const updated = StorageService.updateSOSLog(activeSosLogId, {
        lat: coords.lat,
        lng: coords.lng,
        mapsUrl: SmsAlertService.buildGoogleMapsLink(coords),
        trackingUrl: liveSession.trackingUrl,
      });
      setSosLogs(updated);
    }
  }, [
    sosActive,
    coords,
    liveSession,
    activeSosLogId,
    activeTriggerSource,
    settings.userId,
    settings.userName,
    allContacts,
  ]);

  const handleStopSOS = useCallback(async () => {
    pendingGpsCatchupRef.current = false;
    setSosActive(false);
    setDispatchResult(null);
    if (activeSosLogId) {
      setSosLogs(StorageService.markSOSLogEnded(activeSosLogId));
      setActiveSosLogId(null);
    }
    await LocationService.stopLiveSession();
    setLiveSession(null);
  }, [activeSosLogId]);

  const handleStartManualLiveShare = async (duration: LiveShareDuration) => {
    const session = await LocationService.startLiveSession({
      mode: 'live',
      durationMinutes: duration,
      userName: settings.userName,
      contacts: allContacts,
      onSessionUpdate: (updated) => setLiveSession(updated),
    });
    setLiveSession(session);

    const latestCoords = LocationService.getCachedLocation() || coords;
    void SmsAlertService.dispatchEmergencyAlert({
      sessionId: session.id,
      userId: settings.userId,
      userName: settings.userName,
      mode: 'live',
      expiresAt: session.expiresAt,
      contacts: allContacts,
      coords: latestCoords,
      trackingUrl: session.trackingUrl,
    });
  };

  const handleStopManualLiveShare = async () => {
    await LocationService.stopLiveSession();
    setLiveSession(null);
  };

  const handleRefreshLocation = async () => {
    try {
      const fresh = await LocationService.requestSingleFix(9000);
      setCoords(fresh);
      setGeoError('');
    } catch (err) {
      setGeoError(
        err instanceof Error ? err.message : 'Unable to lock GPS coordinates.',
      );
    }
  };

  const handleUpdateSettings = (next: AppSettings) => {
    setSettings(next);
    StorageService.saveSettings(next);
  };

  const handleSaveTrustedContacts = (trusted: EmergencyContact[]) => {
    StorageService.saveTrustedContacts(trusted);
    setAllContacts(StorageService.getAllContacts());
  };

  const handleLogoPanicTap = () => {
    const count = TriggerService.registerLogoTap();
    if (count === 1 || count === 2) {
      setLogoTapHint(`${count}/3 panic taps`);
      window.setTimeout(() => setLogoTapHint(''), 1300);
    } else {
      setLogoTapHint('');
    }
  };

  // Dedicated Trusted Contact Zero-Prompt Guardian Receiver View (`/?guardian=<guardianId|watch>`)
  if (guardianQuery) {
    return (
      <GuardianWatchViewer
        initialGuardianId={guardianQuery.guardianId}
        initialPhone={guardianQuery.phone}
        onExitGuardianView={() => {
          window.history.replaceState({}, '', '/');
          setGuardianQuery(null);
        }}
      />
    );
  }

  // Dedicated Live Tracking Map View when a contact opens `/?track=<sessionId>`
  if (trackingQuery) {
    return (
      <LiveTrackingViewer
        sessionId={trackingQuery.sessionId}
        fallbackLat={trackingQuery.lat}
        fallbackLng={trackingQuery.lng}
        onExitTrackingView={() => {
          window.history.replaceState({}, '', '/');
          setTrackingQuery(null);
        }}
      />
    );
  }

  // First-Launch Onboarding Flow
  if (!settings.onboarded) {
    return (
      <OnboardingFlow
        initialSettings={settings}
        initialTrustedContacts={allContacts.filter((c) => !c.builtIn)}
        onFinish={(completedSettings, trustedContacts) => {
          StorageService.saveSettings(completedSettings);
          StorageService.saveTrustedContacts(trustedContacts);
          setSettings(completedSettings);
          setAllContacts(StorageService.getAllContacts());
        }}
      />
    );
  }

  const navItems: Array<{id: NavTab; label: string; icon: React.ComponentType<{className?: string}>}> = [
    {id: 'home', label: 'Home', icon: Shield},
    {id: 'contacts', label: 'Contacts', icon: Users},
    {id: 'map', label: 'Map', icon: MapPin},
    {id: 'fakecall', label: 'Fake Call', icon: PhoneIncoming},
    {id: 'settings', label: 'Settings', icon: SettingsIcon},
  ];

  return (
    <div className="min-h-screen text-slate-900 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 h-[54px] bg-white/90 backdrop-blur-xl border-b border-red-200 px-4 sm:px-6 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line Brand Wordmark (Triple-Tap Panic Gesture Target) */}
        <button
          type="button"
          onClick={handleLogoPanicTap}
          title="Triple-tap rapidly for emergency trigger"
          className="font-display text-lg font-extrabold tracking-tight text-red-700 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-red-600 rounded-lg py-1"
        >
          Safe Her
        </button>

        {/* Zone 2: 5 Clean Single-Line Text Nav Links on Desktop */}
        <nav
          aria-label="Primary navigation"
          className="hidden lg:flex items-center gap-7 text-sm font-medium text-slate-600"
        >
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === item.id
                  ? 'text-red-700 font-semibold border-red-600'
                  : 'border-transparent hover:text-slate-900 hover:border-red-300'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <PWAInstallButton variant="header" />
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 pt-4 pb-24 lg:pb-10 space-y-4">
        {/* Subtle feedback when tapping logo 1x/2x */}
        {logoTapHint && (
          <div className="rounded-xl surface-red text-red-900 px-3.5 py-2 text-xs font-medium text-center">
            {logoTapHint} — tap 3 times quickly to launch{' '}
            {settings.multiPressAction === 'sos' ? 'SOS' : 'Fake Call'}
          </div>
        )}

        {/* Non-Sticky Offline Mode Notice */}
        {!isOnline && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-2.5 text-xs font-medium text-amber-900">
            <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              Offline Mode — Siren, Fake Call, cached nearby stations, and cellular SMS alerts are active without internet.
            </span>
          </div>
        )}

        {/* Persistent Visible Live Location Sharing Indicator with One-Tap Stop */}
        {liveSession && liveSession.mode === 'live' && (
          <div className="rounded-2xl surface-red text-slate-900 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs">
              <span className="font-bold text-red-800">Live Location Sharing Active</span>
              <span aria-hidden="true"> · </span>
              <span className="text-red-700 font-mono tabular-nums">
                {liveSession.updateCount} GPS updates
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(liveSession.trackingUrl);
                    setCopiedBannerLink(true);
                    window.setTimeout(() => setCopiedBannerLink(false), 1800);
                  } catch {
                    // Ignore
                  }
                }}
                className="min-h-[38px] px-3 rounded-xl btn-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
              >
                {copiedBannerLink ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedBannerLink ? 'Copied' : 'Copy Link'}</span>
              </button>
              <button
                type="button"
                onClick={handleStopManualLiveShare}
                className="min-h-[38px] px-3.5 rounded-xl btn-red text-xs font-bold flex items-center gap-1.5 whitespace-nowrap"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Stop</span>
              </button>
            </div>
          </div>
        )}

        {/* Active Tab Screen */}
        {activeTab === 'home' && (
          <HomeScreen
            settings={settings}
            contacts={allContacts}
            coords={coords}
            geoError={geoError}
            isOnline={isOnline}
            liveSession={liveSession}
            sosLogs={sosLogs}
            scheduledFakeCallIn={scheduledFakeCallSeconds}
            onStartSOSCountdown={() => startSOSCountdown('One-Tap SOS Button')}
            onQuickFakeCallNow={() =>
              scheduleOrStartFakeCall(buildQuickFakeCallConfig(settings))
            }
            onCancelScheduledFakeCall={cancelScheduledFakeCall}
            onStartManualLiveShare={handleStartManualLiveShare}
            onStopManualLiveShare={handleStopManualLiveShare}
            onRefreshLocation={handleRefreshLocation}
            onNavigateTab={setActiveTab}
          />
        )}

        {activeTab === 'contacts' && (
          <ContactsScreen
            userName={settings.userName}
            allContacts={allContacts}
            coords={coords}
            onSaveTrustedContacts={handleSaveTrustedContacts}
          />
        )}

        {activeTab === 'map' && (
          <MapScreen
            coords={coords}
            geoError={geoError}
            isOnline={isOnline}
            onRefreshLocation={handleRefreshLocation}
          />
        )}

        {activeTab === 'fakecall' && (
          <FakeCallScreen
            settings={settings}
            scheduledSecondsLeft={scheduledFakeCallSeconds}
            onScheduleFakeCall={scheduleOrStartFakeCall}
            onCancelSchedule={cancelScheduledFakeCall}
            onUpdateSettings={handleUpdateSettings}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsScreen
            settings={settings}
            sosLogs={sosLogs}
            onUpdateSettings={handleUpdateSettings}
            onClearLogs={() => {
              StorageService.clearSOSLogs();
              setSosLogs([]);
            }}
          />
        )}
      </main>

      {/* Fixed Bottom One-Handed Mobile Navigation Bar (5 Tabs, >=44px hitboxes) */}
      <nav
        aria-label="Mobile bottom navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 h-[62px] bg-white/95 backdrop-blur-xl border-t border-slate-200 grid grid-cols-5 items-center px-1 select-none"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const isSosTab = item.id === 'home';

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center rounded-xl transition-colors ${
                isActive
                  ? isSosTab
                    ? 'text-red-600 font-bold'
                    : 'text-red-700 font-bold'
                  : 'text-slate-500 hover:text-slate-900 font-medium'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] tracking-tight mt-1 whitespace-nowrap">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Full-Screen 5-Second SOS Countdown Overlay */}
      {countdownSource !== null && (
        <SOSCountdownModal
          triggerSource={countdownSource}
          onCancel={() => setCountdownSource(null)}
          onConfirmTrigger={executeSOSAlert}
        />
      )}

      {/* Full-Screen SOS ACTIVE Overlay (PIN-Protected Stop) */}
      {sosActive && (
        <SOSActiveScreen
          userName={settings.userName}
          sosPin={settings.sosPin}
          sirenInitiallyEnabled={settings.sirenEnabled}
          triggerSource={activeTriggerSource}
          coords={coords}
          liveSession={liveSession}
          dispatchResult={dispatchResult}
          contacts={allContacts}
          onStopSOS={handleStopSOS}
        />
      )}

      {/* Full-Screen Realistic Offline Fake Call Overlay */}
      {activeFakeCall && !sosActive && (
        <FakeCallOverlay
          config={activeFakeCall}
          contacts={allContacts}
          onEndCall={() => setActiveFakeCall(null)}
          onEscalateSOS={() => {
            setActiveFakeCall(null);
            startSOSCountdown('Fake Call Emergency Escalation');
          }}
        />
      )}
    </div>
  );
}
