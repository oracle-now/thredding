# Thredding

Latency-optimized ThredUp cart hoarding tool. Forked and improved from [cart-hoarding/thredup-cart-hoarding](https://github.com/cart-hoarding/thredup-cart-hoarding).

## What was fixed

- Replaced blocking `setInterval` with visibility-aware polling (pauses when tab is hidden)
- Added animated loading states so the page feels fast on first load
- Replaced deprecated `document.execCommand('copy')` with modern `navigator.clipboard` API
- Added `preconnect` hints for CDN resources to cut render-blocking time
- Added explicit request timeout (8s) with user-friendly error fallback
- Removed redundant Bootstrap JS from `buy.htm` (not needed)
- Cleaned up dead/commented-out code

## Deploy

- **Frontend:** Deploy this repo to Vercel (static, instant global CDN)
- **Backend:** Keep API on Railway paid/always-on at `server-production-4c65.up.railway.app`
