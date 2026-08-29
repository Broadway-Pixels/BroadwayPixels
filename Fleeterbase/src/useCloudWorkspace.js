import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudApi } from './cloudApi';

const cacheKeys = {
  profile: ['fleeterbase-profile-v4', 'fleetbase-profile-v4'],
  prefs: ['fleeterbase-prefs-v4', 'fleetbase-prefs-v4'],
  vehicles: ['fleeterbase-vehicles-v4', 'fleetbase-vehicles-v4'],
  reservations: ['fleeterbase-reservations-v4', 'fleetbase-reservations-v4'],
  tracking: ['fleeterbase-tracking-v4', 'fleetbase-tracking-v4'],
};

function cached(name, fallback) {
  try {
    for (const key of cacheKeys[name]) {
      const value = localStorage.getItem(key);
      if (value) return JSON.parse(value);
    }
  } catch { /* A malformed legacy cache should not prevent sign-in. */ }
  return fallback;
}

function clearLegacyCredentials() {
  localStorage.removeItem('fleeterbase-account-v4');
  localStorage.removeItem('fleetbase-account-v4');
  sessionStorage.removeItem('fleeterbase-session-v4');
  sessionStorage.removeItem('fleetbase-session-v4');
}

export default function useCloudWorkspace(defaultProfile, defaultPrefs) {
  const [profile, setProfile] = useState(() => cached('profile', defaultProfile));
  const [prefs, setPrefs] = useState(() => cached('prefs', defaultPrefs));
  const [vehicles, setVehicles] = useState(() => cached('vehicles', []));
  const [reservations, setReservations] = useState(() => cached('reservations', []));
  const [tracking, setTracking] = useState(() => cached('tracking', []));
  const [session, setSession] = useState(null), [syncStatus, setSyncStatus] = useState('Checking account…');
  const versionRef = useRef(1), lastSavedRef = useRef(''), saveQueueRef = useRef(Promise.resolve());

  const hydrate = useCallback(cloudWorkspace => {
    const data = cloudWorkspace.data;
    versionRef.current = cloudWorkspace.version;
    lastSavedRef.current = JSON.stringify(data);
    setProfile({ ...defaultProfile, ...data.profile });
    setPrefs({ ...defaultPrefs, ...data.prefs });
    setVehicles(data.vehicles);
    setReservations(data.reservations);
    setTracking(data.tracking);
  }, [defaultPrefs, defaultProfile]);

  useEffect(() => {
    let cancelled = false;
    cloudApi.session().then(result => {
      if (cancelled) return;
      if (result.authenticated) {
        hydrate(result.workspace);
        clearLegacyCredentials();
        setSession(true); setSyncStatus('Saved to cloud');
      } else {
        clearLegacyCredentials();
        setSession(false); setSyncStatus('Sign in to sync');
      }
    }).catch(() => {
      if (!cancelled) { setSession(false); setSyncStatus('Cloud unavailable'); }
    });
    return () => { cancelled = true; };
  }, [hydrate]);

  useEffect(() => {
    for (const [name, value] of Object.entries({ profile, prefs, vehicles, reservations, tracking })) {
      try { localStorage.setItem(cacheKeys[name][0], JSON.stringify(value)); }
      catch { /* Cloud sync remains authoritative when browser storage is full or unavailable. */ }
    }
    if (session !== true) return undefined;
    const workspace = { profile, prefs, vehicles, reservations, tracking }, serialized = JSON.stringify(workspace);
    if (serialized === lastSavedRef.current) return undefined;
    setSyncStatus('Saving…');
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const result = await cloudApi.saveWorkspace(workspace, versionRef.current);
      versionRef.current = result.version;
      lastSavedRef.current = serialized;
      setSyncStatus('Saved to cloud');
    }).catch(error => {
      if (error.status === 409 && error.payload?.workspace) {
        hydrate(error.payload.workspace);
        setSyncStatus('Updated from another device');
      } else setSyncStatus('Sync needs attention');
    });
    return undefined;
  }, [hydrate, prefs, profile, reservations, session, tracking, vehicles]);

  const register = async (email, password, workspace) => {
    setSyncStatus('Creating cloud workspace…');
    const result = await cloudApi.register(email, password, workspace);
    if (result.verificationRequired) {
      setSession(false); setSyncStatus('Verify your email');
      return result;
    }
    hydrate(result.workspace); clearLegacyCredentials(); setSession(true); setSyncStatus('Saved to cloud');
    return result;
  };

  const login = async (email, password) => {
    setSyncStatus('Signing in…');
    const result = await cloudApi.login(email, password);
    hydrate(result.workspace); clearLegacyCredentials(); setSession(true); setSyncStatus('Saved to cloud');
  };

  const logout = async () => {
    await saveQueueRef.current;
    await cloudApi.logout();
    lastSavedRef.current = '';
    setProfile(defaultProfile); setPrefs(defaultPrefs); setVehicles([]); setReservations([]); setTracking([]);
    setSession(false); setSyncStatus('Sign in to sync');
  };

  return {
    session, syncStatus, profile, setProfile, prefs, setPrefs, vehicles, setVehicles,
    reservations, setReservations, tracking, setTracking, register, login, logout,
  };
}
