import express from 'express';
import type {Request, Response} from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import {fileURLToPath} from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface LocationPoint {
  lat: number;
  lng: number;
  accuracy?: number;
  speed?: number | null;
  timestamp: number;
}

interface LiveTrackingSession {
  id: string;
  userId?: string;
  userName: string;
  mode: 'sos' | 'live';
  active: boolean;
  startedAt: number;
  expiresAt: number | null;
  updatedAt: number;
  currentLocation: LocationPoint | null;
  trail: LocationPoint[];
  contactsNotified: number;
  triggerSource?: string;
  recipientGuardianIds: string[];
  recipientPhones: string[];
}

interface DispatchedAlert {
  id: string;
  sessionId: string;
  userName: string;
  mode: 'sos' | 'live';
  message: string;
  trackingUrl: string;
  mapsUrl: string;
  contacts: Array<{
    name: string;
    phone: string;
    normalizedPhone: string;
    relationship: string;
    guardianId?: string;
  }>;
  dispatchedAt: number;
}

interface GuardianPairing {
  guardianId: string;
  userId: string;
  userName: string;
  contactName: string;
  contactPhone: string;
  normalizedPhone: string;
  relationship: string;
  updatedAt: number;
}

interface GuardianSseClient {
  id: string;
  res: Response;
  guardianId: string | null;
  normalizedPhone: string | null;
  sessionId: string | null;
}

function normalizePhone(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length > 10) {
    return digits.slice(-10);
  }
  return digits;
}

const DATA_DIR = path.join(__dirname, '.runtime-data');
const SESSIONS_FILE = path.join(DATA_DIR, 'tracking-sessions.json');
const GUARDIANS_FILE = path.join(DATA_DIR, 'guardian-pairings.json');
const ALERTS_FILE = path.join(DATA_DIR, 'dispatched-alerts.json');

const sessions = new Map<string, LiveTrackingSession>();
const guardianPairings = new Map<string, GuardianPairing>();
const dispatchedAlerts: DispatchedAlert[] = [];
const sseClients = new Set<GuardianSseClient>();

function loadPersistedState(): void {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, LiveTrackingSession>;
      for (const [key, val] of Object.entries(parsed)) {
        sessions.set(key, {
          ...val,
          currentLocation: val.currentLocation ?? null,
          trail: Array.isArray(val.trail) ? val.trail : [],
          recipientGuardianIds: Array.isArray(val.recipientGuardianIds)
            ? val.recipientGuardianIds
            : [],
          recipientPhones: Array.isArray(val.recipientPhones) ? val.recipientPhones : [],
        });
      }
    }
    if (fs.existsSync(GUARDIANS_FILE)) {
      const rawG = fs.readFileSync(GUARDIANS_FILE, 'utf-8');
      const parsedG = JSON.parse(rawG) as Record<string, GuardianPairing>;
      for (const [key, val] of Object.entries(parsedG)) {
        guardianPairings.set(key, val);
      }
    }
    if (fs.existsSync(ALERTS_FILE)) {
      const rawA = fs.readFileSync(ALERTS_FILE, 'utf-8');
      const parsedA = JSON.parse(rawA) as DispatchedAlert[];
      if (Array.isArray(parsedA)) {
        dispatchedAlerts.push(...parsedA.slice(0, 100));
      }
    }
  } catch {
    // Continue with clean in-memory maps if persistence files are unreadable
  }
}

function savePersistedState(): void {
  try {
    fs.mkdirSync(DATA_DIR, {recursive: true});
    const sessObj: Record<string, LiveTrackingSession> = {};
    for (const [k, v] of sessions.entries()) {
      sessObj[k] = v;
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessObj), 'utf-8');

    const guardObj: Record<string, GuardianPairing> = {};
    for (const [k, v] of guardianPairings.entries()) {
      guardObj[k] = v;
    }
    fs.writeFileSync(GUARDIANS_FILE, JSON.stringify(guardObj), 'utf-8');
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(dispatchedAlerts.slice(0, 100)), 'utf-8');
  } catch {
    // Non-fatal in read-only environments
  }
}

loadPersistedState();

