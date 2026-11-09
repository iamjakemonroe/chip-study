import '@fontsource-variable/inter';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { refineCurrency } from './lib/currency.ts';
import { captureReferral } from './lib/referral.ts';
import { hasSession } from './lib/session.ts';

const root = createRoot(document.getElementById('root')!);

// A friend's invite link (?ref=CODE) is kept on the device, whatever page it opens.
captureReferral();

// Prices show at once in the time zone's currency; the country Cloudflare sees settles it (once a
// visit), long before anyone scrolls to a price.
void refineCurrency();

// The landing page is all most first visits need: it loads on its own, without the app, the
// router or the Supabase client. Someone already signed in goes straight to their desk.
if (location.pathname === '/' && !hasSession()) {
  void import('./landing/Landing.tsx').then(({ Landing }) =>
    root.render(
      <StrictMode>
        <Landing />
      </StrictMode>,
    ),
  );
} else {
  if (location.pathname === '/') history.replaceState(null, '', '/app');
  void import('./App.tsx').then(({ App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}

if (import.meta.env.PROD && import.meta.env.MODE !== 'e2e' && 'serviceWorker' in navigator) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js').catch(() => undefined));
}
