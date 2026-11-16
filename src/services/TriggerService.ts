import type {TriggerSource} from '../types/safety';

export interface TriggerConfig {
  enabled: boolean;
  volumeKeysEnabled: boolean;
  screenWakeEnabled: boolean;
  logoTripleTapEnabled: boolean;
  onTrigger: (source: TriggerSource) => void;
}

/**
 * ============================================================================
 * NATIVE CAPACITOR ANDROID POWER-BUTTON PLUGIN HOOK SPECIFICATION
 * ============================================================================
 * Web browsers intentionally block direct access to the hardware Power button.
 * When wrapping Safe Her into a native Android APK/AAB with Capacitor:
 *
 * 1. Create a Capacitor Android plugin (`PowerButtonPlugin.java` / `.kt`) that
 *    registers a foreground Service + BroadcastReceiver for:
 *      - `Intent.ACTION_SCREEN_OFF`
 *      - `Intent.ACTION_SCREEN_ON`
 * 2. Count timestamps of rapid power-button transitions: when >= 3 presses occur
 *    within 2500ms, call:
 *      `notifyListeners("hardwarePowerMultiPress", JSObject().put("pressCount", count))`
 * 3. On app startup, `TriggerService.attachCapacitorPowerPlugin()` automatically
 *    detects `window.Capacitor?.Plugins?.SafeHerPowerButton` and routes real
 *    hardware power-button presses directly into the exact same `onTrigger` pipeline!
 * ============================================================================
 */
interface CapacitorPowerPluginBridge {
  addListener(
    eventName: 'hardwarePowerMultiPress',
    listenerFunc: (data: {pressCount: number}) => void,
  ): Promise<{remove: () => void}> | {remove: () => void};
}

class TriggerServiceClass {
  private config: TriggerConfig = {
    enabled: true,
    volumeKeysEnabled: true,
    screenWakeEnabled: true,
    logoTripleTapEnabled: true,
    onTrigger: () => {},
  };

  private volumePresses: number[] = [];
  private visibilityTransitions: number[] = [];
  private logoTaps: number[] = [];
  private listening = false;
  private nativeSubscription: {remove: () => void} | null = null;
  private lastTriggeredAt = 0;

  configure(nextConfig: TriggerConfig): void {
    this.config = nextConfig;
    if (this.config.enabled && !this.listening && typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
      void this.attachCapacitorPowerPlugin();
      this.listening = true;
    } else if (!this.config.enabled && this.listening && typeof window !== 'undefined') {
      this.detachAll();
    }
  }

  detachAll(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown);
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.nativeSubscription?.remove();
    this.nativeSubscription = null;
    this.listening = false;
  }

  /**
   * Called when the user taps the Safe Her shield logo in the top header.
   * Three quick taps within 1.4 seconds fires the configured panic action
   * (either SOS Countdown or Instant Fake Call).
   * Returns current tap count (1..3) so UI can give subtle tactile feedback.
   */
  registerLogoTap(): number {
    if (!this.config.enabled || !this.config.logoTripleTapEnabled) return 0;

    const now = Date.now();
    this.logoTaps = this.logoTaps.filter((t) => now - t <= 1400);
    this.logoTaps.push(now);

    if (this.logoTaps.length >= 3) {
      this.logoTaps = [];
      this.fire('Logo Triple-Tap Panic');
      return 3;
    }
    return this.logoTaps.length;
  }

  /**
   * Hooks into a Capacitor Android Power Button plugin automatically when present.
   */
  private async attachCapacitorPowerPlugin(): Promise<void> {
    if (typeof window === 'undefined' || this.nativeSubscription) return;
    const cap = (
      window as unknown as {
        Capacitor?: {
          isNativePlatform?: () => boolean;
          Plugins?: {SafeHerPowerButton?: CapacitorPowerPluginBridge};
        };
      }
    ).Capacitor;

    const plugin = cap?.Plugins?.SafeHerPowerButton;
    if (plugin && typeof plugin.addListener === 'function') {
      try {
        this.nativeSubscription = await plugin.addListener('hardwarePowerMultiPress', () => {
          if (this.config.enabled) {
            this.fire('Native Power Button');
          }
        });
      } catch {
        // Running in standard web browser without native plugin
      }
    }
  }

  isNativePowerPluginConnected(): boolean {
    return this.nativeSubscription !== null;
  }

  /**
   * Web Signal 1: Rapid Volume Up / Volume Down key presses (3 presses within 2.2s)
   * where exposed by Android WebViews, external media buttons, or desktop keyboards.
   */
  private handleKeyDown = (e: KeyboardEvent): void => {
    if (!this.config.enabled || !this.config.volumeKeysEnabled) return;

    const isVolumeSignal =
      e.key === 'AudioVolumeUp' ||
      e.key === 'AudioVolumeDown' ||
      e.key === 'VolumeUp' ||
      e.key === 'VolumeDown';

    if (!isVolumeSignal) return;

    const now = Date.now();
    this.volumePresses = this.volumePresses.filter((t) => now - t <= 2200);
    this.volumePresses.push(now);

    if (this.volumePresses.length >= 3) {
      this.volumePresses = [];
      this.fire('Volume Key Multi-Press');
    }
  };

  /**
   * Web Signal 2: Rapid screen lock/wake or app visibility toggles
   * (4 visibility transitions = 2 rapid lock/unlock cycles within 4.5 seconds).
   */
  private handleVisibilityChange = (): void => {
    if (!this.config.enabled || !this.config.screenWakeEnabled) return;

    const now = Date.now();
    this.visibilityTransitions = this.visibilityTransitions.filter((t) => now - t <= 4500);
    this.visibilityTransitions.push(now);

    if (this.visibilityTransitions.length >= 4 && document.visibilityState === 'visible') {
      this.visibilityTransitions = [];
      this.fire('Screen Wake Multi-Press');
    }
  };

  private fire(source: TriggerSource): void {
    const now = Date.now();
    if (now - this.lastTriggeredAt < 3500) return;
    this.lastTriggeredAt = now;
    this.config.onTrigger(source);
  }
}

export const TriggerService = new TriggerServiceClass();
