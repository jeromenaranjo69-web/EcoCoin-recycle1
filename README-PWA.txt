# EcoCoin PWA – Updated Project

## Included
- Responsive mobile layout for Android and iPhone screens
- PWA manifest with 192px, 512px, maskable, and Apple touch icons
- Updated service worker with app-shell offline fallback and cache versioning
- Camera scan loop throttling and camera release when the app is backgrounded
- Existing manual input, reward calculation, transaction receipt, and payout UI retained

## Run locally
Use VS Code Live Server or another local HTTP server. Do not open index.html directly with file://.
Camera access requires HTTPS or localhost.

## Deploy
Upload the contents of this folder to an HTTPS static host such as GitHub Pages, Netlify, or Vercel.
After deploying, open the HTTPS URL on the phone.

## Install
- Android: Open the deployed site in Chrome, then choose Install app (or Add to Home Screen).
- iPhone: Open the deployed site in Safari, tap Share, then Add to Home Screen.

## QR scanner compatibility note
The current QR camera scanner uses the browser BarcodeDetector API. It works only in browsers that implement that API. Some iPhone Safari versions do not support it, so the app keeps manual quantity entry available as a fallback. Camera permission also requires HTTPS (or localhost).

## Important project limitation
This is a front-end PWA. It does not add a cloud database, user accounts, or real cash / GCash / Maya payout processing. Those require a secure backend and payment-provider integration.


## Photo material detection
- Choose or take a photo in the Photo Material Detection panel.
- Tap Detect Materials. The app downloads the TensorFlow.js and COCO-SSD model from jsDelivr the first time; internet is required for model loading.
- Review the suggested material for each detected object, then tap Add Confirmed Items.
- The general COCO-SSD model detects common everyday objects; it is not trained specifically for recycling. Bottle is suggested as plastic and book as cardboard, but suggestions must be reviewed. Aluminum cans and cardboard packaging may not be detected reliably. Assign detected objects manually or use Manual Material Input for missed items.
- Detection runs in the browser. The selected photo is not uploaded by this app to a server. Use HTTPS or localhost.
