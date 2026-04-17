# Thredding Desktop

Bootstrap Electron tray app scaffold for the actual CartSniper-style desktop runtime.

## Included

- Tray-first Electron shell.
- Playwright persistent profile management.
- One-click login opener.
- Logs window with copy/save/clear actions.
- Runtime health strip for session, watcher, last scan, last debug, and last refresh.
- Diagnostics helpers for cart debug dumps.
- Session utilities for opening/resetting the saved browser profile.
- Clean module seams so refresh strategies can be patched without tangling UI and automation.

## Structure

- `src/main/` main process, tray wiring, Playwright/session/runtime helpers.
- `src/renderer/` logs window UI.
- `src/shared/` debug-bundle and badge helpers.

## Status

Initial scaffold push. Automation seams are ready; full cart scanning and refresh strategies are the next pass.
