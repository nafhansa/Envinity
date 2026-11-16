# Envinity web

Landing page (Astro) and per-user dashboard (React) for Envinity: share `.env` files with your team through a ticket, a QR code, or a unique code.

## Run

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # static output in dist/
```

## Structure

```
src/
  pages/
    index.astro        Landing page. Static HTML + React islands for the animations.
    dashboard.astro    Mounts the React dashboard (client:only="react").
  layouts/Base.astro   <head>, fonts, global CSS.
  components/          Landing sections. *.astro = no JS, *.jsx = framer-motion islands.
  dashboard/           React dashboard: store, hash router, views, UI parts.
  styles/
    global.css         Design tokens from the Securinity Figma file + landing styles.
    dashboard.css      Dashboard styles (same tokens).
```

## Dashboard notes

- Routes: `#/` overview, `#/tickets`, `#/tickets/:id`, `#/new`, `#/open`, `#/settings`.
- Demo only: data is mock and lives in memory (never written to browser storage), so it resets on reload. There is no backend, auth, billing or real encryption yet.
- Free tickets self-destruct 10 minutes after creation. Pro tickets are kept until the owner deletes them. Switching Pro to Free gives kept tickets a 10 minute timer.
- Demo codes to try under "Open a code": `4F7H-2KQM`, `Q9WN-6RTB`.
