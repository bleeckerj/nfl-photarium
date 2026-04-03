# Adjacent Projects

This directory is a command boundary for projects that are intentionally separate from the main Photarium application.

## Current project

- `photarium-client-sites`

## Usage

From this directory:

```bash
npm run dev
npm run seed:demo
npm run build
npm run test
```

These commands proxy into `./photarium-client-sites` so `npm` does not walk upward into the main `photarium` package.
