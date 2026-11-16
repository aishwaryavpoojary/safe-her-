import type {ShakeSensitivity} from '../types/safety';

const THRESHOLDS: Record<ShakeSensitivity, number> = {
  high: 13.5, // Easier to trigger (lower g-force threshold)
  medium: 19.5, // Balanced strong shake
  low: 27.0, // Requires very hard deliberate shake
};

interface DeviceMotionEventWithPermission extends DeviceMotionEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * ShakeService uses the DeviceMotion API (including the iOS 13+ permission request flow)
 * to detect 3 strong shakes within 2 seconds while the app is open in the foreground.
 */
class ShakeServiceClass {
  private enabled = false;
  private sensitivity: ShakeSensitivity = 'medium';
  private shakeTimestamps: number[] = [];
  private lastShakeAt = 0;
  private lastCooldownTriggerAt = 0;
  private lastAccel = {x: 0, y: 0, z: 0, initialized: false};

  private onShakeTrigger: (() => void) | null = null;
  private onMeterUpdate: ((magnitude: number, count: number) => void) | null = null;
  private listening = false;

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
  }

  requiresExplicitIOSPermission(): boolean {
    if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
      return false;
    }
    const dme = DeviceMotionEvent as unknown as DeviceMotionEventWithPermission;
    return typeof dme.requestPermission === 'function';
  }

  /**
   * Must be invoked inside a direct user click/tap handler on iOS 13+ Safari.
   */
  async requestPermission(): Promise<'granted' | 'denied' | 'unsupported'> {
    if (!this.isSupported()) return 'unsupported';
    const dme = DeviceMotionEvent as unknown as DeviceMotionEventWithPermission;
    if (typeof dme.requestPermission === 'function') {
      try {
        const result = await dme.requestPermission();
        return result;
      } catch {
        return 'denied';
      }
    }
    return 'granted';
  }

  configure(params: {
    enabled: boolean;
    sensitivity: ShakeSensitivity;
    onTrigger: () => void;
    onMeterUpdate?: (magnitude: number, shakeCount: number) => void;
  }): void {
    this.enabled = params.enabled;
    this.sensitivity = params.sensitivity;
    this.onShakeTrigger = params.onTrigger;
    this.onMeterUpdate = params.onMeterUpdate || null;

    if ((this.enabled || this.onMeterUpdate) && !this.listening && this.isSupported()) {
      window.addEventListener('devicemotion', this.handleMotion, {passive: true});
      this.listening = true;
    } else if (!this.enabled && !this.onMeterUpdate && this.listening) {
      window.removeEventListener('devicemotion', this.handleMotion);
      this.listening = false;
    }
  }

  stop(): void {
    if (this.listening && typeof window !== 'undefined') {
      window.removeEventListener('devicemotion', this.handleMotion);
      this.listening = false;
    }
  }

  private handleMotion = (event: DeviceMotionEvent): void => {
    const acc = event.accelerationIncludingGravity || event.acceleration;
    if (!acc) return;

    const x = acc.x ?? 0;
    const y = acc.y ?? 0;
    const z = acc.z ?? 0;

    if (!this.lastAccel.initialized) {
      this.lastAccel = {x, y, z, initialized: true};
      return;
    }

    const dx = x - this.lastAccel.x;
    const dy = y - this.lastAccel.y;
    const dz = z - this.lastAccel.z;
    this.lastAccel = {x, y, z, initialized: true};

    const deltaMagnitude = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const now = Date.now();

    // Prune shakes older than 2000ms
    this.shakeTimestamps = this.shakeTimestamps.filter((t) => now - t <= 2000);

    const threshold = THRESHOLDS[this.sensitivity];

    // Debounce individual shake peaks by 240ms so one swing doesn't register twice
    if (deltaMagnitude >= threshold && now - this.lastShakeAt >= 240) {
      this.lastShakeAt = now;
      this.shakeTimestamps.push(now);

      if (this.shakeTimestamps.length >= 3) {
        this.shakeTimestamps = [];
        this.onMeterUpdate?.(deltaMagnitude, 3);

        // Enforce 5s cooldown after firing trigger
        if (this.enabled && now - this.lastCooldownTriggerAt > 5000) {
          this.lastCooldownTriggerAt = now;
          this.onShakeTrigger?.();
        }
        return;
      }
    }

    this.onMeterUpdate?.(deltaMagnitude, this.shakeTimestamps.length);
  };
}

export const ShakeService = new ShakeServiceClass();
