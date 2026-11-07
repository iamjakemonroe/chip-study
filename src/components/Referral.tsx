import { Copy, Gift, Share2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { copyText } from '../institution/copy.ts';
import { myReferral } from '../lib/api.ts';
import { referralLink } from '../lib/referral.ts';
import type { MyReferral } from '../lib/types.ts';
import { useAuth } from '../store/auth.ts';

const HIDDEN = 'chip-study-referral-hidden';

/** The account's invite link and how it's going (asking also gives any weeks now due). */
function useReferral(): MyReferral | null {
  const tier = useAuth((s) => s.me?.tier);
  const [r, setR] = useState<MyReferral | null>(null);
  useEffect(() => {
    if (!tier || tier === 'guest') return;
    myReferral()
      .then(setR)
      .catch(() => undefined);
  }, [tier]);
  return r;
}

async function share(link: string) {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Chip Study', text: 'Study with me on Chip Study. We both get a week of Pro.', url: link });
      return;
    } catch {
      // Closed, or not allowed: copy instead.
    }
  }
  await copyText(link, 'Copied your invite link.');
}

/** On the desk: a slim line to invite a friend, until it's put away. */
export function ReferralStrip() {
  const r = useReferral();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDDEN) === '1';
    } catch {
      return false;
    }
  });
  if (!r || hidden) return null;
  const link = referralLink(r.code);
  return (
    <section className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white/70 py-2.5 pl-3 pr-2 text-sm" aria-label="Invite a friend">
      <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-peach-soft text-peach">
        <Gift size={16} />
      </span>
      <p className="min-w-0 flex-1 basis-56 leading-snug text-ink-2">
        <span className="font-semibold text-ink">Invite a friend.</span> You both get a week of Pro once they’ve asked Chip 3 questions.
      </p>
      <div className="flex flex-none items-center gap-1">
        <button className="btn btn-ghost btn-sm" onClick={() => void share(link)}>
          <Share2 size={14} /> Share your link
        </button>
        <button
          className="icon-btn"
          aria-label="Hide this"
          title="Hide this"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(HIDDEN, '1');
            } catch {
              // Shown again next time.
            }
          }}
        >
          <X size={16} />
        </button>
      </div>
    </section>
  );
}

/** In Settings: the link, sharing it, and how it's going against the yearly limit. */
export function ReferralSection() {
  const r = useReferral();
  if (!r) return <div className="skeleton h-24" />;
  const link = referralLink(r.code);
  const left = Math.max(0, r.cap - r.weeks_this_year);
  return (
    <div>
      <p className="text-sm leading-relaxed text-ink-3">
        Share your link. When a friend signs up with it and asks Chip 3 questions, you each get a week of Chip Study Pro, up to {r.cap} weeks a year for you.
      </p>
      <div className="mt-3 flex items-center gap-2 rounded-2xl bg-paper px-3 py-2">
        <code className="min-w-0 flex-1 truncate font-mono text-sm text-ink">{link}</code>
        <button className="btn btn-ghost btn-sm flex-none" onClick={() => void copyText(link, 'Copied your invite link.')}>
          <Copy size={14} /> Copy
        </button>
        <button className="icon-btn flex-none" aria-label="Share your invite link" title="Share" onClick={() => void share(link)}>
          <Share2 size={16} />
        </button>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ['Signed up', r.invited],
          ['Used it', r.active],
          ['Weeks this year', `${r.weeks_this_year} of ${r.cap}`],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl bg-paper px-2 py-2.5">
            <dd className="text-lg font-semibold">{value}</dd>
            <dt className="text-xs text-ink-3">{label}</dt>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-ink-3">
        {left === 0 ? `You’ve had this year’s ${r.cap} weeks. Friends still get theirs.` : `${left} more week${left === 1 ? '' : 's'} of Pro to earn this year.`}
        {r.rep && ` You’re a campus rep: ${r.rep}.`}
      </p>
      {r.referred_by && (
        <p className="mt-2 text-sm text-ink-3">
          You joined through {r.referred_by}. {r.my_week === 'given' ? 'Your week of Pro is yours.' : 'Your week of Pro comes once you’ve asked Chip 3 questions.'}
        </p>
      )}
    </div>
  );
}
