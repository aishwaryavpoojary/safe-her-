import React, {useState} from 'react';
import {Clock, PhoneIncoming, Volume2, X} from 'lucide-react';
import {AudioService} from '../services/AudioService';
import type {
  AppSettings,
  FakeCallConfig,
  FakeCallDelay,
  FakeCallerPreset,
  RingtoneStyle,
} from '../types/safety';

interface FakeCallScreenProps {
  settings: AppSettings;
  scheduledSecondsLeft: number | null;
  onScheduleFakeCall: (config: FakeCallConfig) => void;
  onCancelSchedule: () => void;
  onUpdateSettings: (next: AppSettings) => void;
}

const PRESET_DEFAULTS: Record<Exclude<FakeCallerPreset, 'Custom'>, {name: string; phone: string}> = {
  Mom: {name: 'Mom', phone: '+91 98201 34011'},
  Dad: {name: 'Dad', phone: '+91 98201 34012'},
  Sister: {name: 'Sister', phone: '+91 98201 77829'},
  Police: {name: 'Police Patrol Dispatch', phone: '112'},
};

export const FakeCallScreen: React.FC<FakeCallScreenProps> = ({
  settings,
  scheduledSecondsLeft,
  onScheduleFakeCall,
  onCancelSchedule,
  onUpdateSettings,
}) => {
  const [preset, setPreset] = useState<FakeCallerPreset>(settings.defaultFakeCaller);
  const [customName, setCustomName] = useState(settings.customFakeCallerName);
  const [customPhone, setCustomPhone] = useState(settings.customFakeCallerPhone);
  const [ringtone, setRingtone] = useState<RingtoneStyle>(settings.defaultRingtone);
  const [delay, setDelay] = useState<FakeCallDelay>(settings.defaultFakeCallDelay);

  const handleSelectPreset = (nextPreset: FakeCallerPreset) => {
    setPreset(nextPreset);
    onUpdateSettings({
      ...settings,
      defaultFakeCaller: nextPreset,
    });
  };

  const handleSelectRingtone = (nextRingtone: RingtoneStyle) => {
    setRingtone(nextRingtone);
    onUpdateSettings({
      ...settings,
      defaultRingtone: nextRingtone,
    });
  };

  const handleSelectDelay = (nextDelay: FakeCallDelay) => {
    setDelay(nextDelay);
    onUpdateSettings({
      ...settings,
      defaultFakeCallDelay: nextDelay,
    });
  };

  const handleLaunch = () => {
    const resolvedName =
      preset === 'Custom'
        ? customName.trim() || 'Trusted Caller'
        : PRESET_DEFAULTS[preset].name;
    const resolvedPhone =
      preset === 'Custom'
        ? customPhone.trim() || '+91 98201 44120'
        : PRESET_DEFAULTS[preset].phone;

    if (preset === 'Custom') {
      onUpdateSettings({
        ...settings,
        customFakeCallerName: resolvedName,
        customFakeCallerPhone: resolvedPhone,
      });
    }

    onScheduleFakeCall({
      preset,
      callerName: resolvedName,
      callerPhone: resolvedPhone,
      ringtone,
      delaySeconds: delay,
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <section className="lg:col-span-7 rounded-3xl surface-red p-5 sm:p-6 space-y-6">
        <div>
          <p className="text-xs text-red-700 font-medium">100% Offline Audio &amp; Voice Synthesis</p>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
            Realistic Fake Call
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Simulate an incoming phone call with realistic ringtone, vibration, and spoken responses to exit uncomfortable situations safely.
          </p>
        </div>

        {/* Scheduled Countdown Notice */}
        {scheduledSecondsLeft !== null && (
          <div className="rounded-2xl surface-white p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5 text-sm text-slate-900">
              <Clock className="w-4 h-4 text-red-600 shrink-0" />
              <span>
                Ringing in{' '}
                <strong className="font-mono text-red-700 tabular-nums">
                  {scheduledSecondsLeft}s
                </strong>{' '}
                — lock or hold your phone naturally.
              </span>
            </div>
            <button
              type="button"
              onClick={onCancelSchedule}
              className="min-h-[40px] px-3 rounded-xl btn-white text-xs font-semibold flex items-center gap-1 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel</span>
            </button>
          </div>
        )}

        {/* 1. Caller Identity */}
        <div className="space-y-2.5">
          <label className="block text-xs font-bold text-slate-800">1. Choose Caller</label>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {(['Mom', 'Dad', 'Sister', 'Police', 'Custom'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => handleSelectPreset(item)}
                className={`min-h-[48px] px-3 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                  preset === item
                    ? 'btn-red text-white'
                    : 'surface-white text-slate-700 hover:bg-red-50 hover:text-red-900 hover:border-red-300'
                }`}
              >
                {item}
              </button>
            ))}
          </div>

          {preset === 'Custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Custom caller name"
                className="min-h-[46px] px-3.5 rounded-xl surface-input text-sm"
              />
              <input
                type="tel"
                value={customPhone}
                onChange={(e) => setCustomPhone(e.target.value)}
                placeholder="Displayed phone number"
                className="min-h-[46px] px-3.5 rounded-xl surface-input text-sm font-mono"
              />
            </div>
          )}
        </div>

        {/* 2. Ringtone Selection + Offline Preview */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-bold text-slate-800">2. Ringtone</label>
            <button
              type="button"
              onClick={() => AudioService.previewRingtone(ringtone)}
              className="text-xs font-semibold text-red-700 hover:underline flex items-center gap-1"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Preview Ringtone</span>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(
              [
                {id: 'classic', label: 'Classic Ring'},
                {id: 'pulse', label: 'Modern Pulse'},
                {id: 'chime', label: 'Urgent Chime'},
              ] as const
            ).map((rt) => (
              <button
                key={rt.id}
                type="button"
                onClick={() => handleSelectRingtone(rt.id)}
                className={`min-h-[48px] px-3 rounded-xl text-xs font-semibold transition-all whitespace-nowrap ${
                  ringtone === rt.id
                    ? 'btn-red text-white'
                    : 'surface-white text-slate-700 hover:bg-red-50 hover:text-red-900 hover:border-red-300'
                }`}
              >
                {rt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 3. Call Delay */}
        <div className="space-y-2.5">
          <label className="block text-xs font-bold text-slate-800">3. Ring Delay</label>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                {sec: 0, label: 'Now'},
                {sec: 10, label: '10s'},
                {sec: 30, label: '30s'},
                {sec: 60, label: '1 min'},
              ] as const
            ).map((d) => (
              <button
                key={d.sec}
                type="button"
                onClick={() => handleSelectDelay(d.sec)}
                className={`min-h-[48px] px-3 rounded-xl text-xs font-semibold transition-all whitespace-nowrap tabular-nums ${
                  delay === d.sec
                    ? 'btn-red text-white'
                    : 'surface-white text-slate-700 hover:bg-red-50 hover:text-red-900 hover:border-red-300'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={handleLaunch}
          className="w-full min-h-[54px] rounded-2xl btn-red active:scale-[0.99] text-white text-base font-bold flex items-center justify-center gap-2.5 transition-all"
        >
          <PhoneIncoming className="w-5 h-5" />
          <span>
            {delay === 0
              ? `Trigger Fake Call from ${preset === 'Custom' ? customName || 'Caller' : preset} Now`
              : `Schedule Fake Call in ${delay === 60 ? '1 min' : `${delay}s`}`}
          </span>
        </button>
      </section>

      {/* Right Column: How Fake Call Protects You */}
      <section className="lg:col-span-5 rounded-3xl surface-white p-5 sm:p-6 space-y-4">
        <h2 className="font-display text-base font-bold text-slate-900">
          What Happens During the Call
        </h2>
        <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
          <p>
            <strong className="font-semibold text-slate-900">1. Full-Screen Incoming Call:</strong>{' '}
            Your screen switches to a realistic mobile call view with synthesized ringtone and vibration—zero internet required.
          </p>
          <p>
            <strong className="font-semibold text-slate-900">2. Spoken Protective Script:</strong>{' '}
            When you tap Accept, Safe Her uses your phone’s offline SpeechSynthesis voice to say they see your live GPS pin and are two minutes away. Tap{' '}
            <em className="text-red-700 font-medium">Play Next Voice Reply</em> anytime to continue a believable two-way conversation.
          </p>
          <p>
            <strong className="font-semibold text-slate-900">3. Persistent Emergency Card:</strong>{' '}
            Your real emergency contacts, 1091, 112, and a one-tap <em className="text-red-700 font-medium">Trigger Real SOS</em> button remain right on the call screen if the situation escalates.
          </p>
        </div>
      </section>
    </div>
  );
};
