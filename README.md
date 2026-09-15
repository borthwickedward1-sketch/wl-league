# Winners and Losers League

A standalone version of the league dashboard, built to be deployed on a real
website instead of running inside a Claude artifact. The two things that
couldn't work in the artifact sandbox — live NFL score fetching and
persistent shared data — both work here, because this is just a normal
static site with a real Firestore database behind it.

## 1. Create a Firebase project (free tier is plenty)

1. Go to https://console.firebase.google.com and create a new project (you
   can turn off Google Analytics, it's not needed).
2. In the project, go to **Build → Firestore Database → Create database**.
   Start in **production mode** (we'll set rules below).
3. Go to **Project settings → General**, scroll to "Your apps," click the
   `</>` (web) icon, and register a new web app. It'll show you a config
   object with `apiKey`, `authDomain`, etc. — copy those.
4. Copy `.env.example` to `.env.local` and paste each value in.

## 2. Set Firestore security rules

This app has no user accounts — the in-app commissioner passcode is the only
gate on *editing*. Anyone can *read* the standings (that's the point, it's a
public dashboard). Paste this into **Firestore Database → Rules**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /poolLeague/{document} {
      allow read: if true;
      allow write: if true;
    }
  }
}
```

**Worth knowing:** this means anyone who inspects your site's network traffic
could technically write to the database directly, bypassing the in-app
passcode UI. For a friends' league this is normally a non-issue — but if you
want real protection, the next step up is Firebase App Check or a Cloud
Function that checks the passcode server-side before writing. Not included
here to keep this simple; ask if you want that added.

## 3. Run it locally

```
npm install
npm run dev
```

Opens at `http://localhost:5173`. Walk through the draft setup the same way
you did in the Claude version.

## 4. Deploy it

Any static host works — Netlify and Vercel both have free tiers and take
about two minutes:

**Vercel**
```
npm install -g vercel
vercel
```
Add the six `VITE_FIREBASE_*` variables in the Vercel project's
Settings → Environment Variables (same names as `.env.example`), then
redeploy.

**Netlify**
- Drag-and-drop the `dist/` folder (after `npm run build`) onto
  https://app.netlify.com/drop, **or** connect the GitHub repo and set the
  same env vars in Site settings → Environment variables.

## About the live standings fetch

The "Refresh" button pulls from ESPN's public (but unofficial/undocumented)
standings endpoint. It's the same one lots of hobby fantasy-football tools
use, and — unlike the Claude artifact — a real website has no restriction on
which domains it can call, so this should just work. Two caveats worth
knowing:

- It's not an official API. ESPN could change its shape or rate-limit it
  without notice. If it ever breaks, the "Manual correct" button is a
  backup — punch in each drafted team's W-L-T by hand from
  espn.com/nfl/standings and it feeds the exact same dashboard.
- Early in the season, or right after games finish, you may see 0-0 or
  slightly stale numbers for a team until ESPN's feed catches up.

## Project structure

```
src/
  App.jsx        the whole dashboard (setup, draft order, standings, etc.)
  firebase.js    Firebase init from your .env.local
  storage.js     get/set wrapper around Firestore — this is the only file
                 that would need to change if you swap Firestore for
                 something else (Supabase, a custom backend, etc.)
  main.jsx       React entry point
```
