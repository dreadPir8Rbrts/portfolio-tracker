# Deploying identity-based username login

The app uses Supabase Auth for passwords and sessions. `public.people.id` is the
login username; `name` is the display name. `auth_user_id` uniquely links the Auth
user, and `admin` controls authorization. Identity and role fields are managed in
Supabase, not through client updates. Emails stay in `auth.users`.

Apply all schema migrations in order on a fresh database. For an existing database,
apply only unapplied migrations. The identity migration preserves an internal
before snapshot and renames legacy participant references; never replay it.

Deploy `supabase/functions/username-login/index.ts` as `username-login`.
The checked-in Supabase function configuration sets gateway JWT verification to **false** because this is the password login
endpoint; it authenticates the submitted credentials itself. It relies on the
built-in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` Edge
Function environment variables. The service key stays within Supabase.
`resolve_login` must remain service-role-only. No public email lookup is provided.

DigitalOcean environment variables:

| Variable | Scope | Encrypt |
| --- | --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Build and runtime | No |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Build and runtime | No |
| APP_ORIGIN | Runtime | No |

Set `APP_ORIGIN` to `${APP_URL}` or the exact HTTPS origin without a trailing slash.
Remove the obsolete `AUTH_USERNAME_EMAILS` variable once this app version is
deployed. No additional DigitalOcean secret is needed for username login.

Use the Dockerfile, HTTP port 3000 and health path `/api/health`. Keep Supabase's
Auth Site URL aligned with the deployed origin. After deployment, verify login,
logout, financial data loading and partner access. Existing Auth passwords remain
unchanged. Participants without an Auth link cannot log in.

Login failures are generic. A database-backed limit permits ten attempts per
username per minute, in addition to Supabase Auth's own limits. Session tokens
are passed only to the caller and never logged or cached. The Next.js route uses
them to establish SSR cookies and checks the resulting identity before success.
