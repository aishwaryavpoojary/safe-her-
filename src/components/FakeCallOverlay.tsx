import React, {useEffect, useState} from 'react';
import {
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Volume2,
} from 'lucide-react';
import {AudioService} from '../services/AudioService';
import type {EmergencyContact, FakeCallConfig} from '../types/safety';

interface FakeCallOverlayProps {
  config: FakeCallConfig;
  contacts: EmergencyContact[];
  onEndCall: () => void;
  onEscalateSOS: () => void;
}

export const FakeCallOverlay: React.FC<FakeCallOverlayProps> = ({
  config,
  contacts,
  onEndCall,
  onEscalateSOS,
}) => {
  const [phase, setPhase] = useState<'incoming' | 'connected'>('incoming');
  const [callSeconds, setCallSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [lineIndex, setLineIndex] = useState(0);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [contactsExpanded, setContactsExpanded] = useState(true);

  // Start offline ringtone + vibration during incoming call phase
  useEffect(() => {
    if (phase === 'incoming') {
      AudioService.startRingtone(config.ringtone, true);
    } else {
      AudioService.stopRingtone();
    }
    return () => {
      AudioService.stopRingtone();
      AudioService.stopSpeech();
    };
  }, [phase, config.ringtone]);

  // Connected timer + initial spoken voice greeting
  useEffect(() => {
    if (phase !== 'connected') return;

    const timer = window.setInterval(() => {
      setCallSeconds((s) => s + 1);
    }, 1000);

    // Speak first prerecorded-style line after short realistic pickup pause
    const initialVoiceTimeout = window.setTimeout(() => {
      playVoiceLine(0);
    }, 650);

    return () => {
      clearInterval(timer);
      clearTimeout(initialVoiceTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const playVoiceLine = (idx: number) => {
    setIsSpeaking(true);
    const spoken = AudioService.speakCallerLine(config.preset, idx, () => {
      setIsSpeaking(false);
    });
    setCurrentTranscript(spoken);
    setLineIndex(idx);
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const initials = config.callerName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="fixed inset-0 z-50 bg-white text-slate-900 flex flex-col justify-between overflow-y-auto select-none">
      {/* Top Caller Identity */}
      <div className="pt-8 px-6 text-center space-y-2">
        <div className="w-20 h-20 rounded-full btn-red mx-auto flex items-center justify-center font-display text-2xl font-bold text-white shadow-lg">
          {initials || 'SH'}
        </div>
        <h2 className="font-display text-3xl font-bold tracking-tight text-slate-900">
          {config.callerName}
        </h2>
        <p className="text-sm text-slate-500 font-mono tabular-nums">
          {phase === 'incoming'
            ? `${config.callerPhone} · Incoming mobile call...`
            : `${formatDuration(callSeconds)} · HD Voice`}
        </p>
      </div>

      {/* Middle Call Controls & Offline Voice Prompt */}
      <div className="max-w-md w-full mx-auto px-5 my-4 space-y-4">
        {phase === 'connected' && (
          <div className="rounded-3xl surface-white p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-600">
              <span>{isSpeaking ? 'Caller speaking...' : 'Caller on the line'}</span>
              <button
                type="button"
                onClick={() => playVoiceLine(lineIndex + 1)}
                className="min-h-[36px] px-3 rounded-lg btn-red font-semibold transition-all"
              >
                Play Next Voice Reply
              </button>
            </div>
            {currentTranscript && (
              <p className="text-xs text-slate-700 leading-relaxed italic">
                “{currentTranscript}”
              </p>
            )}

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                className={`min-h-[46px] rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  muted ? 'bg-slate-900 text-white' : 'btn-white'
                }`}
              >
                {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                <span>{muted ? 'Muted' : 'Mute Mic'}</span>
              </button>
              <button
                type="button"
                onClick={() => setSpeakerOn((s) => !s)}
                className={`min-h-[46px] rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  speakerOn ? 'bg-slate-900 text-white' : 'btn-white'
                }`}
              >
                <Volume2 className="w-4 h-4" />
                <span>{speakerOn ? 'Speaker On' : 'Earpiece'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Persistent Emergency Info Card (Always reachable during Fake Call) */}
        <div className="rounded-3xl surface-red overflow-hidden">
          <button
            type="button"
            onClick={() => setContactsExpanded((e) => !e)}
            className="w-full min-h-[48px] px-4 py-3 flex items-center justify-between text-left"
          >
            <div>
              <div className="text-xs font-bold text-slate-900">Emergency Info &amp; Real Contacts</div>
              <div className="text-[11px] text-slate-600">
                One-tap real calls or escalate to SOS anytime
              </div>
            </div>
            {contactsExpanded ? (
              <ChevronDown className="w-4 h-4 text-red-700" />
            ) : (
              <ChevronUp className="w-4 h-4 text-red-700" />
            )}
          </button>

          {contactsExpanded && (
            <div className="px-4 pb-4 space-y-2.5 border-t border-red-200 pt-3">
              <div className="max-h-40 overflow-y-auto divide-y divide-red-200/70">
                {contacts.map((c) => (
                  <div
                    key={c.id}
                    className="py-2 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">{c.name}</div>
                      <div className="text-slate-600">
                        <span>{c.relationship}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono tabular-nums">{c.phone}</span>
                      </div>
                    </div>
                    <a
                      href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}
                      className="min-h-[40px] px-3.5 rounded-xl btn-white font-semibold flex items-center gap-1.5 shrink-0"
                    >
                      <Phone className="w-3.5 h-3.5" />
                      <span>Call</span>
                    </a>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => {
                  AudioService.stopRingtone();
                  AudioService.stopSpeech();
                  onEscalateSOS();
                }}
                className="w-full min-h-[46px] rounded-xl btn-red text-xs font-bold flex items-center justify-center gap-2 transition-all"
              >
                <AlertOctagon className="w-4 h-4" />
                <span>Trigger Real SOS Alert Now</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Thumb-Zone Call Action Buttons */}
      <div className="max-w-md w-full mx-auto px-6 pb-8 pt-2">
        {phase === 'incoming' ? (
          <div className="grid grid-cols-2 gap-6">
            <button
              type="button"
              onClick={() => {
                AudioService.stopRingtone();
                onEndCall();
              }}
              className="min-h-[64px] rounded-full btn-red active:scale-[0.98] font-bold text-base flex items-center justify-center gap-2.5 shadow-lg transition-all"
            >
              <PhoneOff className="w-5 h-5" />
              <span>Decline</span>
            </button>

            <button
              type="button"
              onClick={() => setPhase('connected')}
              className="min-h-[64px] rounded-full bg-emerald-600 hover:bg-emerald-700 border border-emerald-700 active:scale-[0.98] text-white font-bold text-base flex items-center justify-center gap-2.5 shadow-lg transition-all"
            >
              <Phone className="w-5 h-5" />
              <span>Accept</span>
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              AudioService.stopSpeech();
              onEndCall();
            }}
            className="w-full min-h-[60px] rounded-full btn-red active:scale-[0.98] font-bold text-base flex items-center justify-center gap-2.5 shadow-lg transition-all"
          >
            <PhoneOff className="w-5 h-5" />
            <span>End Call</span>
          </button>
        )}
      </div>
    </div>
  );
};
