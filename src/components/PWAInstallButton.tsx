import React, {useState} from 'react';
import {Download, Share, Smartphone, X} from 'lucide-react';
import {usePWAInstall} from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({variant = 'header'}) => {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      {variant === 'header' ? (
        <button
          type="button"
          onClick={handleAction}
          className="min-h-[40px] px-3.5 py-2 rounded-xl btn-red text-white text-xs font-semibold active:scale-[0.98] transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>{isIOS ? 'Install on iOS' : 'Install App'}</span>
        </button>
      ) : (
        <div className="rounded-2xl surface-red p-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">
              Install Safe Her on Home Screen
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              Launch in one tap without browser bars and access offline SOS tools instantly.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAction}
            className="min-h-[44px] px-4 py-2.5 rounded-xl btn-red text-white text-xs font-semibold active:scale-[0.98] transition-all flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Smartphone className="w-4 h-4" />
            <span>Install</span>
          </button>
        </div>
      )}

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
        >
          <div className="w-full max-w-sm rounded-3xl surface-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <h3 id="pwa-install-guide-title" className="text-lg font-bold text-slate-900">
                {isIOS ? 'Add Safe Her to iPhone' : 'Install Safe Her App'}
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[44px] min-w-[44px] -mt-2 -mr-2 flex items-center justify-center rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                aria-label="Close installation guide"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isIOS ? (
              <ol className="mt-3 space-y-3 text-sm text-slate-600">
                <li className="flex items-start gap-2.5">
                  <span className="font-mono font-semibold text-red-600">1.</span>
                  <span>
                    Tap the <strong className="font-semibold text-slate-900">Share</strong>{' '}
                    <Share className="inline w-4 h-4 text-red-600 -mt-0.5" /> button in Safari’s bottom bar.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono font-semibold text-red-600">2.</span>
                  <span>
                    Scroll down and tap{' '}
                    <strong className="font-semibold text-slate-900">Add to Home Screen</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="font-mono font-semibold text-red-600">3.</span>
                  <span>
                    Open Safe Her directly from your Home Screen for full-screen offline readiness.
                  </span>
                </li>
              </ol>
            ) : (
              <p className="mt-3 text-sm text-slate-600 leading-relaxed">
                Open your browser menu (three dots in Chrome or Edge) and select{' '}
                <strong className="font-semibold text-slate-900">Install app</strong> or{' '}
                <strong className="font-semibold text-slate-900">Add to Home screen</strong>. If viewing inside an embedded preview frame, open the app in a full browser tab first.
              </p>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-5 w-full min-h-[48px] rounded-xl btn-red text-white text-sm font-semibold transition-all"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
