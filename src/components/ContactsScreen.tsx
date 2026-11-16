import React, {useState} from 'react';
import {
  Check,
  Copy,
  Edit2,
  ExternalLink,
  Lock,
  MessageSquare,
  PhoneCall,
  Plus,
  Radio,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import {LocationService} from '../services/LocationService';
import {SmsAlertService} from '../services/SmsAlertService';
import type {CachedCoordinates, EmergencyContact} from '../types/safety';

interface ContactsScreenProps {
  userName: string;
  allContacts: EmergencyContact[];
  coords: CachedCoordinates | null;
  onSaveTrustedContacts: (contacts: EmergencyContact[]) => void;
}

const RELATIONSHIPS = ['Mom', 'Dad', 'Sister', 'Partner', 'Best Friend', 'Roommate', 'Brother', 'Colleague', 'Other'];

export const ContactsScreen: React.FC<ContactsScreenProps> = ({
  userName,
  allContacts,
  coords,
  onSaveTrustedContacts,
}) => {
  const builtInContacts = allContacts.filter((c) => c.builtIn);
  const trustedContacts = allContacts.filter((c) => !c.builtIn);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('Mom');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRel, setEditRel] = useState('Mom');
  const [error, setError] = useState('');
  const [copiedGuardianId, setCopiedGuardianId] = useState<string | null>(null);
  const [helplineFilter, setHelplineFilter] = useState<
    'all' | 'women' | 'emergency' | 'medical' | 'other'
  >('all');

  const filteredHelplines = builtInContacts.filter((h) => {
    if (helplineFilter === 'all') return true;
    if (helplineFilter === 'other') {
      return h.helplineCategory === 'cyber' || h.helplineCategory === 'transit';
    }
    return h.helplineCategory === helplineFilter;
  });

  const handleAddContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (trustedContacts.length >= 10) {
      setError('Maximum of 10 trusted personal contacts reached.');
      return;
    }
    if (!name.trim() || phone.replace(/\D/g, '').length < 7) {
      setError('Please enter both a contact name and a valid phone number.');
      return;
    }

    const created: EmergencyContact = {
      id: `ct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      guardianId: `grd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      phone: phone.trim(),
      relationship,
      builtIn: false,
    };

    onSaveTrustedContacts([...trustedContacts, created]);
    setName('');
    setPhone('');
    setError('');
  };

  const startEditing = (c: EmergencyContact) => {
    setEditingId(c.id);
    setEditName(c.name);
    setEditPhone(c.phone);
    setEditRel(c.relationship);
    setError('');
  };

  const saveEdit = (id: string) => {
    if (!editName.trim() || editPhone.replace(/\D/g, '').length < 7) {
      setError('Contact name and valid phone number are required.');
      return;
    }
    const updated = trustedContacts.map((c) =>
      c.id === id
        ? {
            ...c,
            name: editName.trim(),
            phone: editPhone.trim(),
            relationship: editRel,
          }
        : c,
    );
    onSaveTrustedContacts(updated);
    setEditingId(null);
    setError('');
  };

  const deleteContact = (id: string) => {
    onSaveTrustedContacts(trustedContacts.filter((c) => c.id !== id));
  };

  const copyGuardianWatchLink = async (contact: EmergencyContact) => {
    if (!contact.guardianId) return;
    const url = LocationService.buildGuardianWatchUrl(contact.guardianId);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedGuardianId(contact.id);
      window.setTimeout(() => setCopiedGuardianId(null), 2200);
    } catch {
      // Ignore clipboard restriction
    }
  };

  const buildCheckInSms = (contact: EmergencyContact) => {
    const mapPin = SmsAlertService.buildGoogleMapsLink(coords);
    const body = mapPin
      ? `Hi ${contact.name}, this is ${userName || 'me'} checking in from Safe Her. My current GPS pin: ${mapPin}`
      : `Hi ${contact.name}, this is ${userName || 'me'} checking in from Safe Her.`;
    return `sms:${contact.phone.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left / Main List: Trusted Circle + Built-in Helplines */}
      <section className="lg:col-span-7 space-y-6">
        <div>
          <p className="text-xs text-slate-500">
            <span>{trustedContacts.length} of 10 personal contacts</span>
            <span aria-hidden="true"> · </span>
            <span className="text-red-600 font-medium">Zero-Prompt Auto-Share Ready</span>
          </p>
          <h1 className="font-display text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
            Emergency Contacts
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            When SOS activates, Safe Her streams your live GPS location automatically to every saved contact without asking you to press Send. Share each contact&apos;s 1-time Guardian Watch link once so their phone opens your live map automatically.
          </p>
        </div>

        {trustedContacts.length < 3 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            Add at least <strong className="font-semibold text-amber-950">3 trusted contacts</strong>{' '}
            (currently{' '}
            <span className="font-mono font-bold text-amber-800 tabular-nums">
              {trustedContacts.length}
            </span>
            ) for reliable coverage if one phone is unreachable.
          </div>
        )}

        {/* Personal Trusted Contacts List */}
        <div className="rounded-3xl surface-white overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">Trusted Personal Contacts</h2>
            <span className="text-xs font-mono text-slate-500 tabular-nums">
              {trustedContacts.length}/10
            </span>
          </div>

          {trustedContacts.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              No personal emergency contacts saved yet. Add 3+ trusted family members or friends.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {trustedContacts.map((c) => {
                const guardianUrl = c.guardianId
                  ? LocationService.buildGuardianWatchUrl(c.guardianId)
                  : null;

                return (
                  <div key={c.id} className="p-4 sm:px-5">
                    {editingId === c.id ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="min-h-[44px] px-3 rounded-xl surface-input text-sm"
                            placeholder="Name"
                          />
                          <input
                            type="tel"
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                            className="min-h-[44px] px-3 rounded-xl surface-input text-sm font-mono"
                            placeholder="Phone"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={editRel}
                            onChange={(e) => setEditRel(e.target.value)}
                            className="flex-1 min-h-[44px] px-3 rounded-xl surface-input text-sm"
                          >
                            {RELATIONSHIPS.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => saveEdit(c.id)}
                            className="min-h-[44px] px-4 rounded-xl btn-red text-white text-xs font-semibold flex items-center gap-1"
                          >
                            <Check className="w-4 h-4" />
                            <span>Save</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="min-h-[44px] min-w-[44px] rounded-xl btn-white flex items-center justify-center"
                            aria-label="Cancel edit"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-base font-semibold text-slate-900 truncate">
                              {c.name}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              <span>{c.relationship}</span>
                              <span aria-hidden="true"> · </span>
                              <span className="font-mono text-slate-700 tabular-nums">
                                {c.phone}
                              </span>
                              <span aria-hidden="true"> · </span>
                              <span className="text-emerald-700 font-medium">Auto-SOS Push</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <a
                              href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}
                              className="min-h-[44px] min-w-[44px] rounded-xl btn-red text-white flex items-center justify-center transition-all"
                              aria-label={`Call ${c.name}`}
                            >
                              <PhoneCall className="w-4 h-4" />
                            </a>
                            <a
                              href={buildCheckInSms(c)}
                              className="min-h-[44px] min-w-[44px] rounded-xl btn-white flex items-center justify-center transition-colors"
                              aria-label={`Send GPS check-in SMS to ${c.name}`}
                            >
                              <MessageSquare className="w-4 h-4" />
                            </a>
                            <button
                              type="button"
                              onClick={() => startEditing(c)}
                              className="min-h-[44px] min-w-[44px] rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 flex items-center justify-center transition-colors"
                              aria-label={`Edit ${c.name}`}
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteContact(c.id)}
                              className="min-h-[44px] min-w-[44px] rounded-xl text-slate-500 hover:text-red-700 hover:bg-red-50 flex items-center justify-center transition-colors"
                              aria-label={`Delete ${c.name}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {guardianUrl && (
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200 text-xs">
                            <span className="text-slate-600 flex items-center gap-1.5">
                              <Radio className="w-3.5 h-3.5 text-red-600 shrink-0" />
                              <span>1-time Guardian Watch receiver link</span>
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void copyGuardianWatchLink(c)}
                                className="min-h-[38px] px-3 rounded-xl btn-white font-semibold flex items-center gap-1.5 whitespace-nowrap"
                              >
                                {copiedGuardianId === c.id ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                    <span>Copied</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copy Receiver Link</span>
                                  </>
                                )}
                              </button>
                              <a
                                href={guardianUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="min-h-[38px] px-3 rounded-xl btn-red font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
                              >
                                <span>Test Receiver</span>
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Built-in Permanent National Helplines — Soft Rose-White Crimson Accent Card */}
        <div className="rounded-3xl surface-red overflow-hidden">
          <div className="px-5 py-3.5 border-b border-red-200 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                Built-In National Helplines ({builtInContacts.length})
              </h2>
              <span className="text-xs text-red-700 flex items-center gap-1 font-medium">
                <Lock className="w-3.5 h-3.5" />
                <span>Permanent Offline</span>
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  {id: 'all', label: 'All'},
                  {id: 'women', label: 'Women'},
                  {id: 'emergency', label: 'Police & 112'},
                  {id: 'medical', label: 'Medical'},
                  {id: 'other', label: 'Cyber & Transit'},
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setHelplineFilter(tab.id)}
                  className={`min-h-[36px] px-3 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                    helplineFilter === tab.id
                      ? 'btn-red text-white'
                      : 'btn-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-red-200/70">
            {filteredHelplines.map((h) => (
              <div key={h.id} className="p-4 sm:px-5 flex items-center justify-between gap-4">
                <div>
                  <div className="text-base font-semibold text-slate-900">{h.name}</div>
                  <div className="text-xs text-slate-600 mt-0.5">
                    <span>{h.description || h.relationship}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono font-bold text-red-700 tabular-nums">
                      {h.phone}
                    </span>
                  </div>
                </div>
                <a
                  href={`tel:${h.phone}`}
                  className="min-h-[44px] px-4 rounded-xl btn-red text-white text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-all"
                >
                  <PhoneCall className="w-4 h-4" />
                  <span>Call {h.phone}</span>
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Right Column: Add New Trusted Contact Form */}
      <section className="lg:col-span-5">
        <form
          onSubmit={handleAddContact}
          className="rounded-3xl surface-white p-5 sm:p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-red-600" />
            <h2 className="font-display text-lg font-bold text-slate-900">
              Add Trusted Contact
            </h2>
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            Saved offline on this device (up to 10 contacts). Include country code (e.g. +91) if you travel across regions.
          </p>

          <div>
            <label htmlFor="contact-name" className="block text-xs font-semibold text-slate-700 mb-1">
              Full Name
            </label>
            <input
              id="contact-name"
              type="text"
              disabled={trustedContacts.length >= 10}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Meera Sharma"
              className="w-full min-h-[48px] px-3.5 rounded-xl surface-input text-sm disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="contact-phone" className="block text-xs font-semibold text-slate-700 mb-1">
              Mobile Number
            </label>
            <input
              id="contact-phone"
              type="tel"
              disabled={trustedContacts.length >= 10}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91 98201 34011"
              className="w-full min-h-[48px] px-3.5 rounded-xl surface-input text-sm font-mono disabled:opacity-50"
            />
          </div>

          <div>
            <label htmlFor="contact-rel" className="block text-xs font-semibold text-slate-700 mb-1">
              Relationship
            </label>
            <select
              id="contact-rel"
              disabled={trustedContacts.length >= 10}
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              className="w-full min-h-[48px] px-3.5 rounded-xl surface-input text-sm disabled:opacity-50"
            >
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={trustedContacts.length >= 10}
            className="w-full min-h-[50px] rounded-2xl btn-red disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>
              {trustedContacts.length >= 10
                ? '10 Trusted Contacts Saved (Max)'
                : 'Save Trusted Contact'}
            </span>
          </button>
        </form>
      </section>
    </div>
  );
};