function countActiveViewersForSession(session: LiveTrackingSession): number {
  let count = 0;
  for (const client of sseClients) {
    const matchesSession = client.sessionId === session.id;
    const matchesGuardian =
      client.guardianId !== null &&
      session.recipientGuardianIds.includes(client.guardianId);
    const matchesPhone =
      client.normalizedPhone !== null &&
      client.normalizedPhone.length >= 7 &&
      session.recipientPhones.includes(client.normalizedPhone);
    if (matchesSession || matchesGuardian || matchesPhone) {
      count += 1;
    }
  }
  return count;
}

function findLatestSessionForGuardian(
  guardianId: string | null,
  normalizedPhone: string | null,
): LiveTrackingSession | null {
  let best: LiveTrackingSession | null = null;
  for (const sess of sessions.values()) {
    if (sess.active && sess.expiresAt && Date.now() > sess.expiresAt) {
      sess.active = false;
    }
    const matchedById =
      Boolean(guardianId) && sess.recipientGuardianIds.includes(guardianId!);
    const matchedByPhone =
      Boolean(normalizedPhone) &&
      normalizedPhone!.length >= 7 &&
      sess.recipientPhones.includes(normalizedPhone!);

    if (matchedById || matchedByPhone) {
      if (
        !best ||
        (sess.active && !best.active) ||
        sess.updatedAt > best.updatedAt
      ) {
        best = sess;
      }
    }
  }
  return best;
}

