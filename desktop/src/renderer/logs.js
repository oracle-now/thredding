const { buildDebugBundle } = require('../shared/debug-bundle');
const { badgeForFallbackReason } = require('../shared/log-badges');

let currentEntries = [];

const fmt  = ts => new Date(ts).toLocaleTimeString();
const age  = ts => { if (!ts) return 'never'; const s = Math.max(0,Math.floor((Date.now()-ts)/1000)); if(s<60) return `${s}s ago`; const m=Math.floor(s/60); if(m<60) return `${m}m ago`; return `${Math.floor(m/60)}h ago`; };
const esc  = v => String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function renderHealth(h) {
  document.getElementById('health-strip').innerHTML = [
    `<div class="health-chip ${h.sessionPresent?'health-chip--ok':'health-chip--warn'}">session: ${h.sessionPresent?'present':'missing'}</div>`,
    `<div class="health-chip ${h.watcherRunning?'health-chip--ok':'health-chip--neutral'}">watcher: ${h.watcherRunning?'running':'stopped'}</div>`,
    `<div class="health-chip health-chip--neutral">last debug: ${esc(age(h.lastCartDebugAt))}</div>`,
    `<div class="health-chip health-chip--neutral">last scan: ${esc(age(h.lastScanAt))}</div>`,
    `<div class="health-chip health-chip--neutral">last refresh: ${esc(age(h.lastRefreshAt))}</div>`
  ].join('');
}

function renderLogs(entries) {
  currentEntries = entries;
  document.getElementById('log-root').innerHTML = entries.slice().reverse().map(e => {
    const badge = badgeForFallbackReason(e?.meta?.fallbackReason);
    const badgeHtml = badge ? `<span class="log-badge log-badge--${esc(badge.tone)}">${esc(badge.label)}</span>` : '';
    const metaRows = [];
    if (e.meta?.strategy)      metaRows.push(`<div class="log-meta-row"><span class="log-meta-key">strategy</span><span>${esc(e.meta.strategy)}</span></div>`);
    if (e.meta?.fallbackReason) metaRows.push(`<div class="log-meta-row"><span class="log-meta-key">fallback</span><span>${esc(e.meta.fallbackReason)}</span></div>`);
    if (e.meta?.url)            metaRows.push(`<div class="log-meta-row"><span class="log-meta-key">url</span><span>${esc(e.meta.url)}</span></div>`);
    return `<article class="log-entry log-entry--${esc(e.level)}">
      <div class="log-entry-main"><span class="log-time">${esc(fmt(e.ts))}</span><span>${esc(String(e.level).toUpperCase())}</span><span>${esc(e.event)}</span>${badgeHtml}</div>
      <div class="log-message">${esc(e.message)}</div>
      ${metaRows.length?`<div class="log-meta">${metaRows.join('')}</div>`:''}
    </article>`;
  }).join('');
}

async function refreshAll() {
  const [logs, health] = await Promise.all([window.threddingDesktop.getLogs(), window.threddingDesktop.getHealth()]);
  renderLogs(logs);
  renderHealth(health);
}

const flash = msg => { const el = document.getElementById('toolbar-status'); el.textContent = msg; setTimeout(()=>{ el.textContent=''; }, 2000); };

document.getElementById('copy-debug-bundle').addEventListener('click', async () => {
  await window.threddingDesktop.copyText(buildDebugBundle(currentEntries, 30));
  flash('Copied debug bundle');
});
document.getElementById('save-debug-bundle').addEventListener('click', async () => {
  const r = await window.threddingDesktop.saveTextFile(buildDebugBundle(currentEntries, 30), 'thredding-debug.txt');
  flash(r.ok ? 'Saved' : r.cancelled ? 'Cancelled' : 'Save failed');
});
document.getElementById('clear-logs').addEventListener('click', async () => {
  await window.threddingDesktop.clearLogs();
  await refreshAll();
  flash('Logs cleared');
});

refreshAll();
setInterval(() => refreshAll().catch(()=>{}), 5000);
