import React, { useState } from 'react';

export function Checkout({ boot, api, refresh, go }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const track = boot.tracks.find(course => course.id === boot.user?.trackId);
  async function continueFree() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await api('/matchmaking', 'POST', {});
      await refresh();
      go(result.status === 'matched' ? `/squads/${result.squadId}` : '/matches');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  if (boot.currentSquadId) return <section className="panel narrow"><h1>Your squad is already reserved</h1><p>No payment is needed in this demo.</p><button className="primary" onClick={() => go(`/squads/${boot.currentSquadId}`)}>Open my squad</button></section>;
  if (!track) return <section className="panel narrow"><h1>Choose your course first</h1><p>Set your course and availability to see your sprint summary.</p><button className="primary" onClick={() => go('/start')}>Choose a course</button></section>;
  return <div className="checkout-page">
    <div className="page-heading"><div><p className="eyebrow">Your four-week sprint</p><h1>Review your course</h1><p>One course. One small squad. A clear next step.</p></div></div>
    <div className="grid two checkout-grid">
      <section className="panel"><p className="eyebrow">Selected course</p><h2>{track.title}</h2><p>{track.project}</p><ul className="checkout-includes"><li>Four weeks and eight practical lessons</li><li>A short quiz after each lesson</li><li>Four individual weekly assignments</li><li>A squad of 3–4 compatible learners</li><li>Eight scheduled peer meetings</li></ul><p className="muted">Peer learning, without an instructor. Weeks open on the squad’s schedule after you complete the earlier work.</p></section>
      <section className="panel checkout-summary"><h2>Order summary</h2><dl className="checkout-totals"><div><dt>Four-week sprint</dt><dd>$29.00</dd></div><div><dt>Demo access discount</dt><dd>−$29.00</dd></div><div className="checkout-total"><dt>Total today</dt><dd>$0.00 <small>USD</small></dd></div></dl><p className="notice"><strong>Demo checkout.</strong> Payments are not connected. No card is needed and no money will be charged.</p><p className="muted">$29 is the proposed launch price, not a charge today. No subscription or automatic renewal.</p>{error && <p className="notice error" role="alert">{error}</p>}<div className="stack checkout-actions"><button className="primary find-teammates-button" disabled={busy} onClick={continueFree}>{busy ? 'Finding your teammates…' : 'Continue for free'}</button><button disabled={busy} onClick={() => go('/start')}>Edit course or availability</button></div><p className="muted checkout-footnote">Continuing starts the search using your saved preferences. A team forms when at least three compatible learners are searching.</p></section>
    </div>
  </div>;
}
