import { BookOpen, Building2, EyeOff, GraduationCap, LayoutDashboard, Link2, Mail, School, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Logo } from '../components/Logo.tsx';
import { Orb } from '../components/Orb.tsx';
import { CAN_SEE, CANT_SEE } from '../content/institutions.ts';
import { site } from '../content/site.ts';
import { useInstitutionPrices } from '../institution/usePrices.ts';
import { formatPrice, minStudents, priceCurrencies, priceLine, visitorPriceCurrency, type InstitutionPrices } from '../lib/institutionPrice.ts';
import '../styles/landing.css';
import { HeroLight } from './HeroLight.tsx';
import { Arrow, Footer, SectionHead, useSmoothScroll } from './parts.tsx';
import { useReveal } from './reveal.ts';

const REGISTER = '/app/institutions/new';

/** study.kaivon.app/institutions: Chip Study for schools, colleges and universities. Who it's
 * for, why (learning with AI honestly, with a record the institution can see, alongside the AI
 * tools it already gives students), what it gets, what its staff can and can't see, how a pilot
 * works, and registering. No price list: a pilot first, then ask us. */
export function Institutions() {
  useReveal();
  useSmoothScroll();
  useEffect(() => {
    document.title = 'Chip Study for institutions: learning with AI, honestly';
  }, []);

  return (
    <div className="landing">
      <Nav />
      <main id="main">
        <Hero />
        <WhoFor />
        <Why />
        <What />
        <Privacy />
        <Pilot />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <Footer home="/" />
    </div>
  );
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
    ['#why', 'Why Chip Study'],
    ['#get', 'What you get'],
    ['#privacy', 'Privacy'],
    ['#pilot', 'Pilot'],
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
          <a href={REGISTER} className="btn btn-primary btn-sm">
            Register
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
          <a href="/" className="rounded-xl px-3 py-2.5 font-semibold text-ink-2 hover:bg-white">
            Chip Study for students
          </a>
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
            <span className="l-pill-dot" /> For schools, colleges and universities
          </p>
          <h1 id="hero-title" className="l-h1 l-in" style={{ ['--d' as string]: '0.12s' }}>
            Learning with AI, <span className="l-shine">honestly.</span>
          </h1>
          <p className="l-lead l-in" style={{ ['--d' as string]: '0.24s' }}>
            Chip Study is the place students learn with AI honestly, with a record your institution can see. It works alongside the AI tools you already give students.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3 l-in" style={{ ['--d' as string]: '0.36s' }}>
            <a href={REGISTER} className="btn btn-iris h-12 px-6 text-base">
              Register your institution
              <Arrow />
            </a>
            <a href="#pilot" className="btn btn-ghost h-12 px-6 text-base">
              How a pilot works
            </a>
          </div>
          <p className="mt-5 text-sm text-ink-3 l-in" style={{ ['--d' as string]: '0.44s' }}>
            A free one-term pilot first. Kaivon checks every institution before its students join.
          </p>
        </div>
      </div>
    </section>
  );
}

