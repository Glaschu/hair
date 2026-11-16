# App Store screenshots & E2E testing

Automated UI runs are driven by [Maestro](https://docs.maestro.dev) flows in
`.maestro/`. The same infrastructure produces App Store screenshots and runs
end-to-end smoke tests against a Release build (JS is bundled in, so your
Metro terminal is never touched).

## One-time setup

```sh
curl -fsSL https://get.maestro.mobile.dev | bash
```

The scripts find Maestro in `~/.maestro/bin` automatically. Java is required
(already installed via Homebrew).

## Commands

```sh
npm run screenshots   # capture App Store screenshots for iPhone + iPad
npm run test:e2e      # run .maestro/tests/ (seed → browse tabs → book appointment)
```

Both build the app once with `xcodebuild` (Release, simulator) and reuse that
build afterwards — pass `REBUILD=1` after changing app code:

```sh
REBUILD=1 npm run screenshots
```

The scripts create their own simulators (`iris-maestro-iphone`,
`iris-maestro-ipad`) so your development simulator is left alone. Each run:

1. Boots the sim and applies the classic App Store status bar (9:41, full
   battery/signal).
2. Installs the Release build.
3. Starts from a clean app state, loads the demo dataset through
   Settings → Reset / wipe data → Reset to demo data (demo appointments are
   generated relative to "today", so screenshots always show a full book).
4. Walks the app and saves PNGs to `screenshots/` (gitignored).

## What Apple requires

| Slot | Simulator | Pixels | Needed? |
|---|---|---|---|
| iPhone 6.9" | iPhone 17 Pro Max | 1320×2868 | Required |
| iPad 13" | iPad Pro 13-inch | 2064×2752 | Required (app has `supportsTablet: true`) |
| Smaller iPhones/iPads | — | — | No — Apple scales the sizes above down |

Up to 10 screenshots per slot; the first 3 show in search results. The script
prints every captured file with its pixel size so you can confirm the numbers
match before uploading.

Upload: App Store Connect → your app → the iOS version → **App Previews and
Screenshots**. Drag the files from `screenshots/iphone-6.9/` and
`screenshots/ipad-13/`.

## Captured shots

iPhone: Today, Calendar, Clients, client detail, Inventory, Reports.
iPad (portrait): Today, Calendar, Clients, Inventory, Reports, Room mode.

To change the set, edit `.maestro/screenshots-iphone.yaml` /
`screenshots-ipad.yaml` — each shot is a `tapOn` … `takeScreenshot` pair.

## Rest of the App Store submission checklist

- **App icon**: `assets/icon.png` must be 1024×1024 with no alpha channel.
- **Privacy policy URL**: required field. The in-app policy
  (`src/components/PrivacyPolicy.tsx`) needs a public web copy to link to.
- **App privacy (nutrition label)**: the app is local-first, but Sentry is
  bundled — declare *Diagnostics → Crash Data* (not linked to identity, not
  used for tracking). Everything else can be "Data Not Collected".
- **Encryption**: already declared (`ITSAppUsesNonExemptEncryption: false`).
- **Review notes tip**: tell App Review the app needs no account, and that
  Settings → Reset / wipe data → "Reset to demo data" populates it instantly.
- **Category**: Business (primary) / Lifestyle (secondary) fit a salon tool.

## Troubleshooting

- *Maestro can't find the device*: the sim may still be booting — rerun; the
  script waits on `simctl bootstatus` but very first boots can be slow.
- *Wrong screenshot sizes*: the device types changed with a new Xcode.
  Override without editing anything:
  `PHONE_TYPE=com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max npm run screenshots`
- *Flows fail after UI copy changes*: the flows tap by visible text and
  accessibility labels ("Reset / wipe data", "Confirm Booking", tab names,
  sidebar labels). Renaming those strings means updating the YAML to match.
- Remove the dedicated sims anytime: `xcrun simctl delete iris-maestro-iphone iris-maestro-ipad`.
