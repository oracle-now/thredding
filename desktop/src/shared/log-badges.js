function badgeForFallbackReason(reason) {
  if (!reason) return null;
  const map = {
    primary_succeeded:         { label: 'Primary ok',        tone: 'success' },
    no_add_control_found:      { label: 'No add control',    tone: 'danger'  },
    timer_unchanged:           { label: 'Timer unchanged',   tone: 'warn'    },
    timer_missing_after_click: { label: 'Timer missing',     tone: 'warn'    },
    product_page_failed:       { label: 'Product page fail', tone: 'danger'  },
    missing_item_url:          { label: 'Missing URL',       tone: 'neutral' }
  };
  return map[reason] || { label: 'Unknown fallback', tone: 'neutral' };
}

module.exports = { badgeForFallbackReason };