function WhoFor() {
  const kinds = [
    { icon: <Building2 size={20} />, title: 'Universities', body: 'Lecturers and tutors see how each course is studying, with AI-use records students can stand behind.' },
    { icon: <GraduationCap size={20} />, title: 'Colleges', body: 'Classes with their own codes, so each teacher sees the students they teach and nobody else.' },
    { icon: <School size={20} />, title: 'Schools', body: 'For students 13 and over: a calm place to learn with Chip, and teachers who can see the effort behind the work.' },
  ];
  return (
    <section className="l-section pt-6 md:pt-10" aria-labelledby="who-title">
      <div className="l-wrap">
        <SectionHead id="who-title" kicker="Who it’s for" title="Built for places that teach." />
        <ul className="mt-12 grid gap-5 md:grid-cols-3">
          {kinds.map((k, i) => (
            <li key={k.title} className="l-card r-up p-6" style={{ ['--d' as string]: `${0.08 * i}s` }}>
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-iris-soft text-iris">{k.icon}</span>
              <h3 className="mt-4 text-xl font-semibold tracking-[-0.015em]">{k.title}</h3>
              <p className="mt-2 leading-relaxed text-ink-2">{k.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Why() {
  const points = [
    ['Learning first', 'Chip asks what students think, gives hints and checks their work before it ever writes for them, so the AI helps them learn instead of doing it for them.'],
    ['A record nobody can edit', 'Every bit of help on an assignment goes into its AI-use record as it happens. Students can export it as a declaration; you can see it too.'],
    ['Alongside what you already use', 'Keep the AI tools you already give students. Chip Study is where the studying happens: the brief, the drafts, the practice and the honest record.'],
    ['Private where it should be', 'You see effort and AI use, never chats, notes or documents. Students are told exactly what you see before they join.'],
  ];
  return (
    <section id="why" className="l-section" aria-labelledby="why-title">
      <div className="l-wrap grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
        <div>
          <p className="l-kicker r-up text-left">Why Chip Study</p>
          <h2 id="why-title" className="l-h2 r-up text-left" style={{ ['--d' as string]: '0.06s' }}>
            AI is already in the work. Make it visible.
          </h2>
          <p className="l-sublead r-up text-left" style={{ ['--d' as string]: '0.12s' }}>
            Students use AI either way. In Chip Study they learn with it honestly, and your institution sees how: the time they put in, how their practice is going, and a record of the help they had.
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
          <ExampleRecord />
        </div>
      </div>
    </section>
  );
}

/** What a teacher sees of one student's assignment: an illustration, marked as an example. */
function ExampleRecord() {
  const rows = [
    ['Tue 09:14', 'Asked Chip to explain'],
    ['Tue 09:31', 'Asked Chip to plan'],
    ['Wed 18:02', 'Put Chip’s words into the document · 46 words'],
    ['Thu 20:45', 'Asked Chip to check their work'],
  ];
  return (
    <div className="l-decl">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-3">What a teacher sees</p>
          <p className="mt-1 text-xl font-semibold tracking-[-0.015em]">Essay: Coastal erosion</p>
          <p className="text-sm text-ink-3">GEO 201 · due Friday · 1,512 words</p>
        </div>
        <span className="chip-tag bg-paper-2 text-ink-3">Example</span>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        {[
          ['Focus', '3h 10m'],
          ['Practice', '84%'],
          ['AI-use records', '4'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-paper px-2 py-3">
            <p className="text-lg font-semibold tracking-[-0.02em]">{value}</p>
            <p className="text-xs text-ink-3">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-3">AI-use record</p>
      <ol className="mt-3 space-y-3">
        {rows.map(([when, what]) => (
          <li key={when} className="flex gap-3 text-sm">
            <span className="w-[5rem] flex-none whitespace-nowrap font-medium tabular-nums text-ink-4">{when}</span>
            <span className="min-w-0 flex-1 font-semibold">{what}</span>
          </li>
        ))}
      </ol>
      <p className="mt-6 flex items-center gap-2 rounded-2xl bg-mint-soft px-4 py-3 text-sm text-[#16795f]">
        <EyeOff size={16} className="flex-none" /> The chats, notes and the essay itself stay private.
      </p>
    </div>
  );
}

function What() {
  const items = [
    { icon: <LayoutDashboard size={20} />, title: 'A dashboard', body: 'This week’s activity, eight weeks of study time and seats used, at a glance.' },
    { icon: <Users size={20} />, title: 'Classes with join codes', body: 'Make a class and share its code. Teachers run their own classes and see only their students.' },
    { icon: <Link2 size={20} />, title: 'Invite links', body: 'Paste a list of emails or upload a CSV, and get a link for each person to send.' },
    { icon: <Mail size={20} />, title: 'Joining with a school email', body: 'Once we’ve confirmed your email domain, students who sign in with it can join in a tap.' },
    { icon: <ShieldCheck size={20} />, title: 'Activity and AI-use records', body: 'Study time, practice scores and Chip use for each student, and each assignment’s record of how AI helped.' },
    { icon: <Sparkles size={20} />, title: 'Pro for every student', body: 'Chip’s best model, web research and bigger files for every student, while your institution is active.' },
  ];
  return (
    <section id="get" className="l-section" aria-labelledby="get-title">
      <div className="l-wrap">
        <SectionHead id="get-title" kicker="What you get" title="Everything to bring a class in." lead="One place for admins to run it, teachers to follow their classes, and students to learn." />
        <ul className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it, i) => (
            <li key={it.title} className="l-card r-up p-6" style={{ ['--d' as string]: `${0.05 * (i % 3)}s` }}>
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-iris-soft text-iris">{it.icon}</span>
              <h3 className="mt-4 text-lg font-semibold tracking-[-0.01em]">{it.title}</h3>
              <p className="mt-1.5 leading-relaxed text-ink-2">{it.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Privacy() {
  return (
    <section id="privacy" className="l-section" aria-labelledby="privacy-title">
      <div className="l-wrap max-w-5xl">
        <SectionHead
          id="privacy-title"
          kicker="The privacy promise"
          title="You see the effort. Never the private work."
          lead="Admins see every student at your institution; teachers see the students in their classes. Students read this before they join, and can leave at any time."
        />
        <div className="mt-14 grid gap-5 md:grid-cols-2">
          <div className="l-card r-up p-6 sm:p-8">
            <p className="flex items-center gap-2 text-lg font-semibold">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-mint-soft text-mint">
                <BookOpen size={18} />
              </span>
              Staff can see
            </p>
            <ul className="mt-5 space-y-3">
              {CAN_SEE.students.map((t) => (
                <li key={t} className="l-tick">
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="l-card r-up p-6 sm:p-8" style={{ ['--d' as string]: '0.08s' }}>
            <p className="flex items-center gap-2 text-lg font-semibold">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-rose-soft text-rose">
                <EyeOff size={18} />
              </span>
              Staff can’t see
            </p>
            <ul className="mt-5 space-y-3">
              {CANT_SEE.students.map((t) => (
                <li key={t} className="relative pl-[1.85rem] leading-relaxed text-ink-2">
                  <span className="absolute left-0 top-[0.2rem] grid h-[1.2rem] w-[1.2rem] place-items-center rounded-full bg-rose-soft text-rose" aria-hidden="true">
                    <svg width="10" height="10" viewBox="0 0 10 10">
                      <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pilot() {
  const prices = useInstitutionPrices();
  const line = prices ? priceLine(prices, visitorPriceCurrency()) : null;
  const steps = [
    ['Register', 'Tell us about your institution on a short form. You’ll need a Kaivon account, which is free.'],
    ['We check it', 'Kaivon confirms you’re a real school, college or university, sets your seats and pilot length, and confirms your email domain.'],
    ['Bring students in', 'Make classes, send invite links, or let students join with their school email. Each of them sees what you’ll see first.'],
    [
      'Then, one price per student',
      line ? `${line.replace(/ \(or .*\)$/, '')}, billed yearly by invoice, from ${minStudents(prices!)} students. Kaivon sends the invoice when you’re ready to carry on.` : 'A price per student, billed yearly by invoice. Kaivon sends the invoice when you’re ready to carry on.',
    ],
  ];
  return (
    <section id="pilot" className="l-section" aria-labelledby="pilot-title">
      <div className="l-wrap">
        <SectionHead id="pilot-title" kicker="How a pilot works" title="Start free. Decide with real use." />
        <ol className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map(([title, body], i) => (
            <li key={title} className="l-card r-up flex flex-col p-6" style={{ ['--d' as string]: `${0.06 * i}s` }}>
              <span className="grid h-9 w-9 place-items-center rounded-full bg-ink text-sm font-semibold text-white">{i + 1}</span>
              <h3 className="mt-4 text-lg font-semibold tracking-[-0.01em]">{title}</h3>
              <p className="mt-1.5 leading-relaxed text-ink-2">{body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** The price, in the visitor's currency first and the others beside it, with what it covers. */
function Pricing() {
  const prices = useInstitutionPrices();
  const first = visitorPriceCurrency();
  const order = prices ? priceCurrencies(prices, first) : [];
  const main = order[0];
  return (
    <section id="pricing" className="l-section scroll-mt-20 pt-0 md:pt-0" aria-labelledby="pricing-title">
      <div className="l-wrap">
        <SectionHead id="pricing-title" kicker="Pricing" title="One simple price." lead="A free one-term pilot first. After that, one price per student, billed yearly." />
        <div className="l-price is-glow r-up mx-auto mt-12 max-w-3xl">
          {prices === undefined ? (
            <div className="skeleton h-40" />
          ) : !prices || !main ? (
            <p className="text-lg leading-relaxed text-ink-2">
              Write to <a className="font-semibold text-iris" href={`mailto:${site.email}`}>{site.email}</a> for the price.
            </p>
          ) : (
            <div className="grid gap-8 md:grid-cols-[1fr_1.1fr] md:items-center">
              <div>
                <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-5xl font-semibold tracking-[-0.035em]">{formatPrice(prices[main]!.per_student_year, main)}</span>
                  <span className="text-ink-3">per student per year</span>
                </p>
                <p className="mt-3 leading-relaxed text-ink-2">
                  Billed yearly by invoice, from {minStudents(prices)} students, after a free one-term pilot. Teachers and admins don’t take seats.
                </p>
                {order.length > 1 && (
                  <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-ink-3">
                    Also
                    {order.slice(1).map((c) => (
                      <span key={c} className="rounded-full border border-line bg-white px-2.5 py-0.5 font-semibold text-ink-2">
                        {formatPrice(prices[c]!.per_student_year, c)}
                      </span>
                    ))}
                  </p>
                )}
              </div>
              <div>
                <ul className="space-y-3">
                  {[
                    'Chip Study Pro for every student, with a little less of Chip’s best model than personal Pro',
                    'The dashboard, classes, invite links and AI-use records',
                    'Moodle, Canvas, Blackboard or Brightspace, connected',
                    'Course tutors for every class',
                  ].map((t) => (
                    <li key={t} className="l-tick is-iris">
                      {t}
                    </li>
                  ))}
                </ul>
                <a href={REGISTER} className="btn btn-iris mt-7 w-full sm:w-auto">
                  Start with a free pilot <Arrow />
                </a>
              </div>
            </div>
          )}
        </div>
        <p className="mt-5 text-center text-sm text-ink-3">
          Questions about the price?{' '}
          <a className="font-semibold text-iris hover:text-iris-2" href={`mailto:${site.email}?subject=${encodeURIComponent('Chip Study for our institution')}`}>
            {site.email}
          </a>
        </p>
      </div>
    </section>
  );
}

function faq(prices: InstitutionPrices | null | undefined): string[][] {
  const line = prices ? priceLine(prices, visitorPriceCurrency()) : null;
  return FAQ.map(([q, a]) =>
    q === 'What does it cost?' && line ? [q, `A free one-term pilot first. After that, ${line}, billed yearly by invoice, from ${minStudents(prices!)} students. Teachers and admins don’t take seats.`] : [q, a],
  );
}

const FAQ = [
  [
    'We already give students an AI tool. Why this too?',
    'Keep it. Chip Study works alongside the AI tools you already give students. Those answer questions; Chip Study is where the studying happens. Chip guides before it tells, practice comes from students’ own notes, and every bit of help on an assignment goes into a record nobody can edit. That record, and how students are getting on, is what your institution sees.',
  ],
  [
    'Can staff read students’ chats or documents?',
    'No. Admins and teachers see activity (study time, practice scores, how often students ask Chip, their assignments) and each assignment’s AI-use record: the kind of help, and when. Never chats, notes, documents, or the words of a question or an answer. Students are told this before they join.',
  ],
  ['Who sees which students?', 'Admins see every student at your institution. Teachers see only the students in the classes they teach.'],
  [
    'How do students join?',
    'Three ways: a class code, an invite link sent to their email, or (once we’ve confirmed your email domain) signing in with their school email. Each way shows them what you’ll see first, and joining is their choice.',
  ],
  ['What does it cost?', `A free one-term pilot first, then one price per student, billed yearly by invoice. Write to ${site.email} for it.`],
  ['What happens when the pilot ends?', 'Students keep their accounts and everything they’ve made. The Pro that came with your institution stops until you move to paid seats.'],
  ['Can students leave?', 'Yes, at any time, in Settings. Leaving ends what you can see of them and the Pro that came from you. Their work stays theirs.'],
  ['Which AI is Chip?', 'Chip runs on Claude, made by Anthropic. Anthropic doesn’t use students’ work to train its models, and neither do we.'],
  ['Is it for younger students?', 'Chip Study is for students 13 and over. Under-18s need a parent’s or guardian’s permission, as our Terms say.'],
];

function Faq() {
  const prices = useInstitutionPrices();
  return (
    <section id="faq" className="l-section" aria-labelledby="faq-title">
      <div className="l-wrap max-w-3xl">
        <SectionHead id="faq-title" kicker="Questions" title="What institutions ask." />
        <div className="mt-12 space-y-3">
          {faq(prices).map(([q, a]) => (
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
            Bring honest AI to your students.
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-lg leading-relaxed text-ink-2">Register on a short form. We check it, set up a free one-term pilot, and you bring your students in.</p>
          <a href={REGISTER} className="btn btn-primary mt-8 h-12 px-7 text-base">
            Register your institution <Arrow />
          </a>
          <p className="mt-5 text-sm text-ink-3">
            Questions first?{' '}
            <a className="font-semibold text-iris hover:text-iris-2" href={`mailto:${site.email}`}>
              {site.email}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
