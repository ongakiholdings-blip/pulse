# DBOTPULSE — Deriv Trading Bot

A self-hosted visual trading-bot builder on the Deriv WebSocket API. Features drag-and-drop strategy building with Blockly, an interactive SmartCharts chart, automated strategy execution, and a dashboard with tutorials.

## Stack

- **Framework:** Rsbuild + React 18 + React Router v6
- **State:** MobX
- **Charts:** `@deriv-com/smartcharts-champion`
- **Strategy editor:** Blockly
- **API:** Deriv WebSocket API (`@deriv/deriv-api`)

## Running the app

```bash
npm install
npm run dev        # starts dev server on port 5000
```

The workflow `Start application` runs `rsbuild dev` and serves on port 5000 (`0.0.0.0`, all hosts allowed).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_DERIV_APP_ID` | For login | Deriv OAuth app id — get one at https://developers.deriv.com/dashboard/ |
| `NEXT_PUBLIC_DERIV_ENV` | No | `production` or `staging` (default: production) |
| `NEXT_PUBLIC_DERIV_REFERRAL_LINK` | No | Affiliate referral link |
| `GD_CLIENT_ID` / `GD_APP_ID` / `GD_API_KEY` | No | Google Drive integration for saving/loading strategies |

Variables are baked in at build time via `rsbuild.config.ts`. Set them as Replit Secrets, then restart the workflow.

> Without `NEXT_PUBLIC_DERIV_APP_ID`, the app loads but Login/Sign-up buttons are disabled.

## Build for production

```bash
npm run build      # output goes to dist/
```

## Branding

Edit `brand.config.json` then run `npm run generate:brand-css`. Runs automatically on `npm install`, `npm run dev`, and `npm run build`.

## User preferences

- Get it running first, then make specific changes to the code.
