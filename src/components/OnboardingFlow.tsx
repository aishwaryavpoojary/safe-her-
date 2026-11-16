import React, {useState} from 'react';
import {Lock, Plus, Shield, Trash2, UserPlus} from 'lucide-react';
import {BUILT_IN_HELPLINES} from '../services/StorageService';
import type {AppSettings, EmergencyContact} from '../types/safety';
import {PermissionsWizard} from './PermissionsWizard';

interface OnboardingFlowProps {
  initialSettings: AppSettings;
  initialTrustedContacts: EmergencyContact[];
  onFinish: (settings: AppSettings, trustedContacts: EmergencyContact[]) => void;
}

const RELATIONSHIPS = ['Mom', 'Dad', 'Sister', 'Partner', 'Best Friend', 'Roommate', 'Brother', 'Other'];

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  initialSettings,
  initialTrustedContacts,
  onFinish,
}) => {
  const [stage, setStage] = useState<1 | 2 | 3>(1);
  const [userName, setUserName] = useState(initialSettings.userName || '');
  const [sosPin, setSosPin] = useState(initialSettings.sosPin || '1234');
  const [contacts, setContacts] = useState<EmergencyContact[]>(initialTrustedContacts);

  const [draftName, setDraftName] = useState('');
  const [draftPhone, setDraftPhone] = useState('');
  const [draftRel, setDraftRel] = useState('Mom');
  const [formError, setFormError] = useState('');

  const handleStage1Next = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) {
      setFormError('Please enter your name so contacts recognize your emergency SMS.');
      return;
    }
    if (!/^\d{4}$/.test(sosPin)) {
      setFormError('Please choose a 4-digit numeric PIN to protect the Stop SOS button.');
      return;
    }
    setFormError('');
    setStage(2);
  };

  const addDraftContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (contacts.length >= 10) {
      setFormError('You can save up to 10 trusted personal contacts.');
      return;
    }
    const cleanPhone = draftPhone.trim();
    if (!draftName.trim() || cleanPhone.replace(/\D/g, '').length < 7) {
      setFormError('Enter both a name and a valid phone number (at least 7 digits).');
      return;
    }
    const next: EmergencyContact = {
      id: `ct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: draftName.trim(),
      phone: cleanPhone,
      relationship: draftRel,
      builtIn: false,
    };
    setContacts((prev) => [...prev, next]);
    setDraftName('');
    setDraftPhone('');
    setFormError('');
  };

  const removeContact = (id: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== id));
  };

  const populateSampleContacts = () => {
    const samples: EmergencyContact[] = [
      {
        id: 'ct_sample_1',
        name: 'Meera Sharma',
        phone: '+91 98201 34011',
        relationship: 'Mom',
        builtIn: false,
      },
      {
        id: 'ct_sample_2',
        name: 'Ananya Sharma',
        phone: '+91 98201 77829',
        relationship: 'Sister',
        builtIn: false,
      },
      {
        id: 'ct_sample_3',
        name: 'Riya Nair',
        phone: '+91 98112 65094',
        relationship: 'Roommate',
        builtIn: false,
      },
    ];
    setContacts(samples);
    setFormError('');
  };

  const handleStage2Next = () => {
    if (contacts.length < 3) {
      setFormError('Please add at least 3 trusted contacts (up to 10) before continuing.');
      return;
    }
    setFormError('');
    setStage(3);
  };

  const completeAll = () => {
    onFinish(
      {
        ...initialSettings,
        userName: userName.trim(),
        sosPin,
        onboarded: true,
      },
      contacts,
    );
  };

  return (
    <div className="min-h-screen text-slate-900 flex flex-col justify-between">
      {/* Compact Crisp White Header */}
      <header className="bg-white/95 backdrop-blur-xl border-b border-red-200 text-slate-900 px-5 py-4">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl btn-red flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight text-red-700">Safe Her</span>
          </div>
          <span className="text-xs text-red-700 font-semibold font-mono tabular-nums">
            Step {stage} / 3
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 px-4 py-6 max-w-xl w-full mx-auto">
        {stage === 1 && (
          <form onSubmit={handleStage1Next} className="space-y-6">
            <div>
              <h1
                className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight"
                style={{textWrap: 'balance'}}
              >
                Personal Safety Setup
              </h1>
              <p className="text-sm text-slate-600 mt-1.5 leading-relaxed">
                Everything you enter is stored locally on your phone so SOS alerts, sirens, and emergency SMS work even without internet.
              </p>
            </div>

            <div className="rounded-3xl surface-white p-5 space-y-4">
              <div>
                <label
                  htmlFor="onboard-name"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  Your Full Name
                </label>
                <input
                  id="onboard-name"
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="e.g., Kavya Rao"
                  className="w-full min-h-[48px] px-4 rounded-xl surface-input text-base"
                  autoComplete="name"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Included automatically in emergency SMS and live tracking alerts.
                </p>
              </div>

              <div>
                <label
                  htmlFor="onboard-pin"
                  className="block text-sm font-semibold text-slate-800 mb-1.5"
                >
                  4-Digit SOS Stop PIN
                </label>
                <input
                  id="onboard-pin"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={sosPin}
                  onChange={(e) => setSosPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  placeholder="1234"
                  className="w-full min-h-[48px] px-4 rounded-xl surface-input font-mono text-lg tracking-widest tabular-nums"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Prevents anyone else from silencing your siren or canceling an active SOS.
                </p>
              </div>
            </div>

            {formError && (
              <p className="text-sm text-red-900 surface-red rounded-xl px-4 py-3">
                {formError}
              </p>
            )}

            <button
              type="submit"
              className="w-full min-h-[52px] rounded-2xl btn-red text-base font-semibold active:scale-[0.99] transition-all"
            >
              Continue to Trusted Contacts
            </button>
          </form>
        )}

        {stage === 2 && (
          <div className="space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1
                  className="font-display text-2xl font-bold text-slate-900 tracking-tight"
                  style={{textWrap: 'balance'}}
                >
                  Trusted Emergency Circle
                </h1>
                <p className="text-sm text-slate-600 mt-1">
                  Add at least 3 trusted contacts (up to 10). During SOS, all saved contacts receive your live GPS location automatically.
                </p>
              </div>
              <span className="font-mono text-sm font-semibold text-red-700 shrink-0 tabular-nums">
                {contacts.length}/10
              </span>
            </div>

            {/* Built-in Permanent Helplines */}
            <div className="rounded-3xl surface-red divide-y divide-red-200/70 max-h-48 overflow-y-auto">
              {BUILT_IN_HELPLINES.map((h) => (
                <div key={h.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{h.name}</div>
                    <div className="text-xs text-slate-600">
                      <span>{h.relationship}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="font-mono font-semibold text-red-700 tabular-nums">
                        {h.phone}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-red-700">
                    <Lock className="w-3.5 h-3.5 text-red-600" />
                    <span>Built-in</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Add Contact Form */}
            {contacts.length < 10 && (
              <form
                onSubmit={addDraftContact}
                className="rounded-3xl surface-white p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                    <UserPlus className="w-4 h-4 text-red-600" />
                    <span>Add Trusted Contact</span>
                  </h2>
                  {contacts.length === 0 && (
                    <button
                      type="button"
                      onClick={populateSampleContacts}
                      className="text-xs font-semibold text-red-700 underline hover:text-red-800"
                    >
                      Quick-fill 3 sample contacts
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Contact name"
                    className="min-h-[46px] px-3.5 rounded-xl surface-input text-sm"
                  />
                  <input
                    type="tel"
                    value={draftPhone}
                    onChange={(e) => setDraftPhone(e.target.value)}
                    placeholder="Phone number (e.g. +91 98201...)"
                    className="min-h-[46px] px-3.5 rounded-xl surface-input text-sm font-mono"
                  />
                </div>

                <div className="flex items-center gap-2.5">
                  <select
                    value={draftRel}
                    onChange={(e) => setDraftRel(e.target.value)}
                    aria-label="Relationship"
                    className="flex-1 min-h-[46px] px-3.5 rounded-xl surface-input text-sm"
                  >
                    {RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="min-h-[46px] px-4 rounded-xl btn-red text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add Contact</span>
                  </button>
                </div>
              </form>
            )}

            {/* Added Personal Contacts */}
            {contacts.length > 0 && (
              <div className="rounded-3xl surface-white divide-y divide-slate-200">
                {contacts.map((c) => (
                  <div key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">{c.name}</div>
                      <div className="text-xs text-slate-500">
                        <span>{c.relationship}</span>
                        <span aria-hidden="true"> · </span>
                        <span className="font-mono tabular-nums">{c.phone}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeContact(c.id)}
                      className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:text-red-700 hover:bg-red-50 transition-colors"
                      aria-label={`Remove ${c.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {formError && (
              <p className="text-sm text-red-900 surface-red rounded-xl px-4 py-3">
                {formError}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setStage(1)}
                className="min-h-[52px] px-5 rounded-2xl btn-white text-sm font-semibold"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleStage2Next}
                className="flex-1 min-h-[52px] rounded-2xl btn-red text-base font-semibold transition-all"
              >
                Continue ({contacts.length}/3 min)
              </button>
            </div>
          </div>
        )}

        {stage === 3 && (
          <div className="space-y-5">
            <div>
              <h1
                className="font-display text-2xl font-bold text-slate-900 tracking-tight"
                style={{textWrap: 'balance'}}
              >
                Safety Sensor Permissions
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                Walk through each capability below so GPS tracking, Shake-to-Alert, and offline alarms are ready before an emergency.
              </p>
            </div>

            <PermissionsWizard onComplete={completeAll} />

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={() => setStage(2)}
                className="min-h-[44px] px-4 text-sm font-semibold text-slate-600 hover:text-slate-900"
              >
                Back to Contacts
              </button>
              <button
                type="button"
                onClick={completeAll}
                className="min-h-[44px] px-4 text-sm font-semibold text-red-700 hover:text-red-800 hover:underline"
              >
                Skip &amp; Enter Safe Her
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
