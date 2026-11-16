import type {
  CachedCoordinates,
  EmergencyContact,
  LiveShareDuration,
  LiveShareSession,
} from '../types/safety';
import {StorageService} from './StorageService';

type LocationSubscriber = (coords: CachedCoordinates) => void;
type ErrorSubscriber = (message: string) => void;

/**
 * LocationService manages continuous background caching of the last known GPS fix
 * plus fully automated, zero-prompt live location streaming to all saved Trusted Contacts
 * whenever SOS or Live Share is active.
 */
class LocationServiceClass {
  private watchId: number | null = null;
  private heartbeatTimer: number | null = null;
  private subscribers = new Set<LocationSubscriber>();
  private errorSubscribers = new Set<ErrorSubscriber>();
  private activeSession: LiveShareSession | null = null;
  private sessionContacts: EmergencyContact[] = [];
  private sessionUserName: string = 'Safe Her User';
  private sessionTriggerSource: string | undefined = undefined;
  private expiryTimer: number | null = null;
  private onSessionChange: ((session: LiveShareSession | null) => void) | null = null;

  getCachedLocation(): CachedCoordinates | null {
    return StorageService.getLastLocation();
  }

  buildMapsUrl(coords: CachedCoordinates | null): string {
    if (!coords) return 'https://maps.google.com';
    return `https://maps.google.com/?q=${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`;
  }

