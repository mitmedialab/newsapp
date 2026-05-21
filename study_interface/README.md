# Study Interface

This folder contains the participant-facing interface code and the phase-wise image/data assets used by the study.

## Structure

- `Dialogues with AI app/user-interface/`
  - React app for the study interaction flow.
  - Important folders:
    - `src/`: interface logic and helper utilities.
    - `public/`: static assets served by the app.
  - Important files:
    - `package.json`: dependencies and scripts.
    - `craco.config.js`: CRA/CRACO configuration.

- `Phase wise Data/`
  - Phase-specific image sets and metadata.
  - Includes `Phase 1`, `Phase 2`, and `Phase 3` with train/test images and JSON mapping files.

## What Is Intentionally Tracked

- App source code and static assets needed to run the interface.
- Phase data files needed to reproduce the interface behavior and study prompts.

## What Is Intentionally Ignored

Ignore rules are defined in the repository root `.gitignore` for this folder:

- `node_modules/`
- `build/`
- `.cache/`
- `.vercel/`
- `.DS_Store`
- local env files (for example `.env.local`)
- log files

This keeps the repository reproducible while avoiding large generated artifacts and local secrets.

## Local Run (User Interface)

From `Dialogues with AI app/user-interface/`:

```bash
npm install
npm start
```

Optional scripts:

```bash
npm run build
npm test
```

## Notes

- Do not commit API keys or other secrets.
- If you add new generated folders, extend root `.gitignore` before committing.