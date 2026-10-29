import { useEffect, useState } from 'react';
import { Logo } from '../components/Logo.tsx';
import { Orb } from '../components/Orb.tsx';
import { FREE_FEATURES, PRO_FEATURES, SCHOOL_EMAILS } from '../content/plans.ts';
import { proLive, site } from '../content/site.ts';
import '../styles/landing.css';
import { HeroLight } from './HeroLight.tsx';
import { Showcase } from './Showcase.tsx';
import { ModesTour } from './ModesTour.tsx';
import { useReveal } from './reveal.ts';

/** study.kaivon.app for someone who isn't signed in: what Chip Study is, Chip's six modes, the
 * honest record, focus, the tools, the price and the questions people ask. It loads on its own,
 * without the app. */
export function Landing() {
  useReveal();
  useSmoothScroll();
  useEffect(() => {
    document.title = 'Chip Study: understand anything, with a tutor on your side';
  }, []);

  return (
    <div className="landing">
      <Nav />
      <main id="main">
        <Hero />
        <How />
        <ModesTour />
        <Progress />
        <Honest />
        <FocusSection />
        <Tools />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

/** Lenis smooth scrolling, on desktops with a mouse, unless motion is turned down. */
function useSmoothScroll() {
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

function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const links = [
    ['#how', 'How it works'],
    ['#chip', 'Chip'],
    ['#honest', 'Assignments'],
    ['#pricing', 'Pricing'],
    ['#faq', 'FAQ'],
  ];
  return (
    <header className={`l-nav ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="l-wrap flex h-16 items-center gap-6">
        <a href="/" aria-label="Chip Study home">
          <Logo />
        </a>
        <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex" aria-label="Sections">
          {links.map(([href, label]) => (
            <a key={href} href={href} className="l-navlink">
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <a href="/signin" className="btn btn-quiet btn-sm hidden sm:inline-flex">
            Sign in
          </a>
          <a href="/signin" className="btn btn-primary btn-sm">
            Start free
          </a>
          <button className="icon-btn lg:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d={open ? 'M5 5l10 10M15 5 5 15' : 'M3 6h14M3 10h14M3 14h14'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="l-wrap grid gap-1 pb-4 lg:hidden" aria-label="Sections">
          {links.map(([href, label]) => (
            <a key={href} href={href} className="rounded-xl px-3 py-2.5 font-semibold text-ink-2 hover:bg-white" onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <a href="/signin" className="rounded-xl px-3 py-2.5 font-semibold text-ink-2 hover:bg-white">
            Sign in
          </a>
        </nav>
      )}
    </header>
  );
}

function Hero() {
  return (
    <section className="l-hero" aria-labelledby="hero-title">
      <HeroLight className="l-hero-canvas" />
      <div className="l-hero-fade" />
      <div className="l-wrap relative">
        <div className="mx-auto max-w-3xl text-center">
          <p className="l-pill l-in" style={{ ['--d' as string]: '0.05s' }}>
            <span className="l-pill-dot" /> New from Kaivon · Free to start
          </p>
          <h1 id="hero-title" className="l-h1 l-in" style={{ ['--d' as string]: '0.12s' }}>
            Understand anything. <span className="l-shine">Really learn it.</span>
          </h1>
          <p className="l-lead l-in" style={{ ['--d' as string]: '0.24s' }}>
            Chip Study is a calm place to study, with Chip: a tutor that guides you step by step, checks your work and tells you why, and turns what you study into practice that sticks. When an assignment’s due, Chip helps you understand it, plan it and write it in your own words.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3 l-in" style={{ ['--d' as string]: '0.36s' }}>
            <a href="/signin" className="btn btn-iris h-12 px-6 text-base">
              Start learning free
              <Arrow />
            </a>
            <a href="#how" className="btn btn-ghost h-12 px-6 text-base">
              See how it works
            </a>
          </div>
          <p className="mt-5 text-sm text-ink-3 l-in" style={{ ['--d' as string]: '0.44s' }}>
            Sign in with your Kaivon account, the same one as Utopia.
          </p>
        </div>
        <div className="l-in" style={{ ['--d' as string]: '0.55s' }}>
          <Showcase />
        </div>
      </div>
    </section>
  );
}

export function Arrow() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionHead({ kicker, title, lead, id }: { kicker: string; title: React.ReactNode; lead?: string; id: string }) {
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

function How() {
  const steps = [
    {
      n: '1',
      title: 'Bring what you’re learning',
      body: 'A topic, your notes, a reading, an exam date or an assignment brief. Chip reads it with you, so its help is about your course.',
      art: <StepBrief />,
    },
    {
      n: '2',
      title: 'Learn it with Chip',
      body: 'Chip asks what you think, gives hints, explains step by step when you want it, and checks your work and tells you why.',
      art: <StepChip />,
    },
    {
      n: '3',
      title: 'Practise until it sticks',
      body: 'Quizzes and flashcards from your own notes, and a review deck that brings each card back just before you’d forget it.',
      art: <StepReview />,
    },
  ];
  return (
    <section id="how" className="l-section" aria-labelledby="how-title">
      <div className="l-wrap">
        <SectionHead id="how-title" kicker="How it works" title="Understand it, practise it, keep it." />
        <ol className="mt-14 grid gap-5 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.n} className="l-card r-up flex flex-col" style={{ ['--d' as string]: `${0.08 * i}s` }}>
              <div className="l-step-art">{s.art}</div>
              <div className="p-6 pt-5">
                <p className="text-sm font-semibold text-iris">Step {s.n}</p>
                <h3 className="mt-1 text-xl font-semibold tracking-[-0.015em]">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-ink-2">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function StepBrief() {
  return (
    <div className="relative grid h-full w-full place-items-center">
      <div className="l-sheet">
        <span className="text-[0.68rem] font-bold text-ink">Cell respiration: my notes</span>
        <span className="l-line mt-1 w-full" />
        <span className="l-line w-5/6" />
        <span className="l-line w-11/12" />
        <span className="l-line w-2/3" />
      </div>
      <div className="l-float l-float-a">
        <span className="h-2 w-2 rounded-full bg-peach" /> Exam Fri 14 Nov
      </div>
      <div className="l-float l-float-b">
        <span className="font-bold text-rose">PDF</span> Chapter 9 reading
      </div>
    </div>
  );
}

function StepChip() {
  return (
    <div className="flex h-full w-full flex-col justify-center gap-2.5 px-7">
      <p className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-iris-soft px-3 py-1.5 text-[0.72rem]">Why do cells need oxygen?</p>
      <div className="flex items-start gap-2">
        <Orb size={22} />
        <p className="max-w-[82%] rounded-2xl rounded-tl-md bg-white px-3 py-1.5 text-[0.72rem] leading-relaxed text-ink-2 shadow-[var(--shadow-soft)]">Good question. First: where do you think the electrons end up at the end of the chain?</p>
      </div>
      <p className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-iris-soft px-3 py-1.5 text-[0.72rem]">On oxygen?</p>
    </div>
  );
}

function StepReview() {
  return (
    <div className="relative grid h-full w-full place-items-center">
      <div className="l-stack">
        <span className="l-stack-card" />
        <span className="l-stack-card" />
        <span className="l-stack-card is-top">
          <span className="text-[0.72rem] font-bold text-ink">What is ATP for?</span>
          <span className="mt-2 flex gap-1.5">
            <i className="rounded-md bg-rose-soft px-1.5 py-0.5 text-[0.55rem] font-semibold not-italic text-[#b8355a]">Again</i>
            <i className="rounded-md bg-mint-soft px-1.5 py-0.5 text-[0.55rem] font-semibold not-italic text-[#16795f]">Good · 3 days</i>
          </span>
        </span>
      </div>
    </div>
  );
}

function Progress() {
  return (
    <section className="l-section" aria-labelledby="progress-title">
      <div className="l-wrap grid grid-cols-1 items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
        <div>
          <p className="l-kicker r-up text-left">Practice that sticks</p>
          <h2 id="progress-title" className="l-h2 r-up text-left" style={{ ['--d' as string]: '0.06s' }}>
            Watch it stick.
          </h2>
          <p className="l-sublead r-up text-left" style={{ ['--d' as string]: '0.12s' }}>
            Testing yourself and spacing out your reviews are two of the best-studied ways to remember what you learn. Chip Study does both for you, and shows you how far you’ve come.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {['Flashcards from your notes, in one tap', 'Each card back just before you’d forget', 'Quizzes that save what you missed', 'Your streak, your deck, your progress'].map((t, i) => (
              <li key={t} className="l-tick r-up" style={{ ['--d' as string]: `${0.06 * i}s` }}>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="r-up" style={{ ['--d' as string]: '0.1s' }}>
          <div className="l-progress">
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold tracking-[-0.01em]">What you’ve learned</p>
              <span className="chip-tag bg-peach-soft text-[#b25a22]">🔥 12-day streak</span>
            </div>
            <div className="mt-6 grid grid-cols-3 gap-3 text-center">
              {[
                ['86', 'mastered', 'var(--color-mint)', 0.62],
                ['41', 'learning', '#a79fff', 0.3],
                ['92%', 'quiz answers right', 'var(--color-sky)', 0.92],
              ].map(([n, label, color, v]) => (
                <div key={label as string} className="rounded-2xl bg-paper p-3">
                  <svg viewBox="0 0 44 44" className="mx-auto h-14 w-14 -rotate-90" aria-hidden="true">
                    <circle cx="22" cy="22" r="18" fill="none" stroke="white" strokeWidth="5" />
                    <circle className="l-ring" cx="22" cy="22" r="18" fill="none" stroke={color as string} strokeWidth="5" strokeLinecap="round" strokeDasharray="113.1" style={{ ['--off' as string]: `${113.1 * (1 - (v as number))}` }} />
                  </svg>
                  <p className="mt-2 text-xl font-semibold tracking-[-0.02em]">{n}</p>
                  <p className="text-xs text-ink-3">{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">14 cards to review</span>
                <span className="text-ink-3">about 3 minutes</span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs font-semibold">
                <span className="rounded-xl bg-rose-soft py-2 text-[#b8355a]">Again<br /><span className="font-medium opacity-70">10 min</span></span>
                <span className="rounded-xl bg-sand-soft py-2 text-[#8a6a1f]">Hard<br /><span className="font-medium opacity-70">2 days</span></span>
                <span className="rounded-xl bg-mint-soft py-2 text-[#16795f]">Good<br /><span className="font-medium opacity-70">4 days</span></span>
                <span className="rounded-xl bg-sky-soft py-2 text-[#1f6d9e]">Easy<br /><span className="font-medium opacity-70">9 days</span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Honest() {
  const points = [
    ['Every bit of help is recorded', 'Each question you ask and each answer Chip gives goes in the assignment’s AI-use record as it happens. Nobody can edit it, not even you, so it means something.'],
    ['Chip’s words are marked', 'Text you put in from Chip stays marked until you rewrite it in your own words, so you always know what’s yours.'],
    ['A declaration in one click', 'Export a clear statement with the full record, in Word, PDF or Markdown, ready to hand in with your work.'],
    ['It respects your course', 'If your brief says AI mustn’t write for you, Chip explains, plans and gives feedback instead of drafting.'],
  ];
  return (
    <section id="honest" className="l-section" aria-labelledby="honest-title">
      <div className="l-wrap grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
        <div>
          <p className="l-kicker r-up text-left">Assignments, done honestly</p>
          <h2 id="honest-title" className="l-h2 r-up text-left" style={{ ['--d' as string]: '0.06s' }}>
            Help you can declare with pride.
          </h2>
          <p className="l-sublead r-up text-left" style={{ ['--d' as string]: '0.12s' }}>
            When an assignment’s due, Chip helps you understand the brief, plan it, and write it in your own words, with feedback against the rubric. Universities increasingly ask you to declare AI use; Chip Study makes that effortless.
          </p>
          <ul className="mt-9 space-y-6">
            {points.map(([title, body], i) => (
              <li key={title} className="flex gap-4 r-up" style={{ ['--d' as string]: `${0.08 * i}s` }}>
                <span className="mt-0.5 grid h-8 w-8 flex-none place-items-center rounded-xl bg-mint-soft text-mint">
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3.5 8.4 6.6 11.3 12.5 4.8" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="mt-1 block leading-relaxed text-ink-2">{body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="r-up" style={{ ['--d' as string]: '0.1s' }}>
          <Declaration />
        </div>
      </div>
    </section>
  );
}

function Declaration() {
  const rows = [
    ['Tue 09:14', 'Asked Chip to explain', '“What does the rubric mean by critical evaluation?”'],
    ['Tue 09:31', 'Asked Chip to plan', '“Make me a plan to the due date”'],
    ['Wed 18:02', 'Put Chip’s words into the document', '46 words'],
    ['Thu 20:45', 'Asked Chip to check against the rubric', '“Check my draft”'],
  ];
  return (
    <div className="l-decl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-3">Chip Study</p>
          <p className="mt-1 text-xl font-semibold tracking-[-0.015em]">Declaration of AI use</p>
        </div>
        <span className="chip-tag bg-mint-soft text-mint">Can’t be edited</span>
      </div>
      <p className="mt-4 text-[0.95rem] leading-relaxed text-ink-2">
        I used Chip, the AI study partner in Chip Study, while working on this assignment, as recorded below. <strong className="text-ink">46 of the 1,512 words</strong> in my final document (3%) are still in Chip’s wording; everything else is my own.
      </p>
      <div className="mt-5 rounded-2xl bg-paper p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-ink-2">Chip’s words in the document</span>
          <span className="font-semibold">3%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white">
          <div className="l-bar h-full rounded-full bg-gradient-to-r from-[#a79fff] to-[#6457f0]" style={{ ['--w' as string]: '3%' }} />
        </div>
      </div>
      <ol className="mt-5 space-y-3">
        {rows.map(([when, what, detail]) => (
          <li key={when} className="flex gap-3 text-sm">
            <span className="w-[4.5rem] flex-none font-medium tabular-nums text-ink-4">{when}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{what}</span>
              <span className="block truncate text-ink-3">{detail}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-6 flex gap-2">
        {['Word', 'PDF', 'Markdown'].map((f) => (
          <span key={f} className={`btn btn-sm ${f === 'Word' ? 'btn-primary' : 'btn-ghost'} pointer-events-none`}>
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}

function FocusSection() {
  const [scene, setScene] = useState(0);
  const scenes = ['Dawn', 'Sea', 'Forest', 'Night'];
  return (
    <section className="l-section" aria-labelledby="focus-title">
      <div className="l-wrap grid grid-cols-1 items-center gap-14 lg:grid-cols-[1.05fr_1fr]">
        <div className="order-2 r-up lg:order-1">
          <div className={`l-focus scene-${scenes[scene].toLowerCase()}`}>
            <span className="fs-blob fs-a" />
            <span className="fs-blob fs-b" />
            <span className="fs-blob fs-c" />
            {scene === 3 && <span className="fs-stars" />}
            <div className="relative z-[1] flex h-full flex-col items-center justify-center px-6 text-center">
              <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${scene === 3 ? 'text-white/70' : 'text-ink-3'}`}>Focus · round 2 of 4</p>
              <p className={`mt-2 text-6xl font-semibold tabular-nums tracking-[-0.04em] sm:text-7xl ${scene === 3 ? 'text-white' : 'text-ink'}`}>24:12</p>
              <div className="mt-6 flex gap-2" role="radiogroup" aria-label="Scene">
                {scenes.map((s, i) => (
                  <button key={s} role="radio" aria-checked={i === scene} aria-label={s} onClick={() => setScene(i)} className={`l-swatch l-swatch-${s.toLowerCase()} ${i === scene ? 'is-on' : ''}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="order-1 lg:order-2">
          <p className="l-kicker r-up text-left">Built for focus</p>
          <h2 id="focus-title" className="l-h2 r-up text-left" style={{ ['--d' as string]: '0.06s' }}>
            A quiet room for deep work.
          </h2>
          <p className="l-sublead r-up text-left" style={{ ['--d' as string]: '0.12s' }}>
            One tap turns the workspace into a calm room: just you, your page and a gentle timer, with soft scenes and sounds made right on your device.
          </p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {['Focus timer: 25/5, 50/10 or 90/20', 'Four calm scenes, day and night', 'Rain, waves or soft noise', 'Focus time kept on each assignment'].map((t, i) => (
              <li key={t} className="l-tick r-up" style={{ ['--d' as string]: `${0.06 * i}s` }}>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Tools() {
  const tools = [
    { title: 'A writing page that stays out of the way', body: 'Headings, lists, tables, quotes, highlights and links, saved as you type, even when your connection drops.', art: <ToolDoc /> },
    { title: 'Math that looks right', body: 'Type $x^2$ and it’s set like a textbook. LaTeX with a live preview for anything bigger.', art: <ToolMath /> },
    { title: 'Referencing, done', body: 'APA 7th or Harvard, in-text citations that update themselves, and a reference list in one click.', art: <ToolCite /> },
    { title: 'Code and tables', body: 'A real code editor for nine languages, and a table with formulas for data and results.', art: <ToolCode /> },
    { title: 'Readings Chip can read', body: 'Add a PDF or Word reading and ask Chip about it. The text is taken out on your own device.', art: <ToolRead /> },
    { title: 'Everywhere you study', body: 'Phone, iPad or laptop. Install it like an app, and pick up where you left off.', art: <ToolDevices /> },
  ];
  return (
    <section className="l-section" aria-labelledby="tools-title">
      <div className="l-wrap">
        <SectionHead id="tools-title" kicker="Every tool, one place" title="Everything an assignment needs." lead="No more ten tabs. Your brief, your sources, your draft and Chip, side by side." />
        <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((t, i) => (
            <li key={t.title} className="l-card r-up overflow-hidden" style={{ ['--d' as string]: `${0.05 * (i % 3)}s` }}>
              <div className="l-tool-art">{t.art}</div>
              <div className="p-6 pt-5">
                <h3 className="text-lg font-semibold tracking-[-0.01em]">{t.title}</h3>
                <p className="mt-1.5 leading-relaxed text-ink-2">{t.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ToolDoc() {
  return (
    <div className="l-sheet w-[78%]">
      <span className="text-[0.7rem] font-bold text-ink">Introduction</span>
      <span className="l-line mt-1.5 w-full" />
      <span className="l-line w-11/12" />
      <span className="l-line w-full">
        <i className="l-chipmark" />
      </span>
      <span className="l-line w-3/4" />
    </div>
  );
}
function ToolMath() {
  return (
    <p className="font-serif text-[1.35rem] italic text-ink">
      x = <span className="inline-flex flex-col items-center align-middle text-[1.05rem] not-italic"><span className="border-b border-ink px-1 italic">−b ± √(b² − 4ac)</span><span className="italic">2a</span></span>
    </p>
  );
}
function ToolCite() {
  return (
    <div className="w-[86%] rounded-xl bg-white p-3 text-[0.72rem] leading-relaxed text-ink-2 shadow-[var(--shadow-soft)]">
      <p className="reference">
        Smith, J., &amp; Lee, K. A. (2020). Climate change and coastal towns. <em>Journal of Coastal Research</em>, <em>36</em>(4), 100–115.
      </p>
      <p className="mt-1.5 font-semibold text-iris-2">(Smith &amp; Lee, 2020)</p>
    </div>
  );
}
function ToolCode() {
  return (
    <pre className="w-[86%] rounded-xl bg-white p-3 font-mono text-[0.68rem] leading-relaxed text-ink-2 shadow-[var(--shadow-soft)]">
      <span className="text-lilac">def</span> <span className="text-sky">mean</span>(xs):{'\n'}
      {'    '}<span className="text-lilac">return</span> sum(xs) / len(xs){'\n'}
      <span className="text-ink-4"># =AVERAGE(B2:B9) → 72.5</span>
    </pre>
  );
}
function ToolRead() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-14 w-11 place-items-center rounded-lg bg-white text-[0.6rem] font-bold text-rose shadow-[var(--shadow-soft)]">PDF</span>
      <span className="l-arrow" />
      <Orb size={34} />
    </div>
  );
}
function ToolDevices() {
  return (
    <div className="flex items-end gap-3">
      <span className="h-16 w-24 rounded-lg border-[3px] border-ink/80 bg-gradient-to-br from-iris-soft to-sky-soft" />
      <span className="h-14 w-10 rounded-lg border-[3px] border-ink/80 bg-gradient-to-br from-mint-soft to-sky-soft" />
      <span className="h-10 w-6 rounded-md border-[3px] border-ink/80 bg-gradient-to-br from-peach-soft to-lilac-soft" />
    </div>
  );
}

function Pricing() {
  const free = FREE_FEATURES;
  const pro = PRO_FEATURES;
  return (
    <section id="pricing" className="l-section" aria-labelledby="pricing-title">
      <div className="l-wrap">
        <SectionHead id="pricing-title" kicker="Pricing" title="Fair, and simple." lead="Free is a real tutor, every day. Pro is for when you want Chip’s deepest thinking. Chip’s time is counted fairly: a quick question uses less than a long draft." />
        <div className="mx-auto mt-14 grid max-w-4xl gap-5 md:grid-cols-2">
          <PriceCard name="Free" price="$0" note="free, always" items={free} cta={<a href="/signin" className="btn btn-ghost w-full">Start free</a>} />
          <PriceCard
            name="Pro"
            price={`$${site.price.toFixed(2)}`}
            note="a month · cancel any time"
            items={pro}
            glow
            badge={proLive ? undefined : 'Launching soon'}
            cta={
              <a href={proLive ? '/app/plan' : '/signin'} className="btn btn-iris w-full">
                {proLive ? 'Go Pro' : 'Start free now'}
              </a>
            }
          />
          <div className="l-student r-up md:col-span-2">
            <span className="grid h-11 w-11 flex-none place-items-center rounded-full bg-mint-soft text-xl" aria-hidden="true">
              🎓
            </span>
            <div className="flex-1">
              <p className="text-lg font-semibold">
                Students: Pro for ${site.studentPrice.toFixed(2)} a month <span className="chip-tag ml-1 align-middle bg-mint-soft text-mint">{Math.round((1 - site.studentPrice / site.price) * 100)}% off</span>
              </p>
              <p className="mt-1 text-[0.9375rem] leading-relaxed text-ink-2">
                Sign up with your school email ({SCHOOL_EMAILS}) and the student price is yours. Everything in Pro, with about 110 in-depth messages a month from Chip’s best model.
              </p>
            </div>
            <a href="/signin" className="btn btn-ghost w-full flex-none sm:w-auto">
              Sign up with your school email
            </a>
          </div>
        </div>
        <p className="mt-6 text-center text-sm text-ink-3">Prices in US dollars; your bank converts if your card is in another currency.</p>
      </div>
    </section>
  );
}

function PriceCard({ name, price, note, items, cta, glow, badge }: { name: string; price: string; note: string; items: string[]; cta: React.ReactNode; glow?: boolean; badge?: string }) {
  return (
    <div className={`l-price r-up ${glow ? 'is-glow' : ''}`}>
      <div className="flex items-center gap-3">
        {glow ? <Orb size={30} /> : <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-sky-soft text-sm font-bold text-sky">⚡</span>}
        <h3 className="text-xl font-semibold">{name}</h3>
        {badge && <span className="chip-tag bg-iris-soft text-iris-2">{badge}</span>}
      </div>
      <p className="mt-6 flex items-baseline gap-2">
        <span className="text-5xl font-semibold tracking-[-0.035em]">{price}</span>
        <span className="text-sm text-ink-3">{note}</span>
      </p>
      <ul className="mt-7 flex-1 space-y-3">
        {items.map((it) => (
          <li key={it} className={`l-tick ${glow ? 'is-iris' : ''}`}>
            {it}
          </li>
        ))}
      </ul>
      <div className="mt-8">{cta}</div>
    </div>
  );
}

const FAQ = [
  ['Will it actually help me learn?', 'That’s the point. Chip’s default is to guide you: it asks what you think, gives hints and lets you get there, and explains step by step when you want it straight. It checks your own work and tells you why something’s wrong, and turns what you study into quizzes and flashcards that come back just before you’d forget them.'],
  ['Is using Chip cheating?', 'Chip is built to help you learn and to keep you honest. It teaches, plans and gives feedback, and when it writes with you, the words are marked and everything is recorded, so you can declare it. Your course decides what help is allowed; Chip respects that, and we suggest you check its rules.'],
  ['Will Chip just write my essay?', 'No. Chip helps you write it in your own words: it gives feedback, asks questions and helps you plan. If you ask it to draft a paragraph or improve a selection, it does it in your style, and the text stays marked as Chip’s until you rewrite it. Your declaration shows how much of your final document is still in Chip’s words.'],
  ['What is the AI-use record?', 'Every time you ask Chip something on an assignment, the question and the start of the answer are kept, with the time and the model. So is anything you put into your document from Chip. You can read it, but nobody can edit it, so the declaration you export is one you can stand behind.'],
  ['Which AI is Chip?', 'Chip runs on Claude, made by Anthropic. Free uses Chip Fast (Claude Haiku), and Pro adds Chip’s best model (Claude Opus) and web research. Anthropic doesn’t use your work to train its models.'],
  ['Can I use my Utopia account?', 'Yes. Chip Study uses your Kaivon account, the same one you play Utopia with. Sign in with your email and the code we send. New here? We’ll make you an account.'],
  ['Is my work private?', 'Your notes, documents, cards and chats are yours alone. We don’t sell your data or show ads. You can delete anything, or all your study data, at any time.'],
  ['Is there a student discount?', `Yes. Students get Pro for $${site.studentPrice.toFixed(2)} a month instead of $${site.price.toFixed(2)}. Sign up with your school email (${SCHOOL_EMAILS}) and the Plan page shows the student price. It’s everything in Pro, with a little less of Chip’s best model: about 110 in-depth messages a month instead of 150.`],
  ['What happens when I run out of Chip time?', 'Everything else keeps working: your notes, editor, review deck, timer and record. Chip’s time comes back the next day. Pro gives you much more, and Chip’s best model.'],
  ['Does it work on my phone and iPad?', 'Yes. Chip Study is made for phones, tablets and laptops alike, and you can install it like an app from your browser.'],
];

function Faq() {
  return (
    <section id="faq" className="l-section" aria-labelledby="faq-title">
      <div className="l-wrap max-w-3xl">
        <SectionHead id="faq-title" kicker="Questions" title="Good questions." />
        <div className="mt-12 space-y-3">
          {FAQ.map(([q, a]) => (
            <details key={q} className="l-faq r-up">
              <summary>
                <span>{q}</span>
                <span className="l-faq-icon" aria-hidden="true" />
              </summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="l-section pt-0" aria-labelledby="cta-title">
      <div className="l-wrap">
        <div className="l-cta r-up">
          <Orb size={64} />
          <h2 id="cta-title" className="mt-6 text-[2rem] font-semibold leading-tight tracking-[-0.03em] sm:text-[2.75rem]">
            What will you understand next?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-lg leading-relaxed text-ink-2">Bring a topic, your notes or an assignment. Chip will help you really learn it.</p>
          <a href="/signin" className="btn btn-primary mt-8 h-12 px-7 text-base">
            Start learning free <Arrow />
          </a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line bg-white/60">
      <div className="l-wrap grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-3">A calm place to study and really learn, with Chip, a tutor on your side. Made by Kaivon.</p>
        </div>
        <FooterCol title="Chip Study" links={[['#how', 'How it works'], ['#pricing', 'Pricing'], ['#faq', 'FAQ'], ['/signin', 'Sign in']]} />
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
