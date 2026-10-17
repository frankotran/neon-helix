# NEON HELIX — Monetization Plan (ads)

Web build simulates every placement with a skippable card so flows are
testable end-to-end. The native App Store build (Capacitor + AdMob) swaps the
marked `ADMOB` points in `game.js` (`Ads.maybeInterstitial`, `Ads.rewarded`)
without touching game code.

## Placements

| Placement | Type | Trigger | Policy |
|---|---|---|---|
| Game-over interstitial | Interstitial | After death | Every 3rd game over AND ≥45s since last. Never during a run. |
| Revive | Rewarded | Game-over screen | Once per run. Continues from last row with 3s shield. |
| 2x coins | Rewarded | Level-clear screen | Once per clear. Doubles the coin bonus. |
| Coin boost | Rewarded | Shop, when short on coins | +50 coins per view. |
| (future) Remove Ads | IAP $2.99 | Shop / settings | Disables interstitials only; rewarded stays. |

## Policy notes
- Frequency caps live in `Ads.*` (one place) — policy changes never touch game code.
- No ads in the first 2 runs of a fresh install (goodwill; implement natively).
- Rewarded ads never gate core progression — only convenience/cosmetics.
- All rewarded placements grant the reward even if the ad is skipped in the
  simulated web build (test hook `NH.skipAd()`).

## Native path (App Store)
1. `npm i @capacitor/core @capacitor/cli`, `npx cap init`, add iOS platform.
2. Add AdMob plugin (`@capacitor-community/admob`), configure App IDs.
3. Replace the two `ADMOB` bodies in `game.js`; keep callbacks identical.
4. Banner (optional, low yield): anchor to bottom of menu + game-over screens.
