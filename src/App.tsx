import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { ChipLoader } from './components/ChipLoader.tsx';
import { Toasts } from './components/ui.tsx';
import { startAuth } from './store/auth.ts';

startAuth();

// The screens load as they're needed: until the first one has, Chip's loader (the same as
// index.html's) stays up rather than a blank page.
const router = createBrowserRouter([
  {
    HydrateFallback: ChipLoader,
    children: [
  { path: '/', lazy: () => import('./landing/Landing.tsx').then((m) => ({ Component: m.Landing })) },
  { path: '/signin', lazy: () => import('./pages/SignIn.tsx').then((m) => ({ Component: m.SignIn })) },
  { path: '/terms', lazy: () => import('./pages/Legal.tsx').then((m) => ({ Component: m.Terms })) },
  { path: '/privacy', lazy: () => import('./pages/Legal.tsx').then((m) => ({ Component: m.Privacy })) },
  { path: '/institutions', lazy: () => import('./landing/Institutions.tsx').then((m) => ({ Component: m.Institutions })) },
  { path: '/join/:token', lazy: () => import('./pages/JoinPage.tsx').then((m) => ({ Component: m.JoinPage })) },
  { path: '/room/:token', lazy: () => import('./rooms/RoomPage.tsx').then((m) => ({ Component: m.RoomPage })) },
  { path: '/lti', lazy: () => import('./pages/LtiPage.tsx').then((m) => ({ Component: m.LtiPage })) },
  { path: '/guides/:slug', lazy: () => import('./landing/Guide.tsx').then((m) => ({ Component: m.Guide })) },
  {
    path: '/app',
    lazy: () => import('./pages/AppShell.tsx').then((m) => ({ Component: m.AppShell })),
    children: [
      { index: true, lazy: () => import('./pages/Dashboard.tsx').then((m) => ({ Component: m.Dashboard })) },
      { path: 'a/:id', lazy: () => import('./workspace/Workspace.tsx').then((m) => ({ Component: m.Workspace })) },
      { path: 'review', lazy: () => import('./pages/ReviewPage.tsx').then((m) => ({ Component: m.ReviewPage })) },
      { path: 'plan', lazy: () => import('./pages/PlanPage.tsx').then((m) => ({ Component: m.PlanPage })) },
      { path: 'settings', lazy: () => import('./pages/Settings.tsx').then((m) => ({ Component: m.Settings })) },
      { path: 'institutions/new', lazy: () => import('./pages/InstitutionNew.tsx').then((m) => ({ Component: m.InstitutionNew })) },
      { path: 'institution/:id', lazy: () => import('./institution/InstitutionPage.tsx').then((m) => ({ Component: m.InstitutionPage })) },
      { path: 'kaivon', lazy: () => import('./pages/KaivonPage.tsx').then((m) => ({ Component: m.KaivonPage })) },
    ],
  },
  { path: '*', lazy: () => import('./pages/NotFound.tsx').then((m) => ({ Component: m.NotFound })) },
    ],
  },
]);

export function App() {
  return (
    <>
      <RouterProvider router={router} />
      <Toasts />
    </>
  );
}
