import type {FakeCallerPreset, RingtoneStyle} from '../types/safety';

const FAKE_CALL_SCRIPTS: Record<FakeCallerPreset, string[]> = {
  Mom: [
    "Hey sweetheart, I can see your live location right now. Dad and I are parked just up the main road near the intersection, stay on the phone with me.",
    "Yes, keep walking toward the well-lit shopfront ahead. I can see your blue dot moving, we are less than two minutes away from you.",
    "Tell me what landmark you're passing right now. Don't hang up, I have your location open on my screen until you're in the car.",
  ],
  Dad: [
    "Hey beta, I'm right around the corner in the car with hazards on. Keep me on speaker so I can hear you clearly.",
    "Good, I have your live GPS pin open right here. Walk steady toward the main street, I'm pulling up in ninety seconds.",
    "I see you on the map. Stay right on the line with me until you reach the front door.",
  ],
  Sister: [
    "Hey! I'm literally two minutes away waiting outside near the main crossing, I have your live location open right now.",
    "Yeah, wave when you pass the streetlight ahead, I'm wearing my jacket and looking right down your block.",
    "Keep talking to me, don't hang up—I'm walking toward you right now so we can head home together.",
  ],
  Police: [
    "This is Emergency Dispatch Control. Your live GPS coordinates have been logged and the nearest patrol unit is en route to your location.",
    "Please remain in a visible, well-lit public area if safe to do so. Keep this line open while our patrol vehicle approaches within three minutes.",
    "Unit Four confirms visual proximity to your sector. Stay on the line until officers make direct contact.",
  ],
  Custom: [
    "Hey, I've got your live location open on my phone right now and I'm heading straight toward you, about two minutes away.",
    "Stay on the line with me and walk toward the nearest open store or bright streetlamp. I'm almost right there.",
    "Got it, I see your pin updating live. Keep talking to me until I'm standing right next to you.",
  ],
};

/**
 * AudioService synthesizes the loud emergency siren, countdown ticks, and phone ringtones
 * entirely via the Web Audio API, plus offline prerecorded-style voices via SpeechSynthesis.
 * Works 100% offline with zero external audio dependencies.
 */
class AudioServiceClass {
  private ctx: AudioContext | null = null;
  private sirenOscPrimary: OscillatorNode | null = null;
  private sirenOscHarmonic: OscillatorNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenInterval: number | null = null;
  private vibrationInterval: number | null = null;

  private ringtoneInterval: number | null = null;
  private ringtoneTimeout: number | null = null;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Plays a brief crisp tick during the 5-second SOS countdown.
   */
  playCountdownBeep(secondsRemaining: number): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(secondsRemaining <= 2 ? 1046 : 784, now);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(0.35, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);

