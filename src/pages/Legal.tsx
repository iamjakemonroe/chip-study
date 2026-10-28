import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router';
import { Logo } from '../components/Logo.tsx';
import { privacy, terms, type LegalDoc } from '../content/legal.ts';
import { site } from '../content/site.ts';

function LegalPage({ doc }: { doc: LegalDoc }) {
  useEffect(() => {
    document.title = `${doc.title} · Chip Study`;
    window.scrollTo(0, 0);
  }, [doc]);
  return (
    <div className="min-h-dvh">
      <div className="daylight" />
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <a href="/" aria-label="Chip Study home">
          <Logo />
        </a>
        <a href="/" className="btn btn-quiet btn-sm">
          <ArrowLeft size={16} /> Home
        </a>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-24">
        <article className="card px-6 py-8 sm:px-10 sm:py-12">
          <p className="text-sm font-semibold text-iris">Updated {doc.updated}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">{doc.title}</h1>
          <p className="mt-3 text-lg leading-relaxed text-ink-2">{doc.summary}</p>
          {doc.sections.map((s) => (
            <section key={s.heading} className="mt-9">
              <h2 className="text-lg font-semibold tracking-[-0.01em]">{s.heading}</h2>
              {s.body.map((b, i) =>
                typeof b === 'string' ? (
                  <p key={i} className="mt-3 leading-relaxed text-ink-2">
                    {b}
                  </p>
                ) : (
                  <ul key={i} className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-ink-2 marker:text-iris">
                    {b.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ),
              )}
            </section>
          ))}
        </article>
        <p className="mt-8 text-center text-sm text-ink-3">
          {doc.slug === 'terms' ? <Link to="/privacy">Privacy Policy</Link> : <Link to="/terms">Terms of Service</Link>} · {site.email} · © {site.year} Kaivon
        </p>
      </main>
    </div>
  );
}

export const Terms = () => <LegalPage doc={terms} />;
export const Privacy = () => <LegalPage doc={privacy} />;
