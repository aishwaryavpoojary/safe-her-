import React, {useEffect, useState} from 'react';
import {
  Bell,
  Check,
  Compass,
  MapPin,
  MessageSquare,
  Smartphone,
  Vibrate,
} from 'lucide-react';
import {AudioService} from '../services/AudioService';
import {LocationService} from '../services/LocationService';
import {ShakeService} from '../services/ShakeService';
import {SmsAlertService} from '../services/SmsAlertService';
import {StorageService} from '../services/StorageService';

type PermState = 'pending' | 'granted' | 'denied' | 'unsupported';

interface PermissionsWizardProps {
  onComplete: () => void;
  compact?: boolean;
  phoneAndSmsGranted?: boolean;
  onPhoneSmsPermissionChange?: (granted: boolean) => void;
}

export const PermissionsWizard: React.FC<PermissionsWizardProps> = ({
  onComplete,
  compact = false,
  phoneAndSmsGranted,
  onPhoneSmsPermissionChange,
}) => {
  const [step, setStep] = useState<number>(0);
  const [locState, setLocState] = useState<PermState>('pending');
  const [phoneSmsState, setPhoneSmsState] = useState<PermState>(() => {
    const initial =
      typeof phoneAndSmsGranted === 'boolean'
        ? phoneAndSmsGranted
        : StorageService.getSettings().phoneAndSmsPermissionGranted;
    return initial ? 'granted' : 'pending';
  });
  const [motionState, setMotionState] = useState<PermState>('pending');
  const [notifState, setNotifState] = useState<PermState>('pending');
  const [vibState, setVibState] = useState<PermState>('pending');
  const [statusNote, setStatusNote] = useState<string>('');

  useEffect(() => {
    // Inspect existing browser & native permission states without prompting prematurely
    if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
      navigator.permissions
        .query({name: 'geolocation'})
        .then((res) => {
          if (res.state === 'granted') setLocState('granted');
          else if (res.state === 'denied') setLocState('denied');
        })
        .catch(() => {});
    }

    const savedFlag =
      typeof phoneAndSmsGranted === 'boolean'
        ? phoneAndSmsGranted
        : StorageService.getSettings().phoneAndSmsPermissionGranted;

    void SmsAlertService.checkDefaultPhoneAndMessagesPermission(savedFlag).then((res) => {
      setPhoneSmsState(res);
    });

    if (!ShakeService.isSupported()) {
      setMotionState('unsupported');
    } else if (!ShakeService.requiresExplicitIOSPermission()) {
      setMotionState('granted');
    }

    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotifState('unsupported');
    } else if (Notification.permission === 'granted') {
      setNotifState('granted');
    } else if (Notification.permission === 'denied') {
      setNotifState('denied');
    }

    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      setVibState('unsupported');
    }
  }, [phoneAndSmsGranted]);

  const requestLocation = async () => {
    setStatusNote('Requesting GPS coordinates...');
    try {
      await LocationService.requestSingleFix(7000);
      setLocState('granted');
      setStatusNote('GPS coordinates locked and cached for offline SOS.');
    } catch (err) {
      setLocState('denied');
      setStatusNote(
        err instanceof Error
          ? err.message
          : 'Location permission denied. You can enable it later in browser settings.',
      );
    }
  };

  const requestPhoneAndMessages = async () => {
    setStatusNote('Requesting Phone & Default Messages access...');
    const res = await SmsAlertService.requestDefaultPhoneAndMessagesPermission();
    const granted = res.state === 'granted';
    setPhoneSmsState(res.state);
    setStatusNote(res.message);

    const latest = StorageService.getSettings();
    StorageService.saveSettings({
      ...latest,
      phoneAndSmsPermissionGranted: granted,
    });
    onPhoneSmsPermissionChange?.(granted);
  };

  const requestMotion = async () => {
    const res = await ShakeService.requestPermission();
    setMotionState(res);
    if (res === 'granted') {
      setStatusNote('Motion sensor active for Shake-to-Alert.');
    } else if (res === 'unsupported') {
      setStatusNote('This device does not expose motion sensors to the browser.');
    } else {
      setStatusNote('Motion access declined. Shake-to-Alert can be re-enabled in Settings.');
    }
  };

  const requestNotifications = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotifState('unsupported');
      setStatusNote('Browser notifications are not supported on this device.');
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotifState(permission === 'granted' ? 'granted' : 'denied');
      setStatusNote(
        permission === 'granted'
          ? 'Emergency confirmation alerts enabled.'
          : 'Notifications declined — visual and audio SOS alerts still work.',
      );
    } catch {
      setNotifState('denied');
    }
  };

  const testVibration = () => {
    const ok = AudioService.vibrate([180, 90, 240]);
    if (ok) {
      setVibState('granted');
      setStatusNote('Haptic vibration confirmed.');
    } else {
      setVibState('unsupported');
      setStatusNote(
        'iOS Safari and desktop browsers silence web vibration; Web Audio siren & strobe remain active.',
      );
    }
  };

  const items = [
    {
      key: 'location',
      title: '1. Live & Offline GPS Location',
      desc: 'Caches your last coordinates continuously so SOS alerts always include a Google Maps pin.',
      icon: MapPin,
      state: locState,
      actionLabel: locState === 'granted' ? 'Location Ready' : 'Enable GPS Location',
      onAction: requestLocation,
    },
    {
      key: 'phone_sms',
      title: '2. Default Phone & Messages App Access',
      desc: 'In an Android Capacitor APK or Server SMS Relay build, authorizes zero-prompt automated carrier SMS. Standard web browsers block websites from requesting OS Phone/SMS permissions directly.',
      icon: MessageSquare,
      state: phoneSmsState,
      actionLabel:
        phoneSmsState === 'granted'
          ? 'Phone & Messages Granted'
          : phoneSmsState === 'unsupported'
            ? 'Check Browser / APK Support'
            : 'Allow Phone & Messages Access',
      onAction: requestPhoneAndMessages,
    },
    {
      key: 'motion',
      title: '3. Motion Sensor (Shake-to-Alert)',
      desc: 'Detects 3 hard shakes in 2 seconds while Safe Her is open to start the SOS countdown.',
      icon: Compass,
      state: motionState,
      actionLabel:
        motionState === 'granted'
          ? 'Motion Ready'
          : motionState === 'unsupported'
            ? 'Not Supported Here'
            : 'Allow Motion Sensor',
      onAction: requestMotion,
    },
    {
      key: 'notifications',
      title: '4. Alert Notifications',
      desc: 'Shows confirmation banners during delayed Fake Calls and active live location sharing.',
      icon: Bell,
      state: notifState,
      actionLabel:
        notifState === 'granted'
          ? 'Notifications Active'
          : notifState === 'unsupported'
            ? 'Unsupported Browser'
            : 'Allow Notifications',
      onAction: requestNotifications,
    },
    {
      key: 'vibration',
      title: '5. Haptic Vibration Feedback',
      desc: 'Vibrates discreetly during SOS countdowns and incoming Fake Calls on supported phones.',
      icon: Vibrate,
      state: vibState,
      actionLabel:
        vibState === 'granted'
          ? 'Vibration Tested'
          : vibState === 'unsupported'
            ? 'Audio Fallback Active'
            : 'Test Vibration Pulse',
      onAction: testVibration,
    },
  ];

  const activeItem = items[step];
  const ActiveIcon = activeItem.icon;

  const formatStateLabel = (s: PermState, key?: string) => {
    if (s === 'granted') return 'Ready';
    if (s === 'denied') return 'Blocked';
    if (s === 'unsupported') {
      return key === 'phone_sms' ? 'Browser Restricted' : 'Fallback Ready';
    }
    return 'Not checked';
  };

  return (
    <div className={compact ? 'space-y-4' : 'space-y-5'}>
      {/* Step selector tabs */}
      <div className="grid grid-cols-5 gap-1.5 surface-well p-1 rounded-xl">
        {items.map((item, idx) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setStep(idx);
              setStatusNote('');
            }}
            className={`min-h-[44px] rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1 whitespace-nowrap ${
              step === idx
                ? 'btn-red'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="tabular-nums">{idx + 1}</span>
            {item.state === 'granted' && (
              <Check className={`w-3.5 h-3.5 ${step === idx ? 'text-white' : 'text-emerald-600'}`} />
            )}
          </button>
        ))}
      </div>

      {/* Focused step card */}
      <div className="rounded-2xl surface-white p-5 space-y-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl btn-red flex items-center justify-center shrink-0">
            <ActiveIcon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-slate-500">
              <span>Step {step + 1} of {items.length}</span>
              <span aria-hidden="true"> · </span>
              <span
                className={
                  activeItem.state === 'granted'
                    ? 'text-emerald-700 font-medium'
                    : activeItem.state === 'denied'
                      ? 'text-red-700 font-medium'
                      : activeItem.state === 'unsupported' && activeItem.key === 'phone_sms'
                        ? 'text-amber-800 font-medium'
                        : 'text-slate-500'
                }
              >
                {formatStateLabel(activeItem.state, activeItem.key)}
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-0.5">{activeItem.title}</h3>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">{activeItem.desc}</p>
          </div>
        </div>

        {statusNote && (
          <p className="text-xs text-red-900 surface-red rounded-xl px-3.5 py-2.5 leading-relaxed">
            {statusNote}
          </p>
        )}

        <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
          <button
            type="button"
            onClick={activeItem.onAction}
            className="flex-1 min-h-[48px] px-4 py-2.5 rounded-xl btn-white text-sm font-semibold active:scale-[0.99] transition-all flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <Smartphone className="w-4 h-4 shrink-0" />
            <span>{activeItem.actionLabel}</span>
          </button>

          {step < items.length - 1 ? (
            <button
              type="button"
              onClick={() => {
                setStep((s) => s + 1);
                setStatusNote('');
              }}
              className="min-h-[48px] px-5 py-2.5 rounded-xl btn-red text-sm font-semibold transition-all whitespace-nowrap"
            >
              Next Step
            </button>
          ) : (
            <button
              type="button"
              onClick={onComplete}
              className="min-h-[48px] px-5 py-2.5 rounded-xl btn-red text-sm font-semibold transition-all whitespace-nowrap"
            >
              Finish Setup
            </button>
          )}
        </div>
      </div>

      {/* Summary checklist */}
      <div className="divide-y divide-slate-200 rounded-2xl surface-white px-4">
        {items.map((item, idx) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setStep(idx);
              setStatusNote('');
            }}
            className="w-full min-h-[48px] py-2.5 flex items-center justify-between text-left text-xs"
          >
            <span className="font-medium text-slate-800">{item.title}</span>
            <span
              className={
                item.state === 'granted'
                  ? 'text-emerald-700 font-semibold'
                  : item.state === 'denied'
                    ? 'text-red-700 font-semibold'
                    : item.state === 'unsupported' && item.key === 'phone_sms'
                      ? 'text-amber-800 font-semibold'
                      : 'text-slate-500'
              }
            >
              {formatStateLabel(item.state, item.key)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

