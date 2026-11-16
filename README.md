# Safe Her — Women’s Safety & Offline Emergency Alert PWA

**Safe Her** is a mobile-first, one-handed Progressive Web App built with React, TypeScript, Tailwind CSS, Leaflet, Web Audio API, and an Express live-tracking backend.

## Architecture Overview

- `src/services/StorageService.ts` — Dual-layer offline storage (`localStorage` + `IndexedDB`) for contacts, PIN, trigger preferences, SOS logs, and cached nearby stations. Pre-populates permanent built-in national helplines (`1091` Women Helpline and `112` Police Emergency).
- `src/services/AudioService.ts` — Zero-dependency offline Web Audio API synthesizer for the dual-oscillator emergency siren, countdown ticks, and realistic phone ringtones, plus offline `SpeechSynthesis` caller dialogue and vibration loops.
- `src/services/LocationService.ts` — Continuous cached GPS coordinates (`watchPosition`), Google Maps link builder, and real-time live tracking session sync (`POST /api/tracking/:id`).
- `src/services/SmsAlertService.ts` — Standalone emergency alert & multi-recipient cellular `sms:` URI builder (`sms:/open?addresses=...` on iOS and `sms:n1,n2?body=...` on Android) with a clean `NativeSmsTransportAdapter` interface for silent background SMS in Capacitor.
- `src/services/ShakeService.ts` — Foreground `DeviceMotionEvent` detector (3 strong shakes within 2 seconds) with adjustable sensitivity (`Low`, `Medium`, `High`), iOS 13+ `requestPermission()` flow, and a safe sensor test meter.
- `src/services/TriggerService.ts` — Hardware/gesture trigger abstraction listening to rapid Volume-key presses, rapid screen wake/visibility transitions, and triple-tap on the Safe Her header brand mark, plus a documented Capacitor Android `SafeHerPowerButton` listener hook.
- `src/services/NearbyService.ts` — Queries OpenStreetMap Overpass API for nearby police stations and hospitals (`1 km`, `3 km`, `5 km`), sorts by Haversine distance, and caches results offline.

---

## Browser Capabilities vs. Native Wrapper (Capacitor) Capabilities

### Works Directly in the Browser / Installed PWA (Online & Offline)

| Feature | Browser / PWA Status | Notes |
| :--- | :--- | :--- |
| **Installable PWA & Offline Boot** | Fully supported | Manifest + Workbox service worker precache all app assets, CSS, icons, and visited OSM map tiles. |
| **Onboarding, Contacts & Helplines** | Fully supported | Stored locally in `IndexedDB` + `localStorage`. `1091` and `112` are locked built-in helplines. |
| **One-Tap SOS + 5s Countdown** | Fully supported | Large thumb-zone SOS button, Web Audio siren, flashing red strobe, and 4-digit PIN-protected Stop pad. |
| **Live Location Tracking Link** | Fully supported (Online) | Streams `watchPosition` updates to `/api/tracking/:sessionId`; contacts view a live-updating Leaflet map at `/?track=<sessionId>`. Manual 15m / 1h / Until-stopped mode included. |
| **Offline Emergency Cellular SMS** | Supported via OS Composer | Automatically pre-addresses all trusted contacts with user name + cached GPS Google Maps link via `sms:` URI over cellular network without internet; requires one tap on the OS Send button due to browser sandbox rules. |
| **Fake Call (Ringtone + Voice + Timer)** | Fully supported (100% Offline) | Web Audio ringtones + offline `SpeechSynthesis` caller scripts + persistent Emergency Info card. |
| **Shake-to-Alert (3x in 2s)** | Foreground only | Uses `DeviceMotionEvent` (with iOS permission prompt) while Safe Her is open on screen. |
| **Triple-Tap Panic & Volume/Wake Signals** | Foreground / supported browsers | Triple-tap header brand mark works everywhere; volume key events depend on OS/WebView exposure. |
| **Nearby Police & Hospitals + Directions** | Fully supported + Offline Cache | Fetches from OpenStreetMap Overpass API onto Leaflet map + list; last results remain viewable offline. |
| **Haptic Vibration (`navigator.vibrate`)** | Android Chromium | Supported on Android browsers; iOS Safari silences web vibration (audio & visual strobes remain active). |

### Requires Native Wrapper (Capacitor / Android / iOS Plugin)

| Feature | Why Native Wrapper Is Required | Exact Hook Location in Codebase |
| :--- | :--- | :--- |
| **True Hardware Power-Button Multi-Press (3+ clicks with screen locked)** | Mobile browsers block web pages from reading hardware power-button events or running listeners while the OS is locked. | `src/services/TriggerService.ts` (`attachCapacitorPowerPlugin()` -> `Capacitor.Plugins.SafeHerPowerButton` event `hardwarePowerMultiPress`). Implement an Android foreground service + `BroadcastReceiver` for `Intent.ACTION_SCREEN_ON` / `ACTION_SCREEN_OFF`. |
| **Silent Background SMS Sending (Zero tap in OS SMS app)** | Web apps can open `sms:` links pre-filled for all contacts, but cannot transmit cellular SMS silently without Android `SEND_SMS` permission. | `src/services/SmsAlertService.ts` (`SmsAlertService.registerNativeAdapter(...)` implementing `NativeSmsTransportAdapter.sendSilentSms`). |
| **Background Shake Detection & Background Location When App Is Closed** | Browsers suspend `DeviceMotionEvent` and throttle `watchPosition` when minimized or screen-locked. | Wrap with Capacitor using `@capacitor/geolocation` background service and native Android sensor service routing into `ShakeService` / `LocationService`. |

## Running Locally

```bash
npm install
npm run dev
```

App runs on `http://localhost:3000`.