function broadcastSessionToSubscribers(
  eventType: 'sos_alert' | 'session_update',
  session: LiveTrackingSession,
): void {
  const payload = JSON.stringify({
    session: {
      ...session,
      activeViewers: countActiveViewersForSession(session),
    },
    timestamp: Date.now(),
  });

  for (const client of sseClients) {
    const matchesSession = client.sessionId === session.id;
    const matchesGuardian =
      client.guardianId !== null &&
      session.recipientGuardianIds.includes(client.guardianId);
    const matchesPhone =
      client.normalizedPhone !== null &&
      client.normalizedPhone.length >= 7 &&
      session.recipientPhones.includes(client.normalizedPhone);

    if (matchesSession || matchesGuardian || matchesPhone) {
      try {
        client.res.write(`event: ${eventType}\ndata: ${payload}\n\n`);
      } catch {
        sseClients.delete(client);
      }
    }
  }
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({limit: '256kb'}));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ok: true, timestamp: Date.now()});
  });

  // Pre-pair trusted contacts so SOS & live location auto-push with zero Send prompt
  app.post('/api/guardian/sync', (req: Request, res: Response) => {
    const {userId, userName, contacts} = req.body ?? {};
    if (!Array.isArray(contacts)) {
      res.status(400).json({error: 'contacts array required'});
      return;
    }

    const synced: GuardianPairing[] = [];
    for (const c of contacts) {
      const guardianId = String(c.guardianId || '').trim();
      const contactPhone = String(c.phone || '').trim();
      const normalized = normalizePhone(contactPhone);
      if (!guardianId || !normalized) continue;

      const pairing: GuardianPairing = {
        guardianId,
        userId: String(userId || 'default'),
        userName: String(userName || 'Safe Her User'),
        contactName: String(c.name || 'Trusted Contact'),
        contactPhone,
        normalizedPhone: normalized,
        relationship: String(c.relationship || 'Trusted Contact'),
        updatedAt: Date.now(),
      };
      guardianPairings.set(guardianId, pairing);
      synced.push(pairing);
    }

    savePersistedState();
    res.json({synced: synced.length});
  });

  // Lookup Guardian pairing + any active SOS / Live Location session
  app.get('/api/guardian/status', (req: Request, res: Response) => {
    const guardianId = req.query.guardianId ? String(req.query.guardianId).trim() : null;
    const rawPhone = req.query.phone ? String(req.query.phone).trim() : null;
    const normalized = rawPhone ? normalizePhone(rawPhone) : null;

    let pairing: GuardianPairing | null = null;
    if (guardianId && guardianPairings.has(guardianId)) {
      pairing = guardianPairings.get(guardianId) || null;
    } else if (normalized && normalized.length >= 7) {
      for (const p of guardianPairings.values()) {
        if (p.normalizedPhone === normalized) {
          pairing = p;
          break;
        }
      }
    }

    const effectiveGuardianId = pairing?.guardianId || guardianId;
    const effectivePhone = pairing?.normalizedPhone || normalized;
    const activeOrLatestSession = findLatestSessionForGuardian(
      effectiveGuardianId,
      effectivePhone,
    );

    res.json({
      pairing,
      session: activeOrLatestSession
        ? {
            ...activeOrLatestSession,
            activeViewers: countActiveViewersForSession(activeOrLatestSession),
          }
        : null,
    });
  });

  // Real-Time Server-Sent Events (SSE) stream for Trusted Contacts & Live Map Viewers
  app.get('/api/guardian/stream', (req: Request, res: Response) => {
    const guardianId = req.query.guardianId ? String(req.query.guardianId).trim() : null;
    const rawPhone = req.query.phone ? String(req.query.phone).trim() : null;
    const sessionId = req.query.sessionId ? String(req.query.sessionId).trim() : null;

    let normalizedPhone = rawPhone ? normalizePhone(rawPhone) : null;
    if (!normalizedPhone && guardianId && guardianPairings.has(guardianId)) {
      normalizedPhone = guardianPairings.get(guardianId)!.normalizedPhone;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const client: GuardianSseClient = {
      id: `sse_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      res,
      guardianId,
      normalizedPhone,
      sessionId,
    };
    sseClients.add(client);

    // Immediately push current state upon connection
    const initialSession = sessionId
      ? sessions.get(sessionId) || null
      : findLatestSessionForGuardian(guardianId, normalizedPhone);

    const pairing = guardianId ? guardianPairings.get(guardianId) || null : null;
    res.write(
      `event: init\ndata: ${JSON.stringify({
        pairing,
        session: initialSession
          ? {
              ...initialSession,
              activeViewers: countActiveViewersForSession(initialSession),
            }
          : null,
      })}\n\n`,
    );

    const keepAlive = setInterval(() => {
      try {
        res.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
        sseClients.delete(client);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(client);
    });
  });

  // Create or update a live location tracking session (auto-pushes to all paired contacts)
  app.post('/api/tracking/:id', (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    if (!id || id.length > 64) {
      res.status(400).json({error: 'Invalid tracking session ID'});
      return;
    }

    const {
      userId,
      userName,
      mode,
      active,
      expiresAt,
      location,
      contactsNotified,
      triggerSource,
      recipientGuardianIds,
      recipientPhones,
    } = req.body ?? {};

    const existing = sessions.get(id);

    if (active === false && existing) {
      existing.active = false;
      existing.updatedAt = Date.now();
      sessions.set(id, existing);
      savePersistedState();
      broadcastSessionToSubscribers('session_update', existing);
      res.json({
        session: {
          ...existing,
          activeViewers: countActiveViewersForSession(existing),
        },
      });
      return;
    }

    const hasValidPoint =
      Boolean(location) &&
      typeof location.lat === 'number' &&
      !Number.isNaN(location.lat) &&
      typeof location.lng === 'number' &&
      !Number.isNaN(location.lng);

    const point: LocationPoint | null = hasValidPoint
      ? {
          lat: location.lat,
          lng: location.lng,
          accuracy: typeof location.accuracy === 'number' ? location.accuracy : undefined,
          speed: typeof location.speed === 'number' ? location.speed : null,
          timestamp: typeof location.timestamp === 'number' ? location.timestamp : Date.now(),
        }
      : null;

    const normalizedIncomingPhones = Array.isArray(recipientPhones)
      ? recipientPhones.map((p: unknown) => normalizePhone(String(p))).filter(Boolean)
      : [];
    const incomingGuardianIds = Array.isArray(recipientGuardianIds)
      ? recipientGuardianIds.map((g: unknown) => String(g).trim()).filter(Boolean)
      : [];

    if (existing) {
      if (point) {
        existing.currentLocation = point;
        const last = existing.trail[existing.trail.length - 1];
        const movedEnough =
          !last ||
          Math.abs(last.lat - point.lat) > 0.00003 ||
          Math.abs(last.lng - point.lng) > 0.00003 ||
          point.timestamp - last.timestamp > 10000;
        if (movedEnough) {
          existing.trail = [...existing.trail.slice(-119), point];
        }
      }
      existing.updatedAt = Date.now();
      if (typeof active === 'boolean') existing.active = active;
      if (mode === 'sos' || mode === 'live') existing.mode = mode;
      if (typeof userName === 'string' && userName.trim()) {
        existing.userName = userName.trim();
      }
      if (typeof triggerSource === 'string' && triggerSource.trim()) {
        existing.triggerSource = triggerSource.trim();
      }
      if (expiresAt !== undefined) existing.expiresAt = expiresAt;
      if (typeof contactsNotified === 'number') {
        existing.contactsNotified = contactsNotified;
      }
      if (incomingGuardianIds.length > 0) {
        existing.recipientGuardianIds = Array.from(
          new Set([...existing.recipientGuardianIds, ...incomingGuardianIds]),
        );
      }
      if (normalizedIncomingPhones.length > 0) {
        existing.recipientPhones = Array.from(
          new Set([...existing.recipientPhones, ...normalizedIncomingPhones]),
        );
      }

      sessions.set(id, existing);
      savePersistedState();
      broadcastSessionToSubscribers('session_update', existing);
      res.json({
        session: {
          ...existing,
          activeViewers: countActiveViewersForSession(existing),
        },
      });
      return;
    }

    const created: LiveTrackingSession = {
      id,
      userId: typeof userId === 'string' ? userId : undefined,
      userName:
        typeof userName === 'string' && userName.trim() ? userName.trim() : 'Safe Her User',
      mode: mode === 'sos' ? 'sos' : 'live',
      active: active !== false,
      startedAt: Date.now(),
      expiresAt: typeof expiresAt === 'number' ? expiresAt : null,
      updatedAt: Date.now(),
      currentLocation: point,
      trail: point ? [point] : [],
      contactsNotified: typeof contactsNotified === 'number' ? contactsNotified : 0,
      triggerSource: typeof triggerSource === 'string' ? triggerSource : undefined,
      recipientGuardianIds: incomingGuardianIds,
      recipientPhones: normalizedIncomingPhones,
    };

    sessions.set(id, created);
    savePersistedState();
    broadcastSessionToSubscribers(
      created.mode === 'sos' ? 'sos_alert' : 'session_update',
      created,
    );
    res.json({
      session: {
        ...created,
        activeViewers: countActiveViewersForSession(created),
      },
    });
  });

  // Read live tracking session for emergency contacts opening the shareable link
  app.get('/api/tracking/:id', (req: Request, res: Response) => {
    const id = String(req.params.id || '').trim();
    const session = sessions.get(id);
    if (!session) {
      res.status(404).json({error: 'Live tracking session not found or expired.'});
      return;
    }

    if (session.active && session.expiresAt && Date.now() > session.expiresAt) {
      session.active = false;
      sessions.set(id, session);
      savePersistedState();
    }

    res.json({
      session: {
        ...session,
        activeViewers: countActiveViewersForSession(session),
      },
    });
  });

  // Automated zero-click SOS & Live Location dispatch endpoint
  app.post('/api/alerts/dispatch', (req: Request, res: Response) => {
    const {
      sessionId,
      userId,
      userName,
      mode,
      expiresAt,
      triggerSource,
      location,
      message,
      trackingUrl,
      mapsUrl,
      contacts,
    } = req.body ?? {};
    if (!Array.isArray(contacts)) {
      res.status(400).json({error: 'Contacts array is required'});
      return;
    }

    const formattedContacts = contacts.map((c: Record<string, unknown>) => {
      const phone = String(c.phone || '');
      return {
        name: String(c.name || ''),
        phone,
        normalizedPhone: normalizePhone(phone),
        relationship: String(c.relationship || ''),
        guardianId: c.guardianId ? String(c.guardianId) : undefined,
      };
    });

    const alertMode: 'sos' | 'live' = mode === 'live' ? 'live' : 'sos';

    const record: DispatchedAlert = {
      id: `alrt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      sessionId: String(sessionId || ''),
      userName: String(userName || 'Safe Her User'),
      mode: alertMode,
      message: String(message || ''),
      trackingUrl: String(trackingUrl || ''),
      mapsUrl: String(mapsUrl || ''),
      contacts: formattedContacts,
      dispatchedAt: Date.now(),
    };

    dispatchedAlerts.unshift(record);
    if (dispatchedAlerts.length > 100) {
      dispatchedAlerts.pop();
    }

    const gIds = formattedContacts
      .map((c) => c.guardianId)
      .filter((x): x is string => Boolean(x));
    const phones = formattedContacts
      .map((c) => c.normalizedPhone)
      .filter((x) => x.length >= 7);

    // Ensure Guardian pairings exist even if initial sync hadn't completed
    for (const c of formattedContacts) {
      if (c.guardianId && c.normalizedPhone.length >= 7 && !guardianPairings.has(c.guardianId)) {
        guardianPairings.set(c.guardianId, {
          guardianId: c.guardianId,
          userId: String(userId || 'default'),
          userName: record.userName,
          contactName: c.name || 'Trusted Contact',
          contactPhone: c.phone,
          normalizedPhone: c.normalizedPhone,
          relationship: c.relationship || 'Trusted Contact',
          updatedAt: Date.now(),
        });
      }
    }

    const hasValidPoint =
      Boolean(location) &&
      typeof location.lat === 'number' &&
      !Number.isNaN(location.lat) &&
      typeof location.lng === 'number' &&
      !Number.isNaN(location.lng);

    const point: LocationPoint | null = hasValidPoint
      ? {
          lat: location.lat,
          lng: location.lng,
          accuracy: typeof location.accuracy === 'number' ? location.accuracy : undefined,
          speed: typeof location.speed === 'number' ? location.speed : null,
          timestamp: typeof location.timestamp === 'number' ? location.timestamp : Date.now(),
        }
      : null;

    // Create or update the linked tracking session atomically and broadcast immediately via SSE
    let linkedSession = record.sessionId ? sessions.get(record.sessionId) : undefined;
    if (!linkedSession && record.sessionId) {
      linkedSession = {
        id: record.sessionId,
        userId: typeof userId === 'string' ? userId : undefined,
        userName: record.userName,
        mode: alertMode,
        active: true,
        startedAt: Date.now(),
        expiresAt: typeof expiresAt === 'number' ? expiresAt : null,
        updatedAt: Date.now(),
        currentLocation: point,
        trail: point ? [point] : [],
        contactsNotified: formattedContacts.length,
        triggerSource: typeof triggerSource === 'string' ? triggerSource : undefined,
        recipientGuardianIds: gIds,
        recipientPhones: phones,
      };
    } else if (linkedSession) {
      linkedSession.recipientGuardianIds = Array.from(
        new Set([...linkedSession.recipientGuardianIds, ...gIds]),
      );
      linkedSession.recipientPhones = Array.from(
        new Set([...linkedSession.recipientPhones, ...phones]),
      );
      linkedSession.contactsNotified = formattedContacts.length;
      linkedSession.updatedAt = Date.now();
      if (point && !linkedSession.currentLocation) {
        linkedSession.currentLocation = point;
        linkedSession.trail = [point];
      }
    }

    if (linkedSession) {
      sessions.set(linkedSession.id, linkedSession);
      savePersistedState();
      broadcastSessionToSubscribers(
        linkedSession.mode === 'sos' ? 'sos_alert' : 'session_update',
        linkedSession,
      );
    } else {
      savePersistedState();
    }

    res.json({
      dispatched: true,
      alertId: record.id,
      recipientCount: record.contacts.length,
      dispatchedAt: record.dispatchedAt,
      activeViewers: linkedSession ? countActiveViewersForSession(linkedSession) : 0,
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const {createServer: createViteServer} = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: {server: httpServer},
        hmr: !disableHmr,
        watch: disableHmr ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Safe Her server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
