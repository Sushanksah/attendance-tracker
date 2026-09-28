# Attendance Tracker

A responsive React and Vite application for tracking student attendance.

## Features

- Supabase signup, login, password reset, and logout
- Profile editing in an in-page dialog
- Add, edit, and delete subjects in an in-page dialog
- Export formatted Excel attendance reports with color-coded status
- Overall attendance calculation
- Subject attendance status
- Classes required to reach a target
- Classes that can be missed while maintaining a target
- Attendance planner, Google Calendar schedule, and what-if calculator
- Supabase Row Level Security for user-specific data

The subject report workbook includes the student name, PRN, export date, weighted overall attendance, and each subject's attended/total classes, current percentage, and status. Status colors are green for safe, amber for warning, and red for below target. The target value is deliberately not included in the export. Open the downloaded `.xlsx` file with Excel or another spreadsheet app.

Subject counts and the What-if calculator use keyboard-entered numeric fields rather than scrollable number spinners. What-if fields can be cleared while editing; calculations appear once the values are valid.

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Add the Supabase project URL and anon/public key to `.env`:

```text
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Run [supabase-schema.sql](./supabase-schema.sql) in the Supabase SQL Editor before testing database features.

## Google Calendar setup

The Calendar connection uses Google's browser OAuth flow. In Google Cloud Console:

1. Enable the **Google Calendar API** in the Google Cloud project used by your OAuth client.
2. Configure the OAuth consent screen and add your Google account as a test user if the app is still in testing.
3. Create or open an OAuth client with application type **Web application**.
4. Under **Authorized JavaScript origins**, add the exact site origins where the app runs, for example:
   - `http://localhost:5173`
   - `http://localhost:4000` (if your local app opens at `localhost:4000`)
   - `https://your-project.vercel.app`
   - `https://your-custom-domain.com` (if you use one)
5. Copy that client's ID into `VITE_GOOGLE_CLIENT_ID` in `.env` and the Vercel environment variables, then redeploy.

An origin contains only the scheme, hostname, and optional port. Do not add a path or a trailing slash. Vercel preview deployments can have different hostnames; use the stable production domain for normal use and add any preview origin individually when needed. The app uses Google's popup token flow, so the important setting is **Authorized JavaScript origins**.

If Google displays `Error 400: origin_mismatch`, the origin of the open app is missing from the OAuth client's **Authorized JavaScript origins** list, or the app is using a different client ID from the one you edited. This is a Google Cloud configuration error and cannot be fixed by changing the popup in the app.

Use the origin shown in your browser address bar, not a guessed local port. For example, if the app opens at `http://localhost:4000`, register exactly `http://localhost:4000`. Restart/reload the app after saving the OAuth client settings and verify that `VITE_GOOGLE_CLIENT_ID` is the ID of that same Web application client.

If the origin is listed but Google still reports `origin_mismatch`, compare the OAuth client ID configured by the app with the ID shown in Google Cloud. A correct origin on a different OAuth client does not authorize this app. After changing `.env`, stop and restart the Vite server so it reloads the client ID; after changing Vercel variables, redeploy the app.

## Vercel and persistent subject data

Subjects are stored in Supabase, not in Vercel. In Vercel, open **Project → Settings → Environment Variables** and set:

- `VITE_SUPABASE_URL` to the URL of the same Supabase project used by your local `.env`
- `VITE_SUPABASE_ANON_KEY` to that project's publishable/anon key
- `VITE_GOOGLE_CLIENT_ID` to the Web application OAuth client ID

Add the variables to the **Production** environment (and Preview too if you use preview deployments), then redeploy. The database schema and RLS policies in `supabase-schema.sql` must also have been applied to that same Supabase project. Sign into the same Attendance Tracker account on both sites; Google Calendar authorization is separate from the app's Supabase account.

### Sign-in persistence

Supabase keeps the sign-in session in browser storage and refreshes it automatically. Sign in once on each browser/device; another phone or browser cannot safely inherit the session from your computer. On later visits, use the same exact site URL (for example, the production Vercel domain), because each hostname has separate browser storage. Private/incognito browsing, clearing site data, or browser privacy settings that block storage can require signing in again. On page load, the app restores the saved session before showing the login form.

If a previous build saved subjects only in this browser, and the database has no subjects for the signed-in account, the dashboard offers an explicit button to import those browser-saved subjects into Supabase. Browser storage is specific to a site origin, so subjects saved at `localhost` are not automatically available at a Vercel URL. Open the old site in the same browser to retrieve its local data; otherwise those local-only subjects must be entered again.

## Publishing updates through GitHub

If this GitHub repository is connected to the Vercel project, pushing a commit to the production branch (usually `main`) automatically starts a new Vercel deployment. A push does not delete Supabase data; data remains in the configured Supabase project. Before publishing:

1. Run `npm run lint` and `npm run build` locally.
2. Confirm the Vercel environment variables are configured for the correct Supabase project and Google OAuth client.
3. Push the changes to GitHub. Check the Vercel deployment status after the push.

If the Vercel build fails, Vercel normally keeps serving the last successful deployment. Code changes are not a database migration: for any future schema changes, review and apply the SQL migration to Supabase separately. Never commit `.env` or service-role keys; `.env` is excluded by `.gitignore`.

## Validation

```bash
npm run lint
npm run build
```
