import { Link } from 'react-router';
import { Orb } from '../components/Orb.tsx';

export function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div className="daylight" />
      <div>
        <Orb size={64} className="mx-auto" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">This page wandered off</h1>
        <p className="mt-2 text-ink-3">It isn’t here. Let’s get you back to your desk.</p>
        <Link to="/app" className="btn btn-primary mt-6">
          Back to my desk
        </Link>
      </div>
    </main>
  );
}
