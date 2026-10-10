# Мої витрати

A single-page expense calculator with a Ukrainian interface. It runs on GitHub Pages and stores data in Firebase Firestore, and it keeps working offline.

## 1. Firebase setup (one time, free "Spark" plan)
1. Go to https://console.firebase.google.com → **Add project** (you can turn off Google Analytics).
2. **Build → Firestore Database → Create database** → *production mode* → region `europe-central2` (Warsaw).
3. **Firestore → Rules**: replace everything with the contents of `firestore.rules` → **Publish**.
4. **Build → Authentication → Get started → Email/Password → Enable**.
5. **Authentication → Users → Add user**: enter your email and a strong password. This is your login.
6. Recommended: **Authentication → Settings → User actions**: untick *Enable create (sign-up)* so nobody else can register.
7. **Authentication → Settings → Authorized domains**: add `<your-github-user>.github.io`.
8. **Project settings (⚙) → Your apps → Web (`</>`)** → register the app → copy the `firebaseConfig` values into `firebase-config.js`.
   These values are public identifiers, not secrets. Access is protected by your login and `firestore.rules`.

## 2. Deploy to GitHub Pages
1. Push this folder to a GitHub repo.
2. Go to **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)`.
3. On the iPhone, open `https://<user>.github.io/<repo>/` in Safari → Share → **Add to Home Screen** → log in.

## How data is kept
- Every record is saved to Firestore at `users/{uid}/entries/{id}`. Only your account can read or write it.
- Offline, records are saved on the phone and sync automatically when you're back online. The status line shows ✓ / ⏳ / ☁︎.
  Wait for ✓ before you log out or reinstall the app.
- The first login needs internet. After that you stay logged in.
- **Експорт / Імпорт** makes an extra JSON backup. Import only adds missing records and never overwrites.
- Records from the earlier local-only version are moved to the cloud automatically on the first login.

## Updating
After changing any file, bump `CACHE` in `sw.js` so installed copies pick up the new version.
