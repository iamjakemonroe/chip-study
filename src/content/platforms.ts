/** Connecting a learning platform (LTI 1.3): the addresses Chip Study gives, what each platform
 * fills in for itself, and short help for each, after "Connect a learning platform" in Kaivon's
 * institutions pack. */

/** Chip Study's Application ID on Blackboard's developer portal (public, not a secret). */
export const BLACKBOARD_APP_ID = '6b29b222-febd-4a33-b399-6e1951fc3898';

export type PlatformKind = 'moodle' | 'canvas' | 'blackboard' | 'brightspace' | 'other';

export interface PlatformFields {
  name: string;
  issuer: string;
  client_id: string;
  deployment_id: string;
  auth_url: string;
  jwks_url: string;
}

/** The four addresses a platform needs from Chip Study, under the study-lti function. */
export function ltiAddresses(supabaseUrl: string) {
  const base = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/study-lti`;
  return [
    { key: 'launch', label: 'Launch (tool URL, redirect URI)', url: `${base}/launch` },
    { key: 'login', label: 'Login (OpenID Connect login URL)', url: `${base}/login` },
    { key: 'jwks', label: 'Public keyset (JWKS URL)', url: `${base}/jwks` },
    { key: 'canvas', label: 'Canvas configuration URL', url: `${base}/canvas.json` },
  ] as const;
}

/** What's known in advance for each platform: the rest comes from the platform itself. Canvas's
 * are for Instructure's cloud, and can be changed for a self-hosted Canvas. */
export const PRESETS: Record<PlatformKind, Partial<PlatformFields>> = {
  moodle: { name: 'Moodle' },
  canvas: {
    name: 'Canvas',
    issuer: 'https://canvas.instructure.com',
    auth_url: 'https://sso.canvaslms.com/api/lti/authorize_redirect',
    jwks_url: 'https://sso.canvaslms.com/api/lti/security/jwks',
  },
  blackboard: {
    name: 'Blackboard',
    issuer: 'https://blackboard.com',
    client_id: BLACKBOARD_APP_ID,
    auth_url: 'https://developer.blackboard.com/api/v1/gateway/oidcauth',
    jwks_url: `https://developer.blackboard.com/api/v1/management/applications/${BLACKBOARD_APP_ID}/jwks.json`,
  },
  brightspace: { name: 'Brightspace' },
  other: {},
};

export const PLATFORM_LABEL: Record<PlatformKind, string> = {
  moodle: 'Moodle',
  canvas: 'Canvas',
  blackboard: 'Blackboard',
  brightspace: 'Brightspace',
  other: 'Another platform',
};

/** Short steps for each platform's admin. The full guide is in the institutions pack. */
export const PLATFORM_HELP: Record<PlatformKind, string[]> = {
  moodle: [
    'Site administration › Plugins › Activity modules › External tool › Manage tools › configure a tool manually.',
    'Name it Chip Study and choose LTI 1.3. Tool URL and redirection URI: the launch address. Public key type: Keyset URL, with the keyset address. Initiate login URL: the login address.',
    'Show it in the activity chooser, open it in a new window, and share the launcher’s name and email: Always.',
    'Open the tool’s configuration details and copy the Platform ID, Client ID, Deployment ID, Public keyset URL (…/mod/lti/certs.php) and Authentication request URL (…/mod/lti/auth.php) into the form here.',
  ],
  canvas: [
    'Admin › Developer Keys › + Developer Key › + LTI Key. Method: Enter URL, and paste the Canvas configuration URL. Redirect URIs: the launch address. Save, then turn the key on.',
    'The key’s number is the Client ID. Admin › Settings › Apps › View App Configurations › + App, by Client ID, and install it.',
    'Open the app’s settings (the gear) › Deployment Id, and copy it into the form here with the Client ID.',
    'The issuer and the two Canvas addresses are filled in for Instructure’s cloud. For beta or test, change the issuer to canvas.beta or canvas.test; a self-hosted Canvas uses its own domain.',
  ],
  blackboard: [
    'Administrator Panel › Integrations › LTI Tool Providers › Register LTI 1.3/Advantage Tool, and paste Chip Study’s Application ID (below).',
    'Under user fields to send, include name and email address, then approve.',
    'Copy the Deployment ID Blackboard shows into the form here. Everything else is filled in.',
  ],
  brightspace: [
    'Admin Tools › Manage Extensibility › LTI Advantage › Register Tool › Standard. Name it Chip Study; domain: the start of the launch address (https://…supabase.co).',
    'Redirect URL: the launch address. OpenID Connect login URL: the login address. Keyset URL: the keyset address. No extensions needed. Register.',
    'Copy the Client Id, the Brightspace Keyset URL (…/d2l/.well-known/jwks), the OpenID Connect Authentication Endpoint (…/d2l/lti/authenticate) and the Issuer (your site’s address) into the form here.',
    'View Deployments › New Deployment: tick Name and Email, pick the org units, save, and copy the Deployment Id. Then add a Basic Launch link with the launch address so teachers can add it to courses.',
  ],
  other: [
    'Any platform that supports LTI 1.3 works. Give it the launch, login and keyset addresses, and ask it to share each person’s name and email.',
    'Then copy its issuer (platform ID), client ID, deployment ID, authentication request URL and keyset URL into the form here.',
  ],
};

/** Every address must be https, and the rest filled in. Answers what's wrong, by field. */
export function checkPlatform(f: PlatformFields): Partial<Record<keyof PlatformFields, string>> {
  const out: Partial<Record<keyof PlatformFields, string>> = {};
  const https = (v: string) => /^https:\/\/[^\s/]+\.[^\s]+$/.test(v.trim());
  if (!https(f.issuer)) out.issuer = 'An https:// address, exactly as the platform shows it.';
  if (!f.client_id.trim()) out.client_id = 'Copy it from the platform.';
  if (!f.deployment_id.trim()) out.deployment_id = 'Copy it from the platform.';
  if (!https(f.auth_url)) out.auth_url = 'An https:// address.';
  if (!https(f.jwks_url)) out.jwks_url = 'An https:// address.';
  return out;
}
