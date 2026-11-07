import { useEffect } from 'react';
import { useParams } from 'react-router';
import { Logo } from '../components/Logo.tsx';
import { Orb } from '../components/Orb.tsx';
import { GUIDES, GUIDES_UPDATED, guideBySlug, type Guide as GuideDoc } from '../content/guides.ts';
import { site } from '../content/site.ts';
import { NotFound } from '../pages/NotFound.tsx';
import '../styles/landing.css';
import { Arrow, Footer } from './parts.tsx';

/** A study guide: /guides/<slug>. Plain, careful advice with its sources, in the landing page's
 * look, with its own title, description and structured data for search. */
export function Guide() {
  const { slug } = useParams();
  const guide = guideBySlug(slug);
  useMeta(guide);
  if (!guide) return <NotFound />;
  const others = GUIDES.filter((g) => g.slug !== guide.slug);

  return (
    <div className="landing">
      <header className="l-nav is-scrolled">
        <div className="l-wrap flex h-16 items-center gap-4">
          <a href="/" aria-label="Chip Study home">
            <Logo />
          </a>
          <span className="hidden text-sm font-semibold text-ink-3 sm:inline">Study guides</span>
          <div className="ml-auto flex items-center gap-2">
            <a href="/signin" className="btn btn-quiet btn-sm hidden sm:inline-flex">
              Sign in
            </a>
            <a href="/signin" className="btn btn-primary btn-sm">
              Start free
            </a>
          </div>
        </div>
      </header>
      <main id="main" className="l-wrap max-w-3xl pb-20 pt-10 sm:pt-14">
        <article>
          <p className="l-kicker text-left">Study guide</p>
          <h1 className="mt-3 text-[2.25rem] font-semibold leading-[1.08] tracking-[-0.035em] text-ink sm:text-[3rem]">{guide.title}</h1>
          <p className="mt-5 text-lg leading-relaxed text-ink-2 sm:text-xl">{guide.lead}</p>
          <p className="mt-4 text-sm text-ink-3">
            {guide.minutes}-minute read · Updated {GUIDES_UPDATED} · By Kaivon
          </p>

          {guide.sections.map((s) => (
            <section key={s.heading} className="mt-11">
              <h2 className="text-[1.375rem] font-semibold leading-snug tracking-[-0.015em] sm:text-2xl">{s.heading}</h2>
              {s.body.map((b, i) =>
                typeof b === 'string' ? (
                  <p key={i} className="mt-4 text-[1.0625rem] leading-[1.75] text-ink-2">
                    {b}
                  </p>
                ) : Array.isArray(b) ? (
                  <ul key={i} className="mt-4 space-y-2.5">
                    {b.map((item) => (
                      <li key={item} className="l-tick text-[1.0625rem]">
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p key={i} className="mt-5 rounded-2xl border border-iris/15 bg-iris-soft/60 px-5 py-4 text-[1rem] leading-relaxed text-ink">
                    <strong className="font-semibold text-iris-2">Tip: </strong>
                    {b.tip}
                  </p>
                ),
              )}
            </section>
          ))}

          <aside className="mt-14 flex flex-col items-start gap-4 rounded-[1.75rem] border border-line bg-white p-6 shadow-[var(--shadow-soft)] sm:flex-row sm:items-center sm:p-7" aria-label="In Chip Study">
            <Orb size={44} />
            <div className="flex-1">
              <p className="font-semibold">In Chip Study</p>
              <p className="mt-1 leading-relaxed text-ink-2">{guide.inChipStudy}</p>
            </div>
            <a href="/signin" className="btn btn-iris flex-none">
              Start free <Arrow />
            </a>
          </aside>

          {guide.sources.length > 0 && (
            <section className="mt-12" aria-labelledby="sources-title">
              <h2 id="sources-title" className="text-sm font-semibold uppercase tracking-[0.08em] text-ink-3">
                Sources
              </h2>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-3 marker:text-ink-4">
                {guide.sources.map((src) => (
                  <li key={src}>{src}</li>
                ))}
              </ol>
            </section>
          )}
        </article>

        <nav className="mt-14 border-t border-line pt-8" aria-label="More guides">
          <p className="text-sm font-semibold text-ink-3">More guides</p>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {others.map((g) => (
              <li key={g.slug}>
                <a href={`/guides/${g.slug}`} className="block h-full rounded-2xl border border-line bg-white p-4 transition-shadow hover:shadow-[var(--shadow-soft)]">
                  <span className="block font-semibold leading-snug">{g.title}</span>
                  <span className="mt-1 block text-sm text-ink-3">{g.minutes}-minute read</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <Footer home="/" />
    </div>
  );
}

/** The page's title, description, canonical address and structured data, for search engines and
 * link previews; the site's own come back when it closes. */
function useMeta(guide: GuideDoc | undefined) {
  useEffect(() => {
    if (!guide) return;
    const before = document.title;
    document.title = guide.metaTitle;
    const url = `${site.url}/guides/${guide.slug}`;
    const restore: (() => void)[] = [];
    const meta = (attr: 'name' | 'property', key: string, content: string) => {
      let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
      const made = !el;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
      }
      const old = el.content;
      el.content = content;
      restore.push(() => (made ? el!.remove() : (el!.content = old)));
    };
    meta('name', 'description', guide.description);
    meta('property', 'og:title', guide.metaTitle);
    meta('property', 'og:description', guide.description);
    meta('property', 'og:url', url);
    meta('property', 'og:type', 'article');
    const canonical = document.createElement('link');
    canonical.rel = 'canonical';
    canonical.href = url;
    document.head.appendChild(canonical);
    const data = document.createElement('script');
    data.type = 'application/ld+json';
    data.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: guide.title,
      description: guide.description,
      mainEntityOfPage: url,
      dateModified: '2026-11-07',
      author: { '@type': 'Organization', name: 'Kaivon', url: site.kaivon },
      publisher: { '@type': 'Organization', name: 'Kaivon', url: site.kaivon },
    });
    document.head.appendChild(data);
    window.scrollTo(0, 0);
    return () => {
      document.title = before;
      restore.forEach((r) => r());
      canonical.remove();
      data.remove();
    };
  }, [guide]);
}
