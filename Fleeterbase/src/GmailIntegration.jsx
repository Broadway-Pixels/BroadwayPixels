import { useEffect, useMemo, useState } from 'react';
import { Check, ExternalLink, Inbox, LoaderCircle, Mail, RefreshCw, Unplug } from 'lucide-react';
import { gmailApi } from './bouncieApi';

export default function GmailIntegration({ onImport, notify }) {
  const [authenticated, setAuthenticated] = useState(null), [status, setStatus] = useState(null), [months, setMonths] = useState('6');
  const [candidates, setCandidates] = useState([]), [selected, setSelected] = useState(new Set()), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = async () => {
    try {
      const session = await gmailApi.session();
      setAuthenticated(session.authenticated);
      if (session.authenticated) setStatus(await gmailApi.status());
    } catch (reason) { setError(reason.message); }
  };
  useEffect(() => {
    refresh();
  }, []);
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('gmail');
    if (!result) return;
    notify(result === 'connected' ? 'Gmail connected successfully' : 'Gmail authorization could not be completed');
    window.history.replaceState({}, '', window.location.pathname);
  }, [notify]);
  const ready = useMemo(() => candidates.filter(candidate => candidate.ready), [candidates]);
  const scan = async () => {
    setBusy(true); setError('');
    try {
      const result = await gmailApi.scan(Number(months));
      setCandidates(result.candidates);
      setSelected(new Set(result.candidates.filter(candidate => candidate.ready).map(candidate => candidate.messageId)));
      notify(`Found ${result.candidates.length} Turo email${result.candidates.length === 1 ? '' : 's'}`);
    } catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };
  const toggle = id => setSelected(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const importSelected = () => {
    const records = ready.filter(candidate => selected.has(candidate.messageId));
    if (!records.length) { setError('Select at least one complete trip.'); return; }
    onImport(records);
    setCandidates([]); setSelected(new Set());
  };
  const disconnect = async () => {
    if (!window.confirm('Disconnect Gmail? Fleeterbase will keep trips you already imported.')) return;
    setBusy(true); setError('');
    try { await gmailApi.disconnect(); setStatus({ configured: status?.configured, connected: false }); setCandidates([]); notify('Gmail disconnected'); }
    catch (reason) { setError(reason.message); }
    finally { setBusy(false); }
  };

  return <div className="gmail-card"><div className="gmail-heading"><span><Mail/></span><div><h3>Turo email import</h3><p>Find reservation emails in Gmail and review the trips before importing.</p></div>{status?.connected ? <em><Check/>Connected</em> : null}</div>
    {authenticated === false ? <div className="gmail-notice"><Inbox/><span><b>Sign in required</b><small>Sign in to your Fleeterbase workspace before connecting Gmail.</small></span></div> : null}
    {authenticated && status && !status.configured ? <div className="gmail-notice warning"><Mail/><span><b>Google OAuth settings required</b><small>Add the Google client ID, secret, and callback URL from <code>.env.example</code>.</small></span></div> : null}
    {authenticated && status?.configured && !status.connected ? <div className="gmail-connect"><div><Inbox/><span><b>Connect Gmail read-only</b><small>Fleeterbase searches for Turo messages and extracts trip details. It cannot send, modify, or delete mail, and the OAuth connection belongs only to this workspace.</small></span></div><a className="button primary" href="/api/gmail/connect">Connect Gmail <ExternalLink/></a></div> : null}
    {authenticated && status?.connected ? <><div className="gmail-account"><div><small>Connected inbox</small><b>{status.email || 'Google account'}</b></div>{status.lastScanAt ? <div><small>Last scan</small><b>{new Date(status.lastScanAt).toLocaleString()}</b></div> : null}</div><div className="gmail-scan"><label>Search period<select value={months} onChange={event=>setMonths(event.target.value)}><option value="1">Last month</option><option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last year</option><option value="24">Last 2 years</option></select></label><button type="button" className="button primary" onClick={scan} disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <RefreshCw/>}{busy ? 'Scanning Gmail…' : 'Find Turo emails'}</button><button type="button" className="button ghost" onClick={disconnect} disabled={busy}><Unplug/>Disconnect</button></div></> : null}
    {candidates.length ? <div className="gmail-results"><div><h4>Review email trips</h4><p>{ready.length} complete · {candidates.length - ready.length} need details that were not present in the email.</p></div><div className="gmail-result-list">{candidates.map(candidate=><label className={!candidate.ready?'incomplete':''} key={candidate.messageId}><input type="checkbox" checked={selected.has(candidate.messageId)} disabled={!candidate.ready} onChange={()=>toggle(candidate.messageId)}/><span><b>{candidate.guest || 'Guest not found'} · {candidate.vehicleName || 'Vehicle not found'}</b><small>{candidate.start || 'No pickup date'} → {candidate.end || 'No return date'} · {candidate.subject}</small>{candidate.issues.length ? <i>Missing: {candidate.issues.join(', ')}</i> : null}</span><strong>${Number(candidate.price || 0).toLocaleString()}</strong></label>)}</div><button type="button" className="button primary" onClick={importSelected}>Import {ready.filter(candidate=>selected.has(candidate.messageId)).length} selected trips</button></div> : null}
    {error ? <div className="form-error">{error}</div> : null}
  </div>;
}