  buildShareableTrackingUrl(sessionId: string, coords?: CachedCoordinates | null): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const fallbackParam = coords
      ? `&lat=${coords.lat.toFixed(6)}&lng=${coords.lng.toFixed(6)}`
      : '';
    return `${origin}/?track=${encodeURIComponent(sessionId)}${fallbackParam}`;
  }

  buildGuardianWatchUrl(guardianId: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/?guardian=${encodeURIComponent(guardianId)}`;
  }

  subscribe(onLocation: LocationSubscriber, onError?: ErrorSubscriber): () => void {
    this.subscribers.add(onLocation);
    if (onError) this.errorSubscribers.add(onError);
    return () => {
      this.subscribers.delete(onLocation);
      if (onError) this.errorSubscribers.delete(onError);
    };
  }

  /**
   * Syncs saved Trusted Contacts to the backend Guardian directory so SOS & Live Location
   * push automatically to contacts' Guardian channels with zero user Send prompt.
   */
  async syncGuardianDirectory(
    userId: string,
    userName: string,
    contacts: EmergencyContact[],
  ): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const trusted = contacts.filter((c) => !c.builtIn);
    if (trusted.length === 0) return;

    try {
      await fetch('/api/guardian/sync', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          userId,
          userName,
          contacts: trusted.map((c) => ({
            guardianId: c.guardianId,
            name: c.name,
            phone: c.phone,
            relationship: c.relationship,
          })),
        }),
      });
    } catch {
      // Will re-sync automatically on next online transition or SOS dispatch
    }
  }

  requestSingleFix(
    timeoutMs = 10000,
    maximumAgeMs = 5000,
    enableHighAccuracy = true,
  ): Promise<CachedCoordinates> {
    return new Promise((resolve, reject) => {
      if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
        reject(new Error('Geolocation is not supported by this browser.'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords: CachedCoordinates = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed,
            timestamp: Date.now(),
          };
          StorageService.saveLastLocation(coords);
          this.notifySubscribers(coords);
          resolve(coords);
        },
        (err) => {
          const msg = this.humanizeGeoError(err);
          this.notifyErrors(msg);
          reject(new Error(msg));
        },
        {
          enableHighAccuracy,
          maximumAge: maximumAgeMs,
          timeout: timeoutMs,
        },
      );
    });
  }

  startContinuousWatch(): void {
    if (this.watchId !== null) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: CachedCoordinates = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          speed: pos.coords.speed,
          timestamp: Date.now(),
        };
        StorageService.saveLastLocation(coords);
        this.notifySubscribers(coords);

        if (this.activeSession && this.activeSession.active) {
          void this.syncSessionToServer(coords);
        }
      },
      (err) => {
        this.notifyErrors(this.humanizeGeoError(err));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      },
    );
  }

  stopContinuousWatch(): void {
    if (this.watchId !== null && typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  /**
   * Starts an automated live location sharing session (zero Send prompt) and binds
   * all saved Trusted Contacts so they receive real-time SSE location pushes immediately.
   */
  async startLiveSession(params: {
    mode: 'sos' | 'live';
    durationMinutes: LiveShareDuration;
    userName: string;
    contacts?: EmergencyContact[];
    triggerSource?: string;
    onSessionUpdate?: (session: LiveShareSession | null) => void;
  }): Promise<LiveShareSession> {
    this.clearSessionTimers();

    const id = `sh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const expiresAt =
      params.durationMinutes > 0 ? now + params.durationMinutes * 60 * 1000 : null;

    const allContacts = params.contacts || StorageService.getAllContacts();
    this.sessionContacts = allContacts.filter((c) => !c.builtIn);
    this.sessionUserName = params.userName.trim() || 'Safe Her User';
    this.sessionTriggerSource = params.triggerSource;

    const initialCoords = this.getCachedLocation();

    const session: LiveShareSession = {
      id,
      mode: params.mode,
      active: true,
      startedAt: now,
      expiresAt,
      durationMinutes: params.durationMinutes,
      trackingUrl: this.buildShareableTrackingUrl(id, initialCoords),
      mapsUrl: this.buildMapsUrl(initialCoords),
      updateCount: 0,
      lastSyncedAt: null,
      activeViewers: 0,
    };

    this.activeSession = session;
    this.onSessionChange = params.onSessionUpdate || null;
    this.startContinuousWatch();

    // Always register session immediately on server (even if initialCoords is null while GPS locks)
    await this.syncSessionToServer(
      initialCoords,
      this.sessionUserName,
      this.sessionContacts.length,
      this.sessionTriggerSource,
    );

    // If no cached GPS yet, run a fast coarse/network fix alongside high-accuracy GPS so a pin appears immediately
    if (!initialCoords) {
      void this.requestSingleFix(2500, 600000, false)
        .then((coarse) => {
          if (this.activeSession && this.activeSession.id === id && this.activeSession.active) {
            void this.syncSessionToServer(coarse);
          }
        })
        .catch(() => {});
    }

    // Request fresh satellite fix immediately in background without blocking SOS startup
    void this.requestSingleFix(5500, 0, true)
      .then((fresh) => {
        if (this.activeSession && this.activeSession.id === id && this.activeSession.active) {
          void this.syncSessionToServer(fresh);
        }
      })
      .catch(() => {});

    // Continuous 3-second real-time push heartbeat to all Trusted Contacts
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.activeSession || !this.activeSession.active) return;

      void this.requestSingleFix(2800, 1500, true)
        .then((fresh) => {
          if (this.activeSession && this.activeSession.id === id && this.activeSession.active) {
            void this.syncSessionToServer(fresh);
          }
        })
        .catch(() => {
          const fallback = this.getCachedLocation();
          if (
            this.activeSession &&
            this.activeSession.id === id &&
            this.activeSession.active
          ) {
            void this.syncSessionToServer(
              fallback ? {...fallback, timestamp: Date.now()} : null,
            );
          }
        });
    }, 3000);

    if (expiresAt !== null) {
      this.expiryTimer = window.setTimeout(() => {
        void this.stopLiveSession();
      }, expiresAt - now);
    }

    return {...this.activeSession};
  }

  private clearSessionTimers(): void {
    if (this.expiryTimer !== null) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async syncSessionToServer(
    coords: CachedCoordinates | null,
    userNameOverride?: string,
    contactsNotified?: number,
    triggerSource?: string,
  ): Promise<void> {
    if (!this.activeSession || !this.activeSession.active) return;

    if (coords) {
      this.activeSession.mapsUrl = this.buildMapsUrl(coords);
      this.activeSession.trackingUrl = this.buildShareableTrackingUrl(
        this.activeSession.id,
        coords,
      );
      this.activeSession.updateCount += 1;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const settings = StorageService.getSettings();
        const recipientGuardianIds = this.sessionContacts
          .map((c) => c.guardianId)
          .filter((x): x is string => Boolean(x));
        const recipientPhones = this.sessionContacts.map((c) => c.phone);

        const res = await fetch(`/api/tracking/${encodeURIComponent(this.activeSession.id)}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            userId: settings.userId,
            userName:
              userNameOverride || this.sessionUserName || settings.userName || 'Safe Her User',
            mode: this.activeSession.mode,
            active: true,
            expiresAt: this.activeSession.expiresAt,
            contactsNotified: contactsNotified ?? this.sessionContacts.length,
            triggerSource: triggerSource ?? this.sessionTriggerSource,
            recipientGuardianIds,
            recipientPhones,
            location: coords,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            session?: {activeViewers?: number};
          };
          this.activeSession.lastSyncedAt = Date.now();
          if (typeof data.session?.activeViewers === 'number') {
            this.activeSession.activeViewers = data.session.activeViewers;
          }
        }
      } catch {
        // Offline — coordinates remain cached for automatic retry when online
      }
    }

    this.onSessionChange?.({...this.activeSession});
  }

  async stopLiveSession(): Promise<void> {
    this.clearSessionTimers();
    const prev = this.activeSession;
    this.activeSession = null;
    this.sessionContacts = [];
    this.sessionTriggerSource = undefined;
    this.onSessionChange?.(null);

    if (prev && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        await fetch(`/api/tracking/${encodeURIComponent(prev.id)}`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({active: false}),
          signal: AbortSignal.timeout(1500),
        });
      } catch {
        // Ignore network error or timeout on session stop
      }
    }
  }

  getActiveSession(): LiveShareSession | null {
    return this.activeSession;
  }

  private notifySubscribers(coords: CachedCoordinates): void {
    for (const cb of this.subscribers) {
      cb(coords);
    }
  }

  private notifyErrors(msg: string): void {
    for (const cb of this.errorSubscribers) {
      cb(msg);
    }
  }

  private humanizeGeoError(err: GeolocationPositionError): string {
    switch (err.code) {
      case err.PERMISSION_DENIED:
        return 'Location access was denied. Enable Location permissions in your browser settings so Safe Her can include GPS coordinates in SOS alerts.';
      case err.POSITION_UNAVAILABLE:
        return 'GPS signal is temporarily unavailable. Safe Her will use your last cached coordinates until signal returns.';
      case err.TIMEOUT:
        return 'GPS lock timed out. Using cached coordinates while continuing to search for satellites.';
      default:
        return 'Unable to read GPS location right now.';
    }
  }
}

export const LocationService = new LocationServiceClass();
