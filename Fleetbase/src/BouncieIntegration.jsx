import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, KeyRound, LoaderCircle, MapPinned, Radio, Unplug } from 'lucide-react';
import { bouncieApi } from './bouncieApi';

const label = vehicle => vehicle.nickname || [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.vin || vehicle.imei || 'Bouncie vehicle';

export default function BouncieIntegration({ vehicles, notify }) {
  const [authenticated, setAuthenticated] = useState(null), [status, setStatus] = useState(null), [providerVehicles, setProviderVehicles] = useState([]);
  const [assignments, setAssignments] = useState({}), [credentials, setCredentials] = useState({ email: '', password: '' }), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = async () => {
    try {
      const session = await bouncieApi.session();
      setAuthenticated(session.authenticated);
      if (session.authenticated) setStatus(await bouncieApi.status());
    } catch (reason) { setError(reason.message); }
  };
  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('bouncie');
    if (!result) return;
    notify(result === 'connected' ? 'Bouncie connected successfully' : 'Bouncie authorization could not be completed');
    window.history.replaceState({}, '', window.location.pathname);
  }, [notify]);
  const autoAssignments = useMemo(() => Object.fromEntries(providerVehicles.map(provider => {
    const matched = provider.vin && vehicles.find(vehicle => String(vehicle.vin || '').toUpperCase() === provider.vin);
    return [provider.providerId, assignments[provider.providerId] || matched?.id || ''];
  })), [assignments, providerVehicles, vehicles]);
  const signIn = async () => {
    if (!credentials.email || !credentials.password) { setError('Enter the configured owner email and password.'); return; }
    setBusy(true); setError('');
    try { await bouncieApi.signIn(credentials.email, credentials.password); setAuthenticated(true); setStatus(await bouncieApi.status()); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const loadVehicles = async () => {
    setBusy(true); setError('');
    try { const result = await bouncieApi.vehicles(); setProviderVehicles(result.vehicles); if (!result.vehicles.length) notify('No Bouncie vehicles were returned'); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const saveMappings = async () => {
    const mappings = providerVehicles.map(provider => ({ vehicleId: autoAssignments[provider.providerId], vin: provider.vin, imei: provider.imei })).filter(mapping => mapping.vehicleId);
    setBusy(true); setError('');
    try { await bouncieApi.saveMappings(mappings); setStatus(current => ({ ...current, mappingCount: mappings.length })); notify(`Saved ${mappings.length} Bouncie vehicle mapping${mappings.length === 1 ? '' : 's'}`); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Bouncie? Existing location history will remain in Fleetbase.')) return;
    setBusy(true);
    try { await bouncieApi.disconnect(); setStatus(current => ({ ...current, connected: false })); setProviderVehicles([]); notify('Bouncie disconnected'); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };

  return <div className="bouncie-card"><div className="bouncie-heading"><span><Radio/></span><div><h3>Bouncie live tracking</h3><p>Secure OAuth connection, webhook locations, and VIN or device matching.</p></div>{status?.connected && <em><Check/>Connected</em>}</div>
    {authenticated === false && <div className="bouncie-login"><div><KeyRound/><span><b>Unlock server integrations</b><small>Use the owner credentials configured on your Fleetbase server. They are never stored in this browser.</small></span></div><div className="form-grid"><label>Owner email<input type="email" value={credentials.email} onChange={event=>setCredentials(current=>({...current,email:event.target.value}))}/></label><label>Owner password<input type="password" value={credentials.password} onChange={event=>setCredentials(current=>({...current,password:event.target.value}))} onKeyDown={event=>event.key==='Enter'&&signIn()}/></label></div><button className="button primary" type="button" onClick={signIn} disabled={busy}>{busy?<LoaderCircle className="spin"/>:<KeyRound/>}Unlock integrations</button></div>}
    {authenticated && status && !status.configured && <div className="bouncie-setup"><KeyRound/><div><b>Server credentials required</b><p>Add the Bouncie client ID, secret, redirect URI, webhook key, and Fleetbase encryption settings from <code>.env.example</code>.</p></div></div>}
    {authenticated && status?.configured && !status.connected && <div className="bouncie-connect"><div><MapPinned/><span><b>Connect your Bouncie account</b><small>You will approve Fleetbase on Bouncie. Access and refresh tokens stay encrypted on the server.</small></span></div><a className="button primary" href="/api/bouncie/connect">Connect Bouncie <ExternalLink/></a></div>}
    {authenticated && status?.connected && <><div className="bouncie-status-grid"><div><small>Vehicle mappings</small><b>{status.mappingCount || 0}</b></div><div><small>Last event</small><b>{status.lastEventAt ? new Date(status.lastEventAt).toLocaleString() : 'Waiting for drive data'}</b></div><div><small>Event type</small><b>{status.lastEventType || '—'}</b></div></div><div className="bouncie-actions"><button className="button primary" type="button" onClick={loadVehicles} disabled={busy}>{busy?<LoaderCircle className="spin"/>:<Radio/>}Load Bouncie vehicles</button><button className="button ghost" type="button" onClick={disconnect} disabled={busy}><Unplug/>Disconnect</button></div></>}
    {providerVehicles.length > 0 && <div className="bouncie-mappings"><div><h4>Match vehicles</h4><p>VIN matches are selected automatically. Confirm each Bouncie device’s Fleetbase vehicle.</p></div>{providerVehicles.map(provider=><label key={provider.providerId}><span><b>{label(provider)}</b><small>{provider.vin ? `VIN ${provider.vin}` : `Device ${provider.imei || provider.providerId}`}</small></span><select value={autoAssignments[provider.providerId]} onChange={event=>setAssignments(current=>({...current,[provider.providerId]:event.target.value}))}><option value="">Not mapped</option>{vehicles.map(vehicle=><option key={vehicle.id} value={vehicle.id}>{vehicle.name}{vehicle.plate?` · ${vehicle.plate}`:''}</option>)}</select></label>)}<button type="button" className="button primary" onClick={saveMappings} disabled={busy}>Save vehicle mappings</button></div>}
    {error && <div className="form-error">{error}</div>}
  </div>;
}

export function BouncieLocationSync({ setTracking }) {
  useEffect(() => {
    let cancelled = false, timer;
    const sync = async () => {
      try {
        const session = await bouncieApi.session();
        if (!session.authenticated) return;
        const { points } = await bouncieApi.locations('');
        if (cancelled || !points.length) return;
        setTracking(current => {
          const existing = new Set(current.map(point => point.id));
          const additions = points.filter(point => !existing.has(point.id));
          return additions.length ? [...current, ...additions] : current;
        });
      } catch { /* Integration may be unconfigured or signed out. */ }
    };
    sync();
    timer = window.setInterval(sync, 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [setTracking]);
  return null;
}
