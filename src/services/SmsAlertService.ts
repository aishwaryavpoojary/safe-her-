import type {CachedCoordinates, EmergencyContact} from '../types/safety';

/**
 * NativeSmsTransportAdapter provides a clean plug-in seam for a future Capacitor/Cordova
 * native Android/iOS wrapper (e.g., Android SmsManager via custom Capacitor plugin)
 * so cellular SMS alerts can also transmit silently in the background without opening an OS composer.
 */
export interface NativeSmsTransportAdapter {
  isAvailable(): boolean;
  sendSilentSms(recipients: string[], message: string): Promise<boolean>;
}

export interface AlertDispatchResult {
  channel: 'online-live' | 'offline-sms' | 'no-contacts';
  smsUri: string | null;
  messageBody: string;
  recipientCount: number;
  activeViewers?: number;
  queuedForAutoRetry?: boolean;
}

interface PendingDispatchPayload {
  sessionId: string;
  userId?: string;
  userName: string;
  mode: 'sos' | 'live';
  expiresAt?: number | null;
  triggerSource?: string;
  location: CachedCoordinates | null;
  message: string;
  trackingUrl: string;
  mapsUrl: string;
  contacts: Array<{
    name: string;
    phone: string;
    relationship: string;
    guardianId?: string;
  }>;
  queuedAt: number;
}

const PENDING_QUEUE_KEY = 'safeher_pending_dispatches_v1';

class SmsAlertServiceClass {
  private nativeAdapter: NativeSmsTransportAdapter | null = null;

  registerNativeAdapter(adapter: NativeSmsTransportAdapter): void {
    this.nativeAdapter = adapter;
  }

  buildGoogleMapsLink(coords: CachedCoordinates | null): string | null {
    if (!coords) return null;
    return `https://maps.google.com/?q=${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`;
  }

  buildEmergencyMessage(params: {
    userName: string;
    coords: CachedCoordinates | null;
    trackingUrl?: string | null;
    mode?: 'sos' | 'live';
  }): string {
    const sender = params.userName.trim() || 'Safe Her User';
    const mapsUrl = this.buildGoogleMapsLink(params.coords);
    const timeStr = params.coords
      ? new Date(params.coords.timestamp).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'acquiring';

    const header =
      params.mode === 'live'
        ? `LIVE LOCATION from ${sender}: Sharing my real-time location with you.`
        : `EMERGENCY SOS from ${sender}: I need help urgently.`;

    const parts = [header];
    if (mapsUrl) {
      parts.push(`GPS Location (${timeStr}): ${mapsUrl}`);
    } else {
      parts.push('GPS coordinates acquiring — live map updates automatically once locked.');
    }
    if (params.trackingUrl) {
      parts.push(`Live Tracking Map: ${params.trackingUrl}`);
    }
    return parts.join('\n');
  }

  buildSmsComposerUri(contacts: EmergencyContact[], messageBody: string): string | null {
    const personal = contacts.filter((c) => !c.builtIn && c.phone.trim().length > 0);
    const targets = personal.length > 0 ? personal : contacts;

    const cleanedNumbers = Array.from(
      new Set(
        targets
          .map((c) => c.phone.replace(/[^\d+]/g, ''))
          .filter((p) => p.length > 0),
      ),
    );

    if (cleanedNumbers.length === 0) return null;

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    const isIOS = /iphone|ipad|ipod/.test(ua);
    const encodedBody = encodeURIComponent(messageBody);

    if (isIOS) {
      return `sms:/open?addresses=${cleanedNumbers.join(',')}&body=${encodedBody}`;
    }

    return `sms:${cleanedNumbers.join(',')}?body=${encodedBody}`;
  }

  private broadcastLocalChannel(payload: PendingDispatchPayload): void {
    if (typeof BroadcastChannel === 'undefined') return;
    try {
      const ch = new BroadcastChannel('safeher_live_alerts');
      ch.postMessage({type: 'dispatch_alert', payload});
      ch.close();
    } catch {
      // Ignore BroadcastChannel unavailability
    }
  }

  private enqueuePendingDispatch(payload: PendingDispatchPayload): void {
    try {
      const raw = localStorage.getItem(PENDING_QUEUE_KEY);
      const existing: PendingDispatchPayload[] = raw ? JSON.parse(raw) : [];
      const filtered = existing.filter((p) => p.sessionId !== payload.sessionId);
      const updated = [payload, ...filtered].slice(0, 10);
      localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage error
    }
  }

