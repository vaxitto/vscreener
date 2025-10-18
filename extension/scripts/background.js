const DEFAULT_ACCENT = '#7F00FF';
const ICON_SIZES = [16, 32, 48, 128];

chrome.runtime.onInstalled.addListener(() => {
  initializeActionIcon();
});

chrome.runtime.onStartup.addListener(() => {
  initializeActionIcon();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.accentColor) {
    const nextColor = changes.accentColor.newValue || DEFAULT_ACCENT;
    initializeActionIcon(nextColor);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'UPDATE_ACCENT_ICON') {
    (async () => {
      try {
        await initializeActionIcon(message.accentColor);
        sendResponse({ success: true });
      } catch (error) {
        console.error('[Fluent Capture] icon update failed', error);
        sendResponse({ success: false, error: error.message || 'Nie udało się zaktualizować ikony' });
      }
    })();
    return true;
  }

  return false;
});

async function initializeActionIcon(preferredColor) {
  try {
    const stored = await chrome.storage.sync.get({ accentColor: DEFAULT_ACCENT });
    const accentColor = preferredColor || stored.accentColor || DEFAULT_ACCENT;
    const imageData = await buildIconSet(accentColor);
    await chrome.action.setIcon({ imageData });
  } catch (error) {
    console.error('[Fluent Capture] failed to prepare icon', error);
  }
}

async function buildIconSet(accentColor) {
  const set = {};
  for (const size of ICON_SIZES) {
    set[size] = await createIconImageData(size, accentColor);
  }
  return set;
}

async function createIconImageData(size, accentColor) {
  const accent = hexToRgb(accentColor || DEFAULT_ACCENT);
  const background = 'rgb(16,16,24)';
  const accentOpaque = `rgb(${accent.r}, ${accent.g}, ${accent.b})`;
  const accentGlow = `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.7)`;
  const highlight = 'rgba(200, 200, 255, 0.7)';
  const stripeWidth = Math.max(1, Math.round(size * 0.04));
  const startY = Math.round(size * 0.18);

  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d');

  context.fillStyle = background;
  context.fillRect(0, 0, size, size);

  context.fillStyle = accentOpaque;
  context.fillRect(0, 0, stripeWidth, size);

  const gradient = context.createLinearGradient(stripeWidth, startY, size, size);
  gradient.addColorStop(0, accentGlow);
  gradient.addColorStop(1, highlight);

  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(stripeWidth, startY);
  context.lineTo(size, Math.round(size * 0.1));
  context.lineTo(size, size);
  context.lineTo(stripeWidth, size);
  context.closePath();
  context.fill();

  context.lineJoin = 'round';

  return context.getImageData(0, 0, size, size);
}

function hexToRgb(hex) {
  let value = `${hex || ''}`.trim();
  if (!value) {
    value = DEFAULT_ACCENT;
  }
  if (value.startsWith('#')) {
    value = value.slice(1);
  }
  if (value.length === 3) {
    value = value.split('').map((char) => char + char).join('');
  }
  const numeric = Number.parseInt(value, 16);
  if (Number.isNaN(numeric)) {
    return hexToRgb(DEFAULT_ACCENT);
  }
  return {
    r: (numeric >> 16) & 0xff,
    g: (numeric >> 8) & 0xff,
    b: numeric & 0xff
  };
}
