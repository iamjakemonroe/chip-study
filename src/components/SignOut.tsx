import { useNavigate } from 'react-router';
import { useAuth } from '../store/auth.ts';
import { Confirm } from './ui.tsx';

/** Asks before signing out, then goes to sign in. */
export function SignOutConfirm({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const signOut = useAuth((s) => s.signOut);
  const email = useAuth((s) => s.session?.user.email ?? '');
  return (
    <Confirm
      open={open}
      title="Sign out of Chip Study?"
      body={
        <>
          Your work stays saved to your account. To come back, sign in with {email ? <span className="break-all font-semibold text-ink">{email}</span> : 'your email'} and the code we send you.
        </>
      }
      yes="Sign out"
      onClose={onClose}
      onYes={async () => {
        await signOut();
        navigate('/signin', { replace: true });
      }}
    />
  );
}
