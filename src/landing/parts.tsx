import { useEffect } from 'react';
import { Logo } from '../components/Logo.tsx';
import { GUIDES } from '../content/guides.ts';
import { site } from '../content/site.ts';

/** Pieces the landing page and the page for institutions share. */

/** Lenis smooth scrolling, on desktops with a mouse, unless motion is turned down. */
export function useSmoothScroll() {
  useEffect(() => {
    if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let stop = () => {};
    void import('lenis').then(({ default: Lenis }) => {
      const lenis = new Lenis({ duration: 1.1, smoothWheel: true, anchors: { offset: -72 } });
      let frame = 0;
      const raf = (time: number) => {
        lenis.raf(time);
        frame = requestAnimationFrame(raf);
      };
      frame = requestAnimationFrame(raf);
      stop = () => {
        cancelAnimationFrame(frame);
        lenis.destroy();
      };
    });
    return () => stop();
  }, []);
}

export function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SectionHead({ kicker, title, lead, id }: { kicker: string; title: React.ReactNode; lead?: string; id: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="l-kicker r-up">{kicker}</p>
      <h2 id={id} className="l-h2 r-up" style={{ ['--d' as string]: '0.06s' }}>
        {title}
      </h2>
      {lead && (
        <p className="l-sublead r-up" style={{ ['--d' as string]: '0.12s' }}>
          {lead}
        </p>
      )}
    </div>
  );
}

/** The footer. [home] goes in front of the landing page's own links ("/" from another page). */
export function Footer({ home = '' }: { home?: string }) {
  return (
    <footer className="border-t border-line bg-white/60">
      <div className="l-wrap grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1.15fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-3">A calm place to study and really learn, with Chip, a tutor on your side. Made by Kaivon.</p>
        </div>
        <FooterCol title="Chip Study" links={[[`${home}#how`, 'How it works'], [`${home}#pricing`, 'Pricing'], [`${home}#faq`, 'FAQ'], ['/institutions', 'For institutions'], ['/signin', 'Sign in']]} />
        <FooterCol title="Study guides" links={GUIDES.map((g) => [`/guides/${g.slug}`, g.title.split(':')[0]])} />
        <FooterCol title="Kaivon" links={[[site.kaivon, 'kaivon.app'], [site.utopia, 'Utopia'], [`mailto:${site.email}`, site.email]]} />
        <FooterCol title="Legal" links={[['/terms', 'Terms of Service'], ['/privacy', 'Privacy Policy']]} />
      </div>
      <div className="l-wrap flex flex-wrap justify-between gap-2 border-t border-line py-6 text-sm text-ink-4">
        <span>© {site.year} Kaivon. All rights reserved.</span>
        <span>Chip can make mistakes. Check what matters.</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: string[][] }) {
  return (
    <div>
      <p className="text-sm font-semibold">{title}</p>
      <ul className="mt-3 space-y-2">
        {links.map(([href, label]) => (
          <li key={label}>
            <a href={href} className="text-sm text-ink-3 hover:text-ink">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
