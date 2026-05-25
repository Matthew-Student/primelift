# PRIME LIFT — Deployment Guide

A workout, diet, and ranking app for you and your friends. Track Big 5 lifts, get diet targets calculated from Mifflin-St Jeor, compete on a bodyweight-relative leaderboard, and install it on iOS + Android home screens.

You're about to deploy this for real. Follow these steps in order. Total time: about 25-30 minutes.

---

## STEP 1 — Create your Firebase project (5 min)

Firebase gives you free user accounts and a cloud database. You won't be charged anything for two users.

1. Go to **https://console.firebase.google.com/**
2. Sign in with a Google account (or create one)
3. Click **Add project**
4. Name it `prime-lift` (or anything you like)
5. **Disable Google Analytics** (uncheck it — we don't need it)
6. Click **Create project** → wait ~30 seconds → click **Continue**

---

## STEP 2 — Add a web app and get your config (3 min)

1. On the project home page, click the **Web icon `</>`** (in the "Get started by adding your first app" row)
2. Nickname it `prime-lift`
3. **Do NOT** check "Also set up Firebase Hosting" — we'll do that separately
4. Click **Register app**
5. You'll see a code block with a `firebaseConfig` object. **Keep this tab open** — you'll copy these values in Step 5.
6. Click **Continue to console**

The config object looks like this:

```js
const firebaseConfig = {
  apiKey: "AIzaSyB...",
  authDomain: "prime-lift.firebaseapp.com",
  projectId: "prime-lift",
  storageBucket: "prime-lift.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc..."
};
```

---

## STEP 3 — Enable Email/Password sign-in (1 min)

1. In the left sidebar of Firebase console: **Build → Authentication**
2. Click **Get started**
3. Under **Sign-in method** tab → click **Email/Password**
4. Toggle the first switch on → click **Save**

---

## STEP 4 — Enable Firestore and apply security rules (3 min)

1. Left sidebar: **Build → Firestore Database**
2. Click **Create database**
3. Choose a location near you (e.g. `asia-southeast1` for the Philippines)
4. Choose **Start in production mode** → click **Enable**
5. Wait for it to provision (~30 seconds)
6. Click the **Rules** tab at the top
7. Delete everything in the rules editor and paste this in:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null && request.auth.uid == userId;
      allow delete: if request.auth != null && request.auth.uid == userId;

      match /workouts/{workoutId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }

      match /diet/{dateId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

8. Click **Publish**

(This is also in `firestore.rules` in your project folder if you want to compare.)

---

## STEP 5 — Paste your config into the app (1 min)

1. Open `firebase-config.js` in this folder in any text editor (Notepad, VS Code, TextEdit — whatever you have)
2. Replace the placeholder values with the ones from Step 2
3. Save the file

It should look like the example block in Step 2, but with `export const` in front.

---

## STEP 6 — Deploy to Netlify (5 min, zero command line)

1. Go to **https://app.netlify.com/drop**
2. Sign up with email or GitHub if you haven't already (free)
3. Drag your entire `primelift` folder onto the page
4. Wait ~30 seconds for deployment
5. You'll get a URL like `https://nervous-bardeen-abc123.netlify.app`
6. **Optional**: click **Site settings → Change site name** to give it a nicer URL like `prime-lift-yourname.netlify.app`

That URL is your app. Open it on your phone right now.

---

## STEP 7 — Install on your phones (2 min each)

### Android (Chrome)

1. Open your Netlify URL in Chrome
2. Tap the **⋮** menu (top-right) → **Install app** (or **Add to Home screen**)
3. Confirm. The Prime Lift icon now sits on your home screen.

### iOS (Safari — must be Safari)

1. Open your Netlify URL in **Safari** specifically (not Chrome on iOS)
2. Tap the **Share** button (square with arrow up, bottom center)
3. Scroll → **Add to Home Screen** → **Add**
4. The Prime Lift icon now sits on your home screen.

Tap the icon → it opens full-screen with no browser bar, exactly like a native app.

---

## STEP 8 — Both you and your friend sign up

1. Each person opens the installed app
2. Tap **Sign Up** at the top
3. Enter a display name, email, password
4. Hit Sign Up

You're now both in. Once each of you logs a lift and sets your bodyweight in Profile, you'll see each other on the **Rank** tab leaderboard.

---

## How the app works

**Home** — Your current tier (Recruit → Olympian), your Big 5 PRs as estimated 1-rep-max, last 10 lifts.

**Log** — Add a working set. Pick a lift, enter weight × reps × sets. App calculates e1RM using Epley formula (`weight × (1 + reps/30)`, capped at 12 reps for accuracy) and updates your PR if higher.

**Plan** — Weekly routine. Auto-generates based on your BMI (underweight → bulk-focused, normal → PPL split, etc.). Calendar at top highlights today.

**Rank** — Your tier badge, progress bar to next tier, full tier ladder, and leaderboard sorted by `total Big 5 ÷ bodyweight` ratio so it's fair across body sizes.

**Diet** — Mifflin-St Jeor BMR × activity factor → adjusted for cut/maintain/bulk → protein at 2.0-2.4 g/kg, fat at 25-30% of cals, carbs fill the rest. Quick-add common meals, custom entry, food recommendations based on what macro you're still short on.

**Profile** (tap avatar top-right) — Edit name/height/weight/age/sex, switch KG/LB, sign out, delete account.

---

## Costs

You will never be charged on the Firebase free tier ("Spark plan"):
- **Firestore**: 50,000 reads/day, 20,000 writes/day. Two users won't come close.
- **Auth**: free up to 50,000 monthly users.
- **Netlify**: 100GB bandwidth/month free.

Firebase will never auto-upgrade you to paid. You'd have to manually click upgrade and add a credit card.

---

## Modifying it later

After making changes locally, redeploy to Netlify:

1. Open your existing Netlify site → **Deploys** tab
2. Drag the updated folder onto the deploy area
3. Done — new version is live in 30 seconds

**Important**: if you change app code (`app.js`, `styles.css`, `index.html`), bump the `CACHE` constant in `sw.js` (e.g. `primelift-v1` → `primelift-v2`) so installed users get the new version on next open.

---

## Troubleshooting

**"Firebase: Error (auth/configuration-not-found)"** → Email/Password sign-in isn't enabled. Repeat Step 3.

**"Missing or insufficient permissions"** → Firestore rules weren't published. Repeat Step 4 (rules tab, paste, Publish).

**Leaderboard is empty / app loads but nothing happens** → Most likely `firebase-config.js` still has placeholder values. Open it, paste the real config from Step 2.

**iOS "Add to Home Screen" option missing** → You're not in Safari. iOS only allows PWA install from Safari, not Chrome/Firefox on iOS.

**Stuck on loading spinner** → Open browser dev tools (right-click → Inspect → Console tab) to see the error message.

---

## What's in this folder

```
index.html           — Page structure
app.js               — All app logic (~1500 lines)
styles.css           — Theme + animations (~1800 lines)
firebase-config.js   — Your Firebase keys (EDIT THIS)
manifest.json        — PWA install metadata
sw.js                — Service worker (offline + caching)
firestore.rules      — Database security (paste into Firebase console)
icons/               — App icons (192px, 512px, 512px maskable)
README.md            — This file
```

Good lifts.
