import React, {useState} from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  MapPin,
  MessageSquare,
  Navigation,
  PhoneCall,
  PhoneIncoming,
  RefreshCw,
  Share2,
  ShieldAlert,
  Smartphone,
  Square,
} from 'lucide-react';
import {SmsAlertService} from '../services/SmsAlertService';
import type {
  AppSettings,
  CachedCoordinates,
  EmergencyContact,
  LiveShareDuration,
  LiveShareSession,
  NavTab,
  SOSLogEntry,
} from '../types/safety';
import {SOSUsageSummaryChart} from './SOSUsageSummaryChart';

interface HomeScreenProps {
  settings: AppSettings;
  contacts: EmergencyContact[];
  coords: CachedCoordinates | null;
  geoError: string;
  isOnline: boolean;
  liveSession: LiveShareSession | null;
  sosLogs: SOSLogEntry[];
  scheduledFakeCallIn: number | null;
  onStartSOSCountdown: () => void;
  onQuickFakeCallNow: () => void;
  onCancelScheduledFakeCall: () => void;
  onStartManualLiveShare: (duration: LiveShareDuration) => Promise<void>;
  onStopManualLiveShare: () => Promise<void>;
  onRefreshLocation: () => Promise<void>;
  onNavigateTab: (tab: NavTab) => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  settings,
  contacts,
  coords,
  geoError,
  isOnline,
  liveSession,
  sosLogs,
  scheduledFakeCallIn,
  onStartSOSCountdown,
  onQuickFakeCallNow,
  onCancelScheduledFakeCall,
  onStartManualLiveShare,
  onStopManualLiveShare,
  onRefreshLocation,
  onNavigateTab,
}) => {
  const [selectedDuration, setSelectedDuration] = useState<LiveShareDuration>(15);
  const [startingShare, setStartingShare] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [refreshingGps, setRefreshingGps] = useState(false);

  const trustedContacts = contacts.filter((c) => !c.builtIn);

  const handleStartLiveShare = async () => {
    setStartingShare(true);
    try {
      await onStartManualLiveShare(selectedDuration);
    } finally {
      setStartingShare(false);
    }
  };

  const handleCopyShareUrl = async () => {
    if (!liveSession) return;
    try {
      await navigator.clipboard.writeText(liveSession.trackingUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const handleNativeShareLiveUrl = async () => {
    if (!liveSession) return;
    const text = `${settings.userName || 'Safe Her User'} is sharing live GPS location with you: ${liveSession.trackingUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Safe Her Live Location',
          text,
          url: liveSession.trackingUrl,
        });
        return;
      } catch {
        // Fallback to copy
      }
    }
    await handleCopyShareUrl();
  };

  const handleRefreshGps = async () => {
    setRefreshingGps(true);
    try {
      await onRefreshLocation();
    } finally {
      setRefreshingGps(false);
    }
  };

  const manualSmsShareUri = liveSession
    ? SmsAlertService.buildSmsComposerUri(
        contacts,
        `${settings.userName || 'I'} shared my live Safe Her location with you: ${liveSession.trackingUrl} (Map pin: ${liveSession.mapsUrl})`,
      )
    : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Primary Column: Rose-White & Crimson SOS Focal Anchor + Quick Thumb-Zone Actions */}
      <section className="lg:col-span-7 rounded-3xl surface-red p-5 sm:p-7 flex flex-col justify-between space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-600">
              <span>{settings.userName ? `Protected: ${settings.userName}` : 'Ready'}</span>
              <span aria-hidden="true"> · </span>
              <span>{trustedContacts.length} trusted contacts</span>
              <span aria-hidden="true"> · </span>
              <span>{isOnline ? 'Online + SMS Ready' : 'Offline Cellular SMS Mode'}</span>
            </p>
            <h1
              className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mt-1"
              style={{textWrap: 'balance'}}
            >
              Emergency Protection
            </h1>
          </div>
        </div>

        {/* Warning if zero trusted contacts saved */}
        {trustedContacts.length === 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs text-amber-900">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <span>
                No personal trusted contacts saved yet. Add 3+ contacts so SOS alerts reach your circle automatically.
              </span>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('contacts')}
              className="min-h-[40px] px-3.5 rounded-xl btn-red text-white text-xs font-semibold whitespace-nowrap shrink-0"
            >
              Add Contacts
            </button>
          </div>
        )}

        {/* Scheduled Fake Call Banner */}
        {scheduledFakeCallIn !== null && (
          <div className="rounded-2xl surface-white px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-xs text-slate-800 font-medium">
              Incoming Fake Call ringing in{' '}
              <span className="font-mono font-bold text-red-700 tabular-nums">
                {scheduledFakeCallIn}s
              </span>
            </div>
            <button
              type="button"
              onClick={onCancelScheduledFakeCall}
              className="min-h-[38px] px-3 rounded-xl btn-white text-xs font-semibold"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Dominant Focal Anchor: Giant One-Tap 3D Crimson Red SOS Orb */}
        <div className="py-4 flex flex-col items-center justify-center text-center">
          <button
            type="button"
            onClick={onStartSOSCountdown}
            aria-label="Start 5-second Emergency SOS countdown"
            className="group relative w-52 h-52 sm:w-56 sm:h-56 rounded-full sos-red-orb active:scale-95 text-white transition-transform duration-150 flex flex-col items-center justify-center select-none focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-red-600"
          >
            <ShieldAlert className="w-11 h-11 mb-1.5 text-white drop-shadow" />
            <span className="font-display text-4xl font-extrabold tracking-tight drop-shadow">
              SOS
            </span>
            <span className="text-xs font-medium text-red-50 mt-1">
              Tap for 5s countdown
            </span>
          </button>

          <p className="text-xs text-slate-600 mt-5 max-w-xs leading-relaxed">
            Triggers loud offline siren, flashes screen red, and streams live GPS location automatically to all saved contacts with zero Send prompt.
          </p>
        </div>

        {/* One-Handed Natural Thumb Zone Secondary Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onQuickFakeCallNow}
            className="min-h-[54px] px-4 rounded-2xl btn-white active:scale-[0.99] text-sm font-semibold flex items-center justify-center gap-2.5 transition-all whitespace-nowrap"
          >
            <PhoneIncoming className="w-4 h-4 text-red-600 shrink-0" />
            <span>Fake Call Now ({settings.defaultFakeCaller})</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigateTab('map')}
            className="min-h-[54px] px-4 rounded-2xl btn-white active:scale-[0.99] text-sm font-semibold flex items-center justify-center gap-2.5 transition-all whitespace-nowrap"
          >
            <Navigation className="w-4 h-4 text-red-600 shrink-0" />
            <span>Nearby Police &amp; Hospitals</span>
          </button>
        </div>

        {/* Direct Built-in Helplines Row */}
        <div className="pt-3 border-t border-red-200 grid grid-cols-2 gap-3">
          <a
            href="tel:1091"
            className="min-h-[48px] px-3.5 rounded-xl btn-white flex items-center justify-between text-xs font-semibold transition-colors"
          >
            <span>Women Helpline</span>
            <span className="font-mono text-red-700 font-bold flex items-center gap-1 tabular-nums">
              <PhoneCall className="w-3.5 h-3.5 text-red-600" />
              1091
            </span>
          </a>
          <a
            href="tel:112"
            className="min-h-[48px] px-3.5 rounded-xl btn-red flex items-center justify-between text-xs font-semibold text-white transition-colors"
          >
            <span>Police Emergency</span>
            <span className="font-mono text-white font-bold flex items-center gap-1 tabular-nums">
              <PhoneCall className="w-3.5 h-3.5 text-red-100" />
              112
            </span>
          </a>
        </div>
      </section>

      {/* Secondary Column: Crisp Pure White Cards */}
      <section className="lg:col-span-5 space-y-5">
        {/* Share Live Location Card */}
        <div className="rounded-3xl surface-white p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs text-red-600 font-semibold">
                Zero-Prompt Auto-Push on SOS · Optional Walk Mode
              </div>
              <h2 className="font-display text-base font-bold text-slate-900 mt-0.5">
                Live Location Sharing
              </h2>
              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                Streams automatically every 3s to all saved contacts without asking you to press Send when SOS activates. You can also start a timed walk session below.
              </p>
            </div>
          </div>

          {!liveSession ? (
            <>
              {/* Duration Segmented Picker */}
              <div className="grid grid-cols-3 gap-1.5 surface-well p-1 rounded-xl">
                {(
                  [
                    {val: 15, label: '15 min'},
                    {val: 60, label: '1 hr'},
                    {val: 0, label: 'Until stopped'},
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => setSelectedDuration(opt.val)}
                    className={`min-h-[42px] px-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                      selectedDuration === opt.val
                        ? 'btn-red text-white'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={startingShare}
                onClick={handleStartLiveShare}
                className="w-full min-h-[48px] rounded-xl btn-red disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all"
              >
                <Share2 className="w-4 h-4" />
                <span>
                  {startingShare ? 'Starting Live GPS...' : 'Start Sharing Live Location'}
                </span>
              </button>
            </>
          ) : (
            <div className="space-y-3 pt-1">
              <div className="rounded-2xl surface-well p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900">
                    Live Map Active ({liveSession.updateCount} GPS updates)
                  </span>
                  <span className="text-red-700 font-mono tabular-nums font-semibold">
                    {liveSession.durationMinutes === 0
                      ? 'Until stopped'
                      : `${liveSession.durationMinutes}m session`}
                  </span>
                </div>
                <div className="text-xs text-emerald-700 font-medium flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {trustedContacts.length > 0
                      ? `Automatically shared with all ${trustedContacts.length} trusted contacts (zero Send prompt)`
                      : 'Live tracking stream active'}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-500 truncate">
                  {liveSession.trackingUrl}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleNativeShareLiveUrl}
                  className="min-h-[44px] px-3 rounded-xl btn-white text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  {copiedLink ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedLink ? 'Link Copied' : 'Share / Copy'}</span>
                </button>

                {manualSmsShareUri ? (
                  <a
                    href={manualSmsShareUri}
                    className="min-h-[44px] px-3 rounded-xl btn-white text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <MessageSquare className="w-4 h-4 text-red-600" />
                    <span>SMS Link</span>
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={handleCopyShareUrl}
                    className="min-h-[44px] px-3 rounded-xl btn-white text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Copy className="w-4 h-4" />
                    <span>Copy URL</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={onStopManualLiveShare}
                className="w-full min-h-[46px] rounded-xl btn-red text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Sharing Location</span>
              </button>
            </div>
          )}
        </div>

        {/* Offline GPS Cache Status Card */}
        <div className="rounded-3xl surface-white p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-red-600 shrink-0" />
              <h2 className="text-sm font-bold text-slate-900">Cached GPS Readiness</h2>
            </div>
            <button
              type="button"
              onClick={handleRefreshGps}
              className="min-h-[38px] px-3 rounded-xl btn-white text-xs font-semibold flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingGps ? 'animate-spin' : ''}`} />
              <span>Update</span>
            </button>
          </div>

          {coords ? (
            <div className="text-xs text-slate-500 space-y-1">
              <div className="font-mono font-semibold text-slate-900 tabular-nums">
                {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} (±{Math.round(coords.accuracy)}m)
              </div>
              <div className="flex items-center justify-between">
                <span>
                  Cached at{' '}
                  {new Date(coords.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
                <a
                  href={`https://maps.google.com/?q=${coords.lat},${coords.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-red-600 hover:text-red-700 hover:underline"
                >
                  <span>View Pin</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : (
            <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              {geoError ||
                'Tap Update to cache your current GPS coordinates so they remain available even if you lose internet.'}
            </p>
          )}
        </div>

        {/* 30-Day SOS Usage Frequency Summary */}
        <SOSUsageSummaryChart
          sosLogs={sosLogs}
          compact
          onViewHistory={() => onNavigateTab('settings')}
        />

        {/* Explicit Foreground Shake Notice + Panic Gesture Hint */}
        <div className="rounded-3xl surface-white p-5 space-y-2.5 text-xs text-slate-600 leading-relaxed">
          <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm">
            <Smartphone className="w-4 h-4 text-red-600 shrink-0" />
            <span>Active Triggers &amp; Browser Notice</span>
          </div>
          <p>
            <strong className="font-semibold text-slate-900">Shake-to-Alert:</strong>{' '}
            {settings.shakeEnabled
              ? `Enabled (${settings.shakeSensitivity} sensitivity — 3 hard shakes in 2s). Works only while Safe Her is open on screen, since browsers pause motion sensors in the background.`
              : 'Currently turned off in Settings.'}
          </p>
          {settings.multiPressEnabled && (
            <p>
              <strong className="font-semibold text-slate-900">Quick Panic Gesture:</strong>{' '}
              Triple-tap the Safe Her wordmark in the top bar (or press Volume keys 3x) to launch{' '}
              {settings.multiPressAction === 'sos' ? 'SOS Countdown' : 'Fake Call'}.
            </p>
          )}
          {sosLogs.length > 0 && (
            <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-slate-500">
              <span>
                Last SOS:{' '}
                {new Date(sosLogs[0].timestamp).toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <button
                type="button"
                onClick={() => onNavigateTab('settings')}
                className="font-semibold text-red-600 hover:text-red-700 hover:underline"
              >
                View History ({sosLogs.length})
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
