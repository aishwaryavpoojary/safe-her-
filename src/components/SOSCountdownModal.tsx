import React, {useEffect, useState} from 'react';
import {AlertTriangle, X} from 'lucide-react';
import {AudioService} from '../services/AudioService';
import type {TriggerSource} from '../types/safety';

interface SOSCountdownModalProps {
  triggerSource: TriggerSource;
  onCancel: () => void;
  onConfirmTrigger: () => void;
}

export const SOSCountdownModal: React.FC<SOSCountdownModalProps> = ({
  triggerSource,
  onCancel,
  onConfirmTrigger,
}) => {
  const [secondsLeft, setSecondsLeft] = useState<number>(5);

  useEffect(() => {
    AudioService.playCountdownBeep(5);

    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        AudioService.playCountdownBeep(prev - 1);
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (secondsLeft === 0) {
      onConfirmTrigger();
    }
  }, [secondsLeft, onConfirmTrigger]);

  return (
    <div
      className="fixed inset-0 z-50 bg-white/95 backdrop-blur-xl text-slate-900 flex flex-col justify-between p-6 select-none"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="sos-countdown-heading"
    >
      {/* Top Info */}
      <div className="pt-4 text-center space-y-1">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-red-700">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <span>{triggerSource}</span>
        </div>
        <h2 id="sos-countdown-heading" className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Sending Emergency SOS
        </h2>
        <p className="text-sm text-slate-600 max-w-xs mx-auto">
          Siren, automated live GPS stream, and alerts to all saved contacts will start automatically.
        </p>
      </div>

      {/* Center Giant Crimson Orb Countdown */}
      <div className="my-auto flex flex-col items-center justify-center">
        <div className="w-44 h-44 rounded-full sos-red-orb flex items-center justify-center">
          <span className="font-mono text-7xl font-bold text-white tabular-nums drop-shadow">
            {secondsLeft}
          </span>
        </div>
      </div>

      {/* Bottom One-Handed Thumb Actions */}
      <div className="space-y-3 max-w-md w-full mx-auto pb-4">
        <button
          type="button"
          onClick={onConfirmTrigger}
          className="w-full min-h-[52px] rounded-2xl btn-red text-white text-base font-bold active:scale-[0.99] transition-all"
        >
          Trigger SOS Immediately
        </button>

        <button
          type="button"
          onClick={onCancel}
          className="w-full min-h-[60px] rounded-2xl bg-slate-900 text-white text-lg font-bold hover:bg-slate-800 active:scale-[0.99] transition-all flex items-center justify-center gap-2 shadow-xl"
        >
          <X className="w-5 h-5" />
          <span>Cancel Alert</span>
        </button>
      </div>
    </div>
  );
};
