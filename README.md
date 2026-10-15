# TOUCHLINE AI — Fire TV starter

A TV-first React/Vite + Express scaffold for an AI football tactical analyst.

## Current starter scope
- React interface designed for a 1920×1080 TV layout
- Keyboard/D-pad-friendly focusable navigation
- Express API proxy so the football API token stays server-side
- Football-data.org fixtures endpoint for the Premier League
- Honest demo-mode fallback for tactical statistics not included in the free plan
- Basic evidence-aware tactical analysis template (not yet connected to an LLM)

## Important data limitation
The football-data.org free plan provides delayed scores, fixtures, schedules and tables, with a limit of 10 requests/minute. It does **not** include the full live-score/lineup/statistics package shown on its paid plans. Therefore this starter does not pretend that fixture data alone proves tactical claims. The tactical-analysis panel clearly labels its sample statistics as demo data.

Before the hackathon submission, either:
1. Find a data source whose free tier explicitly includes the match statistics you need, or
2. Keep the live fixtures/results integration and use a clearly labelled, fixed historical/demo match dataset for the tactical-analysis showcase.

Verify API terms, attribution requirements, coverage, and current limits yourself before shipping.

## Requirements
- Node.js 20+ recommended
- A football-data.org account/token for API-backed fixtures (optional; app works in demo mode without it)

## Setup
```bash
npm install
cp .env.example server/.env
# Edit server/.env and set FOOTBALL_DATA_TOKEN if available
npm run dev
```
Open the Vite URL printed in the terminal. Backend defaults to `http://localhost:4000`.

On Windows PowerShell, if `cp` doesn't work:
```powershell
New-Item -ItemType Directory -Force server | Out-Null
Copy-Item .env.example server/.env
```
Create `server/.env` after creating the `server` folder, then add your token.

## API routes
- `GET /api/health`
- `GET /api/matches?competition=PL` — football-data.org if configured; demo fixtures otherwise
- `GET /api/analysis/demo` — sample tactical report explicitly marked as demo data

## Fire TV notes
This is a web app starter, not yet a packaged Fire TV app. Test at 1920×1080 and verify navigation with a remote or keyboard. Use Amazon's official Fire TV web-app guidance and the hackathon's current track instructions to choose the required simulator/testing path. A normal desktop browser preview alone is not proof of Fire TV compatibility.

## Next implementation steps
1. Validate the free API's competition coverage and responses.
2. Add a match detail route and select a match from the list.
3. Add a real-statistics schema; only render metrics present in provider data.
4. Connect an LLM on the server and send it only normalized match context.
5. Add player comparison only when comparable player stats are available.
6. Test focus movement, back behavior, errors, loading and empty states on the target environment.
7. Add AWS only after the MVP works.
