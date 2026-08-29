import { useEffect, useState } from 'react';
import { Check, CircleDollarSign, ExternalLink, LoaderCircle } from 'lucide-react';
import { billingApi } from './billingApi';

export default function BillingIntegration({ billing, setBilling, notify }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('billing');
    if (!result) return;
    notify(result === 'success' ? 'Pro checkout completed. Your plan will update shortly.' : 'Checkout canceled');
    window.history.replaceState({}, '', window.location.pathname);
    billingApi.status().then(setBilling).catch(reason => setError(reason.message));
  }, [notify, setBilling]);
  const open = async action => {
    setBusy(true); setError('');
    try { const result = await billingApi[action](); window.location.assign(result.url); }
    catch (reason) { setError(reason.message); setBusy(false); }
  };
  if (!billing) return null;
  return <div className="billing-card"><div><span><CircleDollarSign/></span><div><h3>Fleeterbase plan</h3><p>Free includes three vehicles. Pro unlocks unlimited fleet records for $19/month.</p></div><em className={billing.pro ? 'active' : ''}>{billing.pro ? <><Check/>Pro</> : 'Free'}</em></div>
    {!billing.configured ? <div className="gmail-notice warning"><CircleDollarSign/><span><b>Stripe setup required</b><small>Add the Stripe secret key, webhook signing secret, and Pro price ID to Cloudflare.</small></span></div> : null}
    {billing.configured ? <div className="billing-actions"><div><small>Current plan</small><b>{billing.pro ? 'Pro · Unlimited vehicles' : 'Free · Up to 3 vehicles'}</b>{billing.currentPeriodEnd ? <span>{billing.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {new Date(billing.currentPeriodEnd).toLocaleDateString()}</span> : null}</div><button type="button" className="button primary" disabled={busy} onClick={()=>open(billing.customerId ? 'portal' : 'checkout')}>{busy ? <LoaderCircle className="spin"/> : <ExternalLink/>}{billing.customerId ? 'Manage billing' : 'Upgrade to Pro'}</button></div> : null}
    {error ? <div className="form-error">{error}</div> : null}
  </div>;
}