  async flushPendingDispatches(): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    try {
      const raw = localStorage.getItem(PENDING_QUEUE_KEY);
      if (!raw) return;
      const queue = JSON.parse(raw) as PendingDispatchPayload[];
      if (!Array.isArray(queue) || queue.length === 0) return;

      const remaining: PendingDispatchPayload[] = [];
      for (const item of queue) {
        try {
          const res = await fetch('/api/alerts/dispatch', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(item),
          });
          if (!res.ok) {
            remaining.push(item);
          }
        } catch {
          remaining.push(item);
        }
      }

      if (remaining.length === 0) {
        localStorage.removeItem(PENDING_QUEUE_KEY);
      } else {
        localStorage.setItem(PENDING_QUEUE_KEY, JSON.stringify(remaining));
      }
    } catch {
      // Ignore queue flush errors
    }
  }

  /**
   * Completely automated emergency alert & live location dispatch with ZERO user "Send" request:
   * - Never opens an unsolicited OS `sms:` Send prompt.
   * - Broadcasts automatically to `/api/alerts/dispatch` (which atomically creates/links the live
   *   tracking session and pushes real-time SSE alerts to all saved Trusted Contacts).
   * - Dispatches silent background SMS via native Capacitor SmsManager when wrapped on Android.
   * - Broadcasts via local BroadcastChannel & queues for instant auto-retry if temporarily offline.
   */
  async dispatchEmergencyAlert(params: {
    sessionId: string;
    userId?: string;
    userName: string;
    mode?: 'sos' | 'live';
    expiresAt?: number | null;
    triggerSource?: string;
    contacts: EmergencyContact[];
    coords: CachedCoordinates | null;
    trackingUrl: string | null;
  }): Promise<AlertDispatchResult> {
    const trusted = params.contacts.filter((c) => !c.builtIn);
    const mode = params.mode === 'live' ? 'live' : 'sos';
    const messageBody = this.buildEmergencyMessage({
      userName: params.userName,
      coords: params.coords,
      trackingUrl: params.trackingUrl,
      mode,
    });
    const smsUri = this.buildSmsComposerUri(params.contacts, messageBody);
    const mapsUrl = this.buildGoogleMapsLink(params.coords) || '';

    if (trusted.length === 0) {
      return {
        channel: 'no-contacts',
        smsUri,
        messageBody,
        recipientCount: 0,
      };
    }

    // Optional silent native SMS in parallel if running inside Capacitor Android wrapper
    if (this.nativeAdapter && this.nativeAdapter.isAvailable()) {
      const phones = trusted.map((c) => c.phone.replace(/[^\d+]/g, ''));
      void this.nativeAdapter.sendSilentSms(phones, messageBody).catch(() => {});
    }

    const payload: PendingDispatchPayload = {
      sessionId: params.sessionId,
      userId: params.userId,
      userName: params.userName || 'Safe Her User',
      mode,
      expiresAt: params.expiresAt ?? null,
      triggerSource: params.triggerSource,
      location: params.coords,
      message: messageBody,
      trackingUrl: params.trackingUrl || '',
      mapsUrl,
      contacts: trusted.map((c) => ({
        name: c.name,
        phone: c.phone,
        relationship: c.relationship,
        guardianId: c.guardianId,
      })),
      queuedAt: Date.now(),
    };

    // Immediate local device multi-tab broadcast
    this.broadcastLocalChannel(payload);

    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : false;

    if (!isOnline) {
      this.enqueuePendingDispatch(payload);
      return {
        channel: 'offline-sms',
        smsUri,
        messageBody,
        recipientCount: trusted.length,
        queuedForAutoRetry: true,
      };
    }

    // Online: 100% silent automated backend + SSE Guardian push — NEVER prompts user with a Send dialog
    try {
      const res = await fetch('/api/alerts/dispatch', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error('Alert endpoint returned non-200');
      }

      const responseData = (await res.json()) as {activeViewers?: number};

      return {
        channel: 'online-live',
        smsUri,
        messageBody,
        recipientCount: trusted.length,
        activeViewers: responseData.activeViewers ?? 0,
      };
    } catch {
      this.enqueuePendingDispatch(payload);
      return {
        channel: 'offline-sms',
        smsUri,
        messageBody,
        recipientCount: trusted.length,
        queuedForAutoRetry: true,
      };
    }
  }
}

export const SmsAlertService = new SmsAlertServiceClass();

