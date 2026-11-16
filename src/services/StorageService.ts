import type {
  AppSettings,
  CachedCoordinates,
  EmergencyContact,
  NearbyCacheBundle,
  SOSLogEntry,
} from '../types/safety';

/**
 * Built-in national women's safety & emergency helplines that are always present offline and cannot be deleted.
 */
export const BUILT_IN_HELPLINES: EmergencyContact[] = [
  {
    id: 'builtin-1091',
    name: 'Women Helpline (Police)',
    phone: '1091',
    relationship: 'Women Safety 24/7',
    builtIn: true,
    helplineCategory: 'women',
    description: '24/7 National Women in Distress Immediate Police Response',
  },
  {
    id: 'builtin-181',
    name: 'Abhayam Women Crisis Line',
    phone: '181',
    relationship: 'Women Support 24/7',
    builtIn: true,
    helplineCategory: 'women',
    description: '24/7 Domestic Abuse, Crisis Counseling & Sakhi One-Stop Center',
  },
  {
    id: 'builtin-112',
    name: 'National Emergency (ERSS)',
    phone: '112',
    relationship: 'Police & Rescue',
    builtIn: true,
    helplineCategory: 'emergency',
    description: 'All-in-One Police, Fire & Immediate Emergency Dispatch',
  },
  {
    id: 'builtin-ncw',
    name: 'NCW Women Safety Helpline',
    phone: '7827170170',
    relationship: 'NCW 24/7 Help',
    builtIn: true,
    helplineCategory: 'women',
    description: 'National Commission for Women 24/7 Legal & Distress Support',
  },
  {
    id: 'builtin-108',
    name: 'Emergency Ambulance',
    phone: '108',
    relationship: 'Medical & Trauma',
    builtIn: true,
    helplineCategory: 'medical',
    description: '24/7 Critical Care & Emergency Medical Ambulance',
  },
  {
    id: 'builtin-102',
    name: 'Maternal & Women Ambulance',
    phone: '102',
    relationship: 'Maternity Care',
    builtIn: true,
    helplineCategory: 'medical',
    description: '24/7 Free Maternal, Pregnancy & Neonatal Transport',
  },
  {
    id: 'builtin-1930',
    name: 'Cyber Crime & Stalking',
    phone: '1930',
    relationship: 'Cyber Safety',
    builtIn: true,
    helplineCategory: 'cyber',
    description: 'Report Online Harassment, Non-Consensual Imagery & Cyber Fraud',
  },
  {
    id: 'builtin-1098',
    name: 'Girl Child & Teen Helpline',
    phone: '1098',
    relationship: 'Childline 24/7',
    builtIn: true,
    helplineCategory: 'women',
    description: '24/7 Emergency Protection for Girls & Minors in Distress',
  },
  {
    id: 'builtin-139',
    name: 'Railway Women Security (RPF)',
    phone: '139',
    relationship: 'Transit Safety',
    builtIn: true,
    helplineCategory: 'transit',
    description: '24/7 Meri Saheli Train & Station Women Security Dispatch',
  },
  {
    id: 'builtin-14567',
    name: 'Senior Women Elderline',
    phone: '14567',
    relationship: 'Elder Support',
    builtIn: true,
    helplineCategory: 'women',
    description: 'National Helpline for Senior Women Facing Abuse or Distress',
  },
];

export function createFreshDefaultSettings(): AppSettings {
  return {
    userId: `usr_${Math.random().toString(36).slice(2, 10)}`,
    userName: '',
    onboarded: false,
    sosPin: '1234',
    sirenEnabled: true,
    autoLiveShareOnSos: true,
    phoneAndSmsPermissionGranted: false,
    shakeEnabled: true,
    shakeSensitivity: 'medium',
    multiPressEnabled: true,
    multiPressVolumeKeys: true,
    multiPressScreenWake: true,
    multiPressLogoTripleTap: true,
    multiPressAction: 'sos',
    defaultFakeCaller: 'Mom',
    customFakeCallerName: 'Priya (Roommate)',
    customFakeCallerPhone: '+91 98201 44120',
    defaultRingtone: 'classic',
    defaultFakeCallDelay: 0,
  };
}