    this.vibrate([90]);
  }

  /**
   * Starts a high-output dual-oscillator emergency wail siren (780 Hz <-> 1560 Hz)
   * compressed for maximum clarity on phone speakers. Works 100% offline.
   */
  startSiren(): void {
    this.stopSiren();
    const ctx = this.ensureContext();
    if (!ctx) return;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-14, ctx.currentTime);
    compressor.knee.setValueAtTime(12, ctx.currentTime);
    compressor.ratio.setValueAtTime(8, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.15, ctx.currentTime);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.85, ctx.currentTime);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(780, ctx.currentTime);

    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(1170, ctx.currentTime);

    const subGain2 = ctx.createGain();
    subGain2.gain.setValueAtTime(0.38, ctx.currentTime);

    osc1.connect(masterGain);
    osc2.connect(subGain2);
    subGain2.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);

    osc1.start();
    osc2.start();

    this.sirenOscPrimary = osc1;
    this.sirenOscHarmonic = osc2;
    this.sirenGain = masterGain;

    let highPhase = true;
    const sweep = () => {
      if (!this.ctx || !this.sirenOscPrimary || !this.sirenOscHarmonic) return;
      const t = this.ctx.currentTime;
      if (highPhase) {
        this.sirenOscPrimary.frequency.exponentialRampToValueAtTime(1560, t + 0.48);
        this.sirenOscHarmonic.frequency.exponentialRampToValueAtTime(2080, t + 0.48);
      } else {
        this.sirenOscPrimary.frequency.exponentialRampToValueAtTime(780, t + 0.48);
        this.sirenOscHarmonic.frequency.exponentialRampToValueAtTime(1040, t + 0.48);
      }
      highPhase = !highPhase;
    };

    sweep();
    this.sirenInterval = window.setInterval(sweep, 500);
  }

  stopSiren(): void {
    if (this.sirenInterval !== null) {
      clearInterval(this.sirenInterval);
      this.sirenInterval = null;
    }
    try {
      this.sirenOscPrimary?.stop();
      this.sirenOscPrimary?.disconnect();
    } catch {
      // Already stopped
    }
    try {
      this.sirenOscHarmonic?.stop();
      this.sirenOscHarmonic?.disconnect();
    } catch {
      // Already stopped
    }
    try {
      this.sirenGain?.disconnect();
    } catch {
      // Ignore
    }
    this.sirenOscPrimary = null;
    this.sirenOscHarmonic = null;
    this.sirenGain = null;
  }

  startSOSVibration(): void {
    this.stopSOSVibration();
    const pulse = () => {
      this.vibrate([500, 200, 500, 200, 700]);
    };
    pulse();
    this.vibrationInterval = window.setInterval(pulse, 2400);
  }

  stopSOSVibration(): void {
    if (this.vibrationInterval !== null) {
      clearInterval(this.vibrationInterval);
      this.vibrationInterval = null;
    }
    this.vibrate(0);
  }

  vibrate(pattern: number | number[]): boolean {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        return navigator.vibrate(pattern);
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * Plays a realistic incoming phone ringtone loop offline.
   */
  startRingtone(style: RingtoneStyle, withVibration = true): void {
    this.stopRingtone();
    const playPhrase = () => {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      if (style === 'classic') {
        // Classic dual-tone phone ring burst
        for (let burst = 0; burst < 2; burst++) {
          const offset = burst * 0.55;
          const o1 = ctx.createOscillator();
          const o2 = ctx.createOscillator();
          const g = ctx.createGain();
          o1.type = 'sine';
          o2.type = 'sine';
          o1.frequency.setValueAtTime(440, now + offset);
          o2.frequency.setValueAtTime(480, now + offset);
          g.gain.setValueAtTime(0.001, now + offset);
          g.gain.linearRampToValueAtTime(0.32, now + offset + 0.03);
          g.gain.setValueAtTime(0.32, now + offset + 0.36);
          g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.42);
          o1.connect(g);
          o2.connect(g);
          g.connect(ctx.destination);
          o1.start(now + offset);
          o2.start(now + offset);
          o1.stop(now + offset + 0.44);
          o2.stop(now + offset + 0.44);
        }
      } else if (style === 'pulse') {
        // Modern marimba-inspired smartphone melody
        const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 659.25];
        notes.forEach((freq, idx) => {
          const t = now + idx * 0.17;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.001, t);
          g.gain.exponentialRampToValueAtTime(0.38, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.16);
        });
      } else {
        // Urgent chime triad
        const notes = [587.33, 880, 1174.66, 880];
        notes.forEach((freq, idx) => {
          const t = now + idx * 0.22;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, t);
          g.gain.setValueAtTime(0.001, t);
          g.gain.exponentialRampToValueAtTime(0.36, t + 0.02);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
          osc.connect(g);
          g.connect(ctx.destination);
          osc.start(t);
          osc.stop(t + 0.21);
        });
      }

      if (withVibration) {
        this.vibrate([700, 300, 700]);
      }
    };

    playPhrase();
    this.ringtoneInterval = window.setInterval(playPhrase, 2600);
  }

  previewRingtone(style: RingtoneStyle): void {
    this.startRingtone(style, false);
    this.ringtoneTimeout = window.setTimeout(() => {
      this.stopRingtone();
    }, 2200);
  }

  stopRingtone(): void {
    if (this.ringtoneInterval !== null) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
    if (this.ringtoneTimeout !== null) {
      clearTimeout(this.ringtoneTimeout);
      this.ringtoneTimeout = null;
    }
    this.vibrate(0);
  }

  getFakeCallerLines(preset: FakeCallerPreset): string[] {
    return FAKE_CALL_SCRIPTS[preset] || FAKE_CALL_SCRIPTS.Custom;
  }

  /**
   * Speaks a realistic caller phrase using the browser's offline SpeechSynthesis engine.
   * Returns the spoken text for simultaneous live caption display.
   */
  speakCallerLine(
    preset: FakeCallerPreset,
    lineIndex: number,
    onDone?: () => void,
  ): string {
    const lines = this.getFakeCallerLines(preset);
    const text = lines[lineIndex % lines.length];

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = preset === 'Police' ? 1.02 : 0.98;
        utter.pitch = preset === 'Dad' ? 0.88 : preset === 'Mom' || preset === 'Sister' ? 1.12 : 1.0;
        utter.volume = 1.0;

        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          const localEnglish = voices.filter(
            (v) => v.lang.startsWith('en') && v.localService,
          );
          const pool = localEnglish.length > 0 ? localEnglish : voices.filter((v) => v.lang.startsWith('en'));
          if (pool.length > 0) {
            utter.voice = pool[0];
          }
        }

        utter.onend = () => onDone?.();
        utter.onerror = () => onDone?.();
        window.speechSynthesis.speak(utter);
      } catch {
        onDone?.();
      }
    } else {
      onDone?.();
    }

    return text;
  }

  stopSpeech(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore
      }
    }
  }
}

export const AudioService = new AudioServiceClass();
