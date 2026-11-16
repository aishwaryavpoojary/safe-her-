export type TriggerSource =
  | 'One-Tap SOS Button'
  | 'Shake-to-Alert (3x Shake)'
  | 'Volume Key Multi-Press'
  | 'Screen Wake Multi-Press'
  | 'Logo Triple-Tap Panic'
  | 'Native Power Button'
  | 'Fake Call Emergency Escalation';

export type HelplineCategory = 'women' | 'emergency' | 'medical' | 'cyber' | 'transit';

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string;
  guardianId?: string;
  builtIn?: boolean;
  description?: string;
  helplineCategory?: HelplineCategory;
}

export type ShakeSensitivity = 'low' | 'medium' | 'high';
export type MultiPressAction = 'sos' | 'fakecall';
export type RingtoneStyle = 'classic' | 'pulse' | 'chime';
export type FakeCallerPreset = 'Mom' | 'Dad' | 'Sister' | 'Police' | 'Custom';
export type FakeCallDelay = 0 | 10 | 30 | 60;
export type LiveShareDuration = 15 | 60 | 0; // 0 = until stopped

export interface AppSettings {
  userId: string;
  userName: string;
  onboarded: boolean;
  sosPin: string;
  sirenEnabled: boolean;
  autoLiveShareOnSos: boolean;
  phoneAndSmsPermissionGranted: boolean;
  shakeEnabled: boolean;
  shakeSensitivity: ShakeSensitivity;
  multiPressEnabled: boolean;
  multiPressVolumeKeys: boolean;
  multiPressScreenWake: boolean;
  multiPressLogoTripleTap: boolean;
  multiPressAction: MultiPressAction;
  defaultFakeCaller: FakeCallerPreset;
  customFakeCallerName: string;
  customFakeCallerPhone: string;
  defaultRingtone: RingtoneStyle;
  defaultFakeCallDelay: FakeCallDelay;
}

export interface CachedCoordinates {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  timestamp: number;
}

export interface LiveShareSession {
  id: string;
  mode: 'sos' | 'live';
  active: boolean;
  startedAt: number;
  expiresAt: number | null;
  durationMinutes: LiveShareDuration;
  trackingUrl: string;
  mapsUrl: string;
  updateCount: number;
  lastSyncedAt: number | null;
  activeViewers?: number;
}

export interface SOSLogEntry {
  id: string;
  timestamp: number;
  endedAt?: number;
  triggerSource: TriggerSource;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;
  trackingUrl: string | null;
  alertChannel: 'online-live' | 'offline-sms' | 'no-contacts';
  contactsCount: number;
}

export interface NearbyPlace {
  id: string;
  name: string;
  category: 'police' | 'hospital';
  subType?: string;
  lat: number;
  lng: number;
  distanceMeters: number;
  phone?: string;
  address?: string;
  openingHours?: string;
  emergency?: boolean;
  osmUrl?: string;
}

export interface NearbyCacheBundle {
  places: NearbyPlace[];
  fetchedAt: number;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
}

export interface FakeCallConfig {
  preset: FakeCallerPreset;
  callerName: string;
  callerPhone: string;
  ringtone: RingtoneStyle;
  delaySeconds: FakeCallDelay;
}

export type NavTab = 'home' | 'contacts' | 'map' | 'fakecall' | 'settings';
