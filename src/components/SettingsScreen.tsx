import React, {useEffect, useState} from 'react';
import {
  Activity,
  Check,
  Code2,
  ExternalLink,
  History,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {ShakeService} from '../services/ShakeService';
import {SmsAlertService} from '../services/SmsAlertService';
import {TriggerService} from '../services/TriggerService';
import type {AppSettings, SOSLogEntry} from '../types/safety';
import {PWAInstallButton} from './PWAInstallButton';
import {PermissionsWizard} from './PermissionsWizard';
import {SOSUsageSummaryChart} from './SOSUsageSummaryChart';

interface SettingsScreenProps {
  settings: AppSettings;
  sosLogs: SOSLogEntry[];
  onUpdateSettings: (next: AppSettings) => void;
  onClearLogs: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({
  settings,
  sosLogs,
  onUpdateSettings,
  onClearLogs,
}) => {
  const [nameDraft, setNameDraft] = useState(settings.userName);
  const [pinDraft, setPinDraft] = useState(settings.sosPin);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileError, setProfileError] = useState('');

  // Live Shake Sensor Test state
  const [testingShake, setTestingShake] = useState(false);
  const [shakeMagnitude, setShakeMagnitude] = useState(0);
  const [shakePeaks, setShakePeaks] = useState(0);
  const [showPermissionsWizard, setShowPermissionsWizard] = useState(false);
  const [serverSmsStatus, setServerSmsStatus] = useState<{
    configured: boolean;
    provider: string | null;
  }>({configured: false, provider: null});

  useEffect(() => {
    void SmsAlertService.getServerSmsStatus().then(setServerSmsStatus);
  }, []);

  useEffect(() => {
    if (!testingShake) return;

    // Temporarily attach meter callback without firing real SOS
    ShakeService.configure({
      enabled: false,
      sensitivity: settings.shakeSensitivity,
      onTrigger: () => {},
      onMeterUpdate: (mag, count) => {
        setShakeMagnitude(mag);
        setShakePeaks(count);
      },
    });

    return () => {
      // Restore normal global ShakeService configuration handled by App.tsx
      setShakeMagnitude(0);
      setShakePeaks(0);
    };
  }, [testingShake, settings.shakeSensitivity]);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameDraft.trim()) {
      setProfileError('Your name cannot be empty.');
      return;
    }
    if (!/^\d{4}$/.test(pinDraft)) {
      setProfileError('SOS Stop PIN must be exactly 4 digits.');
      return;
    }
    setProfileError('');
    onUpdateSettings({
      ...settings,
      userName: nameDraft.trim(),
      sosPin: pinDraft,
    });
    setProfileSaved(true);
    window.setTimeout(() => setProfileSaved(false), 2000);
  };

  const toggleField = (key: keyof AppSettings) => {
    onUpdateSettings({
      ...settings,
      [key]: !settings[key],
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Column: Profile, Triggers & Native Capacitor Hook Spec */}
      <section className="lg:col-span-7 space-y-6">
        <div>
          <p className="text-xs text-slate-500">Offline Device Preferences</p>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
            Safety Settings &amp; Triggers
          </h1>
        </div>

        {/* PWA Install Prompt Card */}
        <PWAInstallButton variant="card" />

        {/* Profile & 4-Digit SOS PIN */}
        <form
          onSubmit={handleSaveProfile}
          className="rounded-3xl surface-white p-5 space-y-4"
        >
          <h2 className="font-display text-base font-bold text-slate-900">
            Identity &amp; SOS Stop PIN
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="settings-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Your Name (sent in SMS)
              </label>
              <input
                id="settings-name"
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="w-full min-h-[46px] px-3.5 rounded-xl surface-input text-sm"
              />
            </div>
            <div>
              <label htmlFor="settings-pin" className="block text-xs font-semibold text-slate-700 mb-1">
                4-Digit Stop SOS PIN
              </label>
              <input
                id="settings-pin"
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={pinDraft}
                onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-full min-h-[46px] px-3.5 rounded-xl surface-input font-mono text-sm tracking-widest tabular-nums"
              />
            </div>
          </div>

          {profileError && <p className="text-xs text-red-700">{profileError}</p>}

          <button
            type="submit"
            className="min-h-[46px] px-5 rounded-xl btn-red text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            {profileSaved ? <Check className="w-4 h-4" /> : null}
            <span>{profileSaved ? 'Saved Locally' : 'Save Name & PIN'}</span>
          </button>
        </form>

        {/* Siren, Automated SOS Live Location & Shake-to-Alert Controls */}
        <div className="rounded-3xl surface-red p-5 space-y-5">
          <h2 className="font-display text-base font-bold text-slate-900">
            SOS Automation &amp; Shake-to-Alert
          </h2>

          {/* Automated Emergency Live Location Share Status */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Zero-Prompt Automated SOS Live Location Share
                </div>
                <div className="text-xs text-slate-600 leading-relaxed mt-0.5">
                  Automatically streams live GPS coordinates every 3 seconds directly to all saved contacts with zero Send prompt. Sends silent carrier SMS when Capacitor <code className="font-mono text-[11px] text-red-700">SafeHerSms</code> (<code className="font-mono text-[11px] text-red-700">SmsManager</code>) or Server SMS Relay is active; web browsers otherwise block websites from silently sending SMS through the phone&apos;s default Messages app without a Send tap.
                </div>
              </div>
              <span className="text-xs font-bold text-emerald-700 whitespace-nowrap shrink-0">
                Always Active
              </span>
            </div>

            <div className="pt-3 border-t border-red-200 text-xs space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-700 font-medium">Real-Time Guardian Stream (Zero Prompt)</span>
                <span className="font-semibold text-emerald-700 shrink-0">Ready</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-700 font-medium">Phone Default Messenger (Capacitor SmsManager)</span>
                <span
                  className={`font-semibold shrink-0 ${
                    SmsAlertService.isNativeMessengerPluginConnected()
                      ? 'text-emerald-700'
                      : 'text-slate-600'
                  }`}
                >
                  {SmsAlertService.isNativeMessengerPluginConnected()
                    ? 'Native SmsManager Connected'
                    : 'Android APK Bridge Ready'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-700 font-medium">Automated Server SMS Relay</span>
                <span
                  className={`font-semibold shrink-0 ${
                    serverSmsStatus.configured ? 'text-emerald-700' : 'text-slate-600'
                  }`}
                >
                  {serverSmsStatus.configured
                    ? `Active (${serverSmsStatus.provider})`
                    : 'Not Configured on Server'}
                </span>
              </div>
            </div>

            <div>
              <a
                href="/?guardian=watch"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[40px] px-3.5 rounded-xl btn-white text-xs font-semibold items-center gap-1.5"
              >
                <span>Open Trusted Contact Guardian Receiver</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          {/* Auto Siren Toggle */}
          <div className="pt-4 border-t border-red-200 flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-900">Loud Web Audio Siren</div>
              <div className="text-xs text-slate-600">
                Automatically play offline high-decibel siren when SOS countdown finishes
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.sirenEnabled}
              onClick={() => toggleField('sirenEnabled')}
              className={`min-h-[32px] w-14 rounded-full p-1 transition-colors shrink-0 border ${
                settings.sirenEnabled
                  ? 'bg-red-600 border-red-700'
                  : 'bg-slate-300 border-slate-400'
              }`}
            >
              <span
                className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${
                  settings.sirenEnabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Shake-to-Alert Toggle */}
          <div className="pt-4 border-t border-red-200 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900">
                  Shake-to-Alert (3 Hard Shakes in 2s)
                </div>
                <div className="text-xs text-slate-600">
                  Starts the 5-second SOS countdown using DeviceMotion sensors
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.shakeEnabled}
                onClick={async () => {
                  if (!settings.shakeEnabled && ShakeService.requiresExplicitIOSPermission()) {
                    await ShakeService.requestPermission();
                  }
                  toggleField('shakeEnabled');
                }}
                className={`min-h-[32px] w-14 rounded-full p-1 transition-colors shrink-0 border ${
                  settings.shakeEnabled
                    ? 'bg-red-600 border-red-700'
                    : 'bg-slate-300 border-slate-400'
                }`}
              >
                <span
                  className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${
                    settings.shakeEnabled ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
              Browser Notice: Shake detection only works while Safe Her is open in the foreground, because mobile browsers suspend DeviceMotion events when locked or minimized.
            </div>

            {/* Sensitivity Selector */}
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-slate-800">Shake Sensitivity</div>
              <div className="grid grid-cols-3 gap-1.5 surface-well p-1 rounded-xl">
                {(
                  [
                    {id: 'low', label: 'Low (Firm)'},
                    {id: 'medium', label: 'Medium'},
                    {id: 'high', label: 'High (Light)'},
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() =>
                      onUpdateSettings({...settings, shakeSensitivity: opt.id})
                    }
                    className={`min-h-[40px] rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                      settings.shakeSensitivity === opt.id
                        ? 'btn-red'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Safe Shake Sensor Tester */}
            <div className="pt-1">
              <button
                type="button"
                onClick={async () => {
                  if (!testingShake && ShakeService.requiresExplicitIOSPermission()) {
                    await ShakeService.requestPermission();
                  }
                  setTestingShake((t) => !t);
                }}
                className="min-h-[42px] px-3.5 rounded-xl btn-white text-xs font-semibold flex items-center gap-2"
              >
                <Activity className="w-4 h-4 text-red-600" />
                <span>{testingShake ? 'Stop Sensor Test' : 'Test Shake Sensor Safely'}</span>
              </button>

              {testingShake && (
                <div className="mt-2.5 rounded-xl surface-white p-3 text-xs text-slate-700 flex items-center justify-between font-mono tabular-nums">
                  <span>Force: {shakeMagnitude.toFixed(1)} m/s²</span>
                  <span className="font-bold text-red-700">
                    Shakes detected: {shakePeaks}/3
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Power-Button / Multi-Press Abstraction Layer Settings */}
        <div className="rounded-3xl surface-white p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Multi-Press &amp; Power-Button Trigger
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Unified TriggerService listening to web panic signals and Capacitor native hooks
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.multiPressEnabled}
              onClick={() => toggleField('multiPressEnabled')}
              className={`min-h-[32px] w-14 rounded-full p-1 transition-colors shrink-0 border ${
                settings.multiPressEnabled
                  ? 'bg-red-600 border-red-700'
                  : 'bg-slate-300 border-slate-400'
              }`}
            >
              <span
                className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${
                  settings.multiPressEnabled ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Choose Action for Multi-Press (SOS vs Fake Call) */}
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-800">
              Action Run by Multi-Press Trigger
            </div>
            <div className="grid grid-cols-2 gap-1.5 surface-well p-1 rounded-xl">
              <button
                type="button"
                onClick={() => onUpdateSettings({...settings, multiPressAction: 'sos'})}
                className={`min-h-[42px] rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                  settings.multiPressAction === 'sos'
                    ? 'btn-red'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Start SOS Countdown
              </button>
              <button
                type="button"
                onClick={() => onUpdateSettings({...settings, multiPressAction: 'fakecall'})}
                className={`min-h-[42px] rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                  settings.multiPressAction === 'fakecall'
                    ? 'bg-white text-slate-900 border border-slate-300 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Trigger Fake Call Now
              </button>
            </div>
          </div>

          {/* Individual Web Signal Toggles */}
          <div className="divide-y divide-slate-200 border-t border-slate-200 pt-2">
            {(
              [
                {
                  key: 'multiPressLogoTripleTap',
                  title: 'Triple-Tap Safe Her Shield Logo',
                  sub: 'Tap the top-left wordmark 3 times rapidly from any screen',
                },
                {
                  key: 'multiPressVolumeKeys',
                  title: 'Rapid Volume Key Presses (3x)',
                  sub: 'Detects 3 rapid Volume Up/Down key events where exposed by browser',
                },
                {
                  key: 'multiPressScreenWake',
                  title: 'Rapid Screen Lock / Wake Cycles',
                  sub: 'Detects rapid visibilitychange transitions within 4.5 seconds',
                },
              ] as const
            ).map((sig) => (
              <div key={sig.key} className="py-3 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-slate-900">{sig.title}</div>
                  <div className="text-[11px] text-slate-500">{sig.sub}</div>
                </div>
                <input
                  type="checkbox"
                  checked={Boolean(settings[sig.key])}
                  disabled={!settings.multiPressEnabled}
                  onChange={() => toggleField(sig.key)}
                  className="w-5 h-5 accent-red-600 rounded"
                />
              </div>
            ))}
          </div>

          {/* Explicit Native Capacitor Android Power Button Documentation */}
          <div className="rounded-2xl surface-well p-4 space-y-2 text-xs text-slate-600">
            <div className="flex items-center justify-between font-semibold text-slate-900">
              <span className="flex items-center gap-1.5">
                <Code2 className="w-4 h-4 text-red-600" />
                <span>Capacitor Native Android Power-Button Bridge</span>
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                {TriggerService.isNativePowerPluginConnected()
                  ? 'Native Plugin Active'
                  : 'Web Fallback Mode'}
              </span>
            </div>
            <p className="leading-relaxed">
              Web browsers cannot read hardware Power-button presses directly.{' '}
              <code className="font-mono text-[11px] bg-white px-1 py-0.5 rounded border border-slate-200 text-red-700">
                src/services/TriggerService.ts
              </code>{' '}
              already exposes{' '}
              <code className="font-mono text-[11px] bg-white px-1 py-0.5 rounded border border-slate-200 text-red-700">
                Capacitor.Plugins.SafeHerPowerButton
              </code>{' '}
              listening for{' '}
              <code className="font-mono text-[11px] bg-white px-1 py-0.5 rounded border border-slate-200 text-red-700">
                hardwarePowerMultiPress
              </code>
              . When wrapped with Capacitor on Android, an Android{' '}
              <code className="font-mono text-[11px] text-slate-900">BroadcastReceiver</code> counting 3+{' '}
              <code className="font-mono text-[11px] text-slate-900">ACTION_SCREEN_ON/OFF</code> intents fires your chosen action even from a locked pocket.
            </p>
          </div>
        </div>
      </section>

      {/* Right Column: Permissions Re-Check & SOS History Log */}
      <section className="lg:col-span-5 space-y-6">
        {/* Permissions Re-check */}
        <div className="rounded-3xl surface-white p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-red-600" />
              <h2 className="font-display text-base font-bold text-slate-900">
                Device Permissions
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setShowPermissionsWizard((s) => !s)}
              className="min-h-[40px] px-3.5 rounded-xl btn-white text-xs font-semibold"
            >
              {showPermissionsWizard ? 'Hide Wizard' : 'Check Permissions'}
            </button>
          </div>

          {showPermissionsWizard ? (
            <PermissionsWizard
              compact
              onComplete={() => setShowPermissionsWizard(false)}
            />
          ) : (
            <p className="text-xs text-slate-500 leading-relaxed">
              Verify or re-request Location, Motion Sensor (iOS), Notifications, and Haptic Vibration permissions step-by-step anytime.
            </p>
          )}
        </div>

        {/* 30-Day SOS Usage Frequency Visual Summary */}
        <SOSUsageSummaryChart sosLogs={sosLogs} />

        {/* SOS History Log */}
        <div className="rounded-3xl surface-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-red-600" />
              <h2 className="font-display text-base font-bold text-slate-900">
                SOS History Log
              </h2>
            </div>
            {sosLogs.length > 0 && (
              <button
                type="button"
                onClick={onClearLogs}
                className="min-h-[38px] px-2.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-red-700 flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
          </div>

          {sosLogs.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No SOS alerts recorded on this device.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 max-h-[420px] overflow-y-auto">
              {sosLogs.map((log) => (
                <div key={log.id} className="p-4 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{log.triggerSource}</span>
                    <span className="font-mono text-slate-500 tabular-nums">
                      {new Date(log.timestamp).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="text-slate-600">
                    <span>
                      {log.alertChannel === 'online-live'
                        ? `Live alert sent (${log.contactsCount} contacts)`
                        : log.alertChannel === 'offline-sms'
                          ? `Offline SMS composer (${log.contactsCount} contacts)`
                          : 'Triggered with 0 personal contacts'}
                    </span>
                    {log.lat !== null && log.lng !== null && (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono tabular-nums">
                          {log.lat.toFixed(4)}, {log.lng.toFixed(4)}
                        </span>
                      </>
                    )}
                  </div>

                  {log.mapsUrl && (
                    <div>
                      <a
                        href={log.mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-red-600 hover:text-red-700 hover:underline"
                      >
                        <span>Open Recorded GPS Pin</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
