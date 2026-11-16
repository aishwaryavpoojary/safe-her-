import type {CachedCoordinates, EmergencyContact} from '../types/safety';

/**
 * NativeSmsTransportAdapter provides a plug-in seam for a Capacitor/Cordova
 * native Android wrapper (`Capacitor.Plugins.SafeHerSms` -> Android `SmsManager`)
 * so SMS alerts transmit silently through the device's default Messenger/carrier SMS
 * to all stored emergency contacts with ZERO "Send" prompt.
 */
export interface NativeSmsTransportAdapter {
  isAvailable(): boolean;
  sendSilentSms(recipients: string[], message: string): Promise<boolean>;
}

interface CapacitorSmsPluginBridge {
  sendSilentSms(options: {recipients: string[]; message: string}): Promise<{sent?: number} | boolean>;
  checkPermissions?(): Promise<{sms?: string; phone?: string}>;
  requestPermissions?(): Promise<{sms?: string; phone?: string}>;
}

export interface DefaultPhoneSmsPermissionResult {
  state: 'granted' | 'denied' | 'unsupported';
  channel: 'native-android' | 'server-sms-relay' | 'browser-unsupported';
  message: string;
}

export interface SmsDeliveryStatus {
  mode:
    | 'native-default-messenger'
    | 'server-sms-gateway'
    | 'guardian-stream-only'
    | 'queued-offline';
  provider?: string | null;
  sentCount: number;
  totalCount: number;
}

export interface AlertDispatchResult {
  channel: 'online-live' | 'offline-sms' | 'no-contacts';
  smsUri: string | null;
  messageBody: string;
  recipientCount: number;
  activeViewers?: number;
  queuedForAutoRetry?: boolean;
  smsDelivery?: SmsDeliveryStatus;
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

  private getCapacitorSmsPlugin(): CapacitorSmsPluginBridge | null {
    if (typeof window === 'undefined') return null;
    const cap = (
      window as unknown as {
        Capacitor?: {
          Plugins?: {
            SafeHerSms?: CapacitorSmsPluginBridge;
          };
        };
      }
    ).Capacitor;
    const plugin = cap?.Plugins?.SafeHerSms;
    if (plugin && typeof plugin.sendSilentSms === 'function') {
      return plugin;
    }
    return null;
  }

  isNativeMessengerPluginConnected(): boolean {
    return Boolean(this.nativeAdapter?.isAvailable() || this.getCapacitorSmsPlugin());
  }

  async getServerSmsStatus(): Promise<{configured: boolean; provider: string | null}> {
    try {
      const res = await fetch('/api/alerts/sms-status');
      if (!res.ok) return {configured: false, provider: null};
      const data = (await res.json()) as {configured?: boolean; provider?: string | null};
      return {
        configured: Boolean(data.configured),
        provider: data.provider ?? null,
      };
    } catch {
      return {configured: false, provider: null};
    }
  }

  async checkDefaultPhoneAndMessagesPermission(
    savedFlag: boolean,
  ): Promise<'pending' | 'granted' | 'denied' | 'unsupported'> {
    const capPlugin = this.getCapacitorSmsPlugin();
    if (capPlugin && typeof capPlugin.checkPermissions === 'function') {
      try {
        const res = await capPlugin.checkPermissions();
        if (res?.sms === 'granted') return 'granted';
        if (res?.sms === 'denied') return 'denied';
        return 'pending';
      } catch {
        // Fall through to server / browser check
      }
    }

    const serverSms = await this.getServerSmsStatus();
    if (serverSms.configured) {
      return savedFlag ? 'granted' : 'pending';
    }

    return 'unsupported';
  }

  async requestDefaultPhoneAndMessagesPermission(): Promise<DefaultPhoneSmsPermissionResult> {
    const capPlugin = this.getCapacitorSmsPlugin();
    if (capPlugin && typeof capPlugin.requestPermissions === 'function') {
      try {
        const res = await capPlugin.requestPermissions();
        const granted = res?.sms === 'granted';
        return {
          state: granted ? 'granted' : 'denied',
          channel: 'native-android',
          message: granted
            ? 'Device Phone & Default Messages (SEND_SMS / CALL_PHONE) permission granted. Live location will send silently through your phone messenger without asking Send.'
            : 'Phone & Messages runtime permission was declined in Android settings.',
        };
      } catch {
        return {
          state: 'denied',
          channel: 'native-android',
          message: 'Unable to open native Android Phone & Messages permission prompt.',
        };
      }
    }

    const serverSms = await this.getServerSmsStatus();
    if (serverSms.configured) {
      return {
        state: 'granted',
        channel: 'server-sms-relay',
        message: `Automated Server SMS Relay (${serverSms.provider}) is active: SOS and Live Location will deliver SMS automatically to your emergency contacts without any Send prompt.`,
      };
    }

    return {
      state: 'unsupported',
      channel: 'browser-unsupported',
      message:
        'Web browsers (Chrome, Safari, Firefox) cannot trigger Android/iOS OS permissions for Default Phone or Messages (SEND_SMS) and block silent SMS from web pages without tapping Send. Real zero-prompt carrier SMS requires packaging Safe Her as an Android Capacitor APK or configuring Twilio/SMS Webhook on the server; Guardian Live Stream remains active automatically in this browser.',
    };
  }