export const DEFAULT_SETTINGS: AppSettings = createFreshDefaultSettings();

const DB_NAME = 'safe_her_offline_db';
const DB_VERSION = 1;
const STORE_KV = 'kv_store';

const LS_KEYS = {
  settings: 'safeher_settings_v1',
  contacts: 'safeher_contacts_v1',
  lastLocation: 'safeher_last_location_v1',
  sosLogs: 'safeher_sos_logs_v1',
  nearbyCache: 'safeher_nearby_cache_v1',
};

/**
 * StorageService persists all user data in both localStorage (for instant synchronous boot)
 * and IndexedDB (for resilient, larger-quota offline storage).
 */
class StorageServiceClass {
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private openDB(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return Promise.resolve(null);
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_KV)) {
              db.createObjectStore(STORE_KV);
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return this.dbPromise;
  }

  private async idbSet<T>(key: string, value: T): Promise<void> {
    const db = await this.openDB();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_KV, 'readwrite');
        tx.objectStore(STORE_KV).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async idbGet<T>(key: string): Promise<T | null> {
    const db = await this.openDB();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_KV, 'readonly');
        const req = tx.objectStore(STORE_KV).get(key);
        req.onsuccess = () => resolve((req.result as T) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Hydrates localStorage from IndexedDB if localStorage was evicted by mobile OS pressure.
   */
  async hydrateFromIndexedDB(): Promise<void> {
    for (const key of Object.values(LS_KEYS)) {
      try {
        if (!localStorage.getItem(key)) {
          const idbVal = await this.idbGet<unknown>(key);
          if (idbVal !== null && idbVal !== undefined) {
            localStorage.setItem(key, JSON.stringify(idbVal));
          }
        }
      } catch {
        // Ignore storage errors in private browsing modes
      }
    }
  }

  getSettings(): AppSettings {
    try {
      const raw = localStorage.getItem(LS_KEYS.settings);
      if (!raw) return {...DEFAULT_SETTINGS};
      return {...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>)};
    } catch {
      return {...DEFAULT_SETTINGS};
    }
  }

  saveSettings(settings: AppSettings): void {
    try {
      localStorage.setItem(LS_KEYS.settings, JSON.stringify(settings));
    } catch {
      // Ignore quota issue
    }
    void this.idbSet(LS_KEYS.settings, settings);
  }

  /**
   * Returns built-in non-deletable helplines (1091, 112) followed by user-added trusted contacts.
   */
  getAllContacts(): EmergencyContact[] {
    const custom = this.getTrustedContacts();
    return [...BUILT_IN_HELPLINES, ...custom];
  }

  /**
   * Returns only user-added trusted contacts (3 to 5 recommended).
   */
  getTrustedContacts(): EmergencyContact[] {
    try {
      const raw = localStorage.getItem(LS_KEYS.contacts);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as EmergencyContact[];
      let mutated = false;
      const normalized = parsed
        .filter((c) => !c.builtIn)
        .map((c) => {
          if (!c.guardianId) {
            mutated = true;
            return {
              ...c,
              guardianId: `grd_${c.id.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}_${Math.random().toString(36).slice(2, 6)}`,
            };
          }
          return c;
        });
      if (mutated) {
        this.saveTrustedContacts(normalized);
      }
      return normalized;
    } catch {
      return [];
    }
  }

  saveTrustedContacts(contacts: EmergencyContact[]): void {
    const sanitized = contacts
      .filter((c) => !c.builtIn)
      .slice(0, 10)
      .map((c) => ({
        ...c,
        guardianId:
          c.guardianId ||
          `grd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        builtIn: false,
      }));
    try {
      localStorage.setItem(LS_KEYS.contacts, JSON.stringify(sanitized));
    } catch {
      // Ignore quota error
    }
    void this.idbSet(LS_KEYS.contacts, sanitized);
  }

  getLastLocation(): CachedCoordinates | null {
    try {
      const raw = localStorage.getItem(LS_KEYS.lastLocation);
      if (!raw) return null;
      return JSON.parse(raw) as CachedCoordinates;
    } catch {
      return null;
    }
  }

  saveLastLocation(coords: CachedCoordinates): void {
    try {
      localStorage.setItem(LS_KEYS.lastLocation, JSON.stringify(coords));
    } catch {
      // Ignore
    }
    void this.idbSet(LS_KEYS.lastLocation, coords);
  }

  getSOSLogs(): SOSLogEntry[] {
    try {
      const raw = localStorage.getItem(LS_KEYS.sosLogs);
      if (!raw) return [];
      return JSON.parse(raw) as SOSLogEntry[];
    } catch {
      return [];
    }
  }

  addSOSLog(entry: SOSLogEntry): SOSLogEntry[] {
    const existing = this.getSOSLogs();
    const updated = [entry, ...existing].slice(0, 50);
    try {
      localStorage.setItem(LS_KEYS.sosLogs, JSON.stringify(updated));
    } catch {
      // Ignore
    }
    void this.idbSet(LS_KEYS.sosLogs, updated);
    return updated;
  }

  updateSOSLog(id: string, patch: Partial<SOSLogEntry>): SOSLogEntry[] {
    const existing = this.getSOSLogs().map((log) =>
      log.id === id ? {...log, ...patch} : log,
    );
    try {
      localStorage.setItem(LS_KEYS.sosLogs, JSON.stringify(existing));
    } catch {
      // Ignore
    }
    void this.idbSet(LS_KEYS.sosLogs, existing);
    return existing;
  }

  markSOSLogEnded(id: string): SOSLogEntry[] {
    return this.updateSOSLog(id, {endedAt: Date.now()});
  }

  clearSOSLogs(): void {
    try {
      localStorage.removeItem(LS_KEYS.sosLogs);
    } catch {
      // Ignore
    }
    void this.idbSet(LS_KEYS.sosLogs, []);
  }

  getNearbyCache(): NearbyCacheBundle | null {
    try {
      const raw = localStorage.getItem(LS_KEYS.nearbyCache);
      if (!raw) return null;
      return JSON.parse(raw) as NearbyCacheBundle;
    } catch {
      return null;
    }
  }

  saveNearbyCache(bundle: NearbyCacheBundle): void {
    try {
      localStorage.setItem(LS_KEYS.nearbyCache, JSON.stringify(bundle));
    } catch {
      // Ignore
    }
    void this.idbSet(LS_KEYS.nearbyCache, bundle);
  }

  private async idbDelete(key: string): Promise<void> {
    const db = await this.openDB();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_KV, 'readwrite');
        tx.objectStore(STORE_KV).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Logs out and clears sensitive session traces (cached GPS coordinates, SOS history logs,
   * nearby search cache, pending dispatches, and Phone/Messages authorization).
   * When `wipeContacts` is true, also erases all saved personal trusted contacts.
   */
  async clearPrivacySession(options: {wipeContacts?: boolean} = {}): Promise<AppSettings> {
    const keysToRemove = [
      LS_KEYS.lastLocation,
      LS_KEYS.sosLogs,
      LS_KEYS.nearbyCache,
      'safeher_pending_dispatches_v1',
      'safeher_guardian_watch_phone_v1',
    ];

    if (options.wipeContacts) {
      keysToRemove.push(LS_KEYS.contacts, LS_KEYS.settings);
    }

    for (const key of keysToRemove) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore storage error
      }
    }

    await Promise.all([
      this.idbDelete(LS_KEYS.lastLocation),
      this.idbDelete(LS_KEYS.sosLogs),
      this.idbDelete(LS_KEYS.nearbyCache),
      ...(options.wipeContacts
        ? [this.idbDelete(LS_KEYS.contacts), this.idbDelete(LS_KEYS.settings)]
        : []),
    ]);

    const freshSettings = createFreshDefaultSettings();
    if (!options.wipeContacts) {
      // Preserve notification/motion/fake-call preferences only when explicitly keeping contacts,
      // while resetting identity, PIN, Phone/SMS authorization, and logged-in session state.
      this.saveSettings(freshSettings);
    }
    return freshSettings;
  }
}

export const StorageService = new StorageServiceClass();