  private async trySendSilentDefaultMessenger(
    recipients: string[],
    message: string,
  ): Promise<boolean> {
    if (recipients.length === 0) return false;

    if (this.nativeAdapter && this.nativeAdapter.isAvailable()) {
      try {
        const ok = await this.nativeAdapter.sendSilentSms(recipients, message);
        if (ok) return true;
      } catch {
        // Fall through to Capacitor bridge check
      }
    }

    const capPlugin = this.getCapacitorSmsPlugin();
    if (capPlugin) {
      try {
        const result = await capPlugin.sendSilentSms({recipients, message});
        if (typeof result === 'boolean') return result;
        return typeof result?.sent === 'number' ? result.sent > 0 : true;
      } catch {
        return false;
      }
    }

    return false;
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
   * Automated emergency alert & live location dispatch with ZERO user "Send" request:
   * 1. Never opens an unsolicited OS `sms:` Send prompt.
   * 2. If running inside Android Capacitor with `SafeHerSms` (`SmsManager`), silently sends
   *    the alert + live tracking link through the phone's default Messenger/carrier SMS to all
   *    stored emergency contacts with zero Send confirmation.
   * 3. Simultaneously dispatches to `/api/alerts/dispatch` which streams real-time SSE updates
   *    to all saved contacts AND triggers automated server-side SMS relay when configured.
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

    const phones = Array.from(
      new Set(trusted.map((c) => c.phone.replace(/[^\d+]/g, '')).filter(Boolean)),
    );

    // 1. Silent dispatch via phone's default carrier SMS / Messenger when Capacitor SafeHerSms is present
    const nativeSent = await this.trySendSilentDefaultMessenger(phones, messageBody);

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

    // 2. Immediate local device multi-tab broadcast
    this.broadcastLocalChannel(payload);

    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : false;

    if (!isOnline) {
      this.enqueuePendingDispatch(payload);
      return {
        channel: nativeSent ? 'online-live' : 'offline-sms',
        smsUri,
        messageBody,
        recipientCount: trusted.length,
        queuedForAutoRetry: !nativeSent,
        smsDelivery: nativeSent
          ? {
              mode: 'native-default-messenger',
              provider: 'android-sms-manager',
              sentCount: trusted.length,
              totalCount: trusted.length,
            }
          : {
              mode: 'queued-offline',
              provider: null,
              sentCount: 0,
              totalCount: trusted.length,
            },
      };
    }

    // 3. Automated backend Guardian SSE + Server SMS Relay (never prompts user with a Send dialog)
    try {
      const res = await fetch('/api/alerts/dispatch', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...payload, sendSms: !nativeSent}),
      });

      if (!res.ok) {
        throw new Error('Alert endpoint returned non-200');
      }

      const responseData = (await res.json()) as {
        activeViewers?: number;
        smsDelivery?: {
          status: 'sent' | 'partial' | 'unconfigured' | 'failed';
          provider: string | null;
          sentCount: number;
          totalCount: number;
        };
      };

      const serverSmsSent =
        responseData.smsDelivery &&
        (responseData.smsDelivery.status === 'sent' ||
          responseData.smsDelivery.status === 'partial');

      const smsDelivery: SmsDeliveryStatus = nativeSent
        ? {
            mode: 'native-default-messenger',
            provider: 'android-sms-manager',
            sentCount: trusted.length,
            totalCount: trusted.length,
          }
        : serverSmsSent
          ? {
              mode: 'server-sms-gateway',
              provider: responseData.smsDelivery?.provider ?? null,
              sentCount: responseData.smsDelivery?.sentCount ?? trusted.length,
              totalCount: responseData.smsDelivery?.totalCount ?? trusted.length,
            }
          : {
              mode: 'guardian-stream-only',
              provider: responseData.smsDelivery?.provider ?? null,
              sentCount: 0,
              totalCount: trusted.length,
            };

      return {
        channel: 'online-live',
        smsUri,
        messageBody,
        recipientCount: trusted.length,
        activeViewers: responseData.activeViewers ?? 0,
        smsDelivery,
      };
    } catch {
      this.enqueuePendingDispatch(payload);
      return {
        channel: nativeSent ? 'online-live' : 'offline-sms',
        smsUri,
        messageBody,
        recipientCount: trusted.length,
        queuedForAutoRetry: !nativeSent,
        smsDelivery: nativeSent
          ? {
              mode: 'native-default-messenger',
              provider: 'android-sms-manager',
              sentCount: trusted.length,
              totalCount: trusted.length,
            }
          : {
              mode: 'queued-offline',
              provider: null,
              sentCount: 0,
              totalCount: trusted.length,
            },
      };
    }
  }
}

export const SmsAlertService = new SmsAlertServiceClass();


