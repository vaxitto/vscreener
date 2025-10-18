const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  if (message?.type === 'CAPTURE_FULL_PAGE') {
    (async () => {
      try {
        const result = await captureFullPage(message);
        sendResponse({ success: true, ...result });
      } catch (error) {
        console.error('[Fluent Capture] capture failed', error);
        sendResponse({ success: false, error: error.message || 'Błąd podczas przechwytywania' });
      }
    })();
    return true;
  }

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

async function captureFullPage(options) {
  const { tabId, topOffset = 0, bottomOffset = 0, compressionEnabled, compressionLevel = 100 } = options;

  const tab = await chrome.tabs.get(tabId);
  const page = await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_DETAILS' });
  if (!page) {
    throw new Error('Brak dostępu do strony');
  }

  const { totalWidth, totalHeight, viewportHeight, devicePixelRatio, scrollY } = page;
  const effectiveTop = Math.max(0, Math.min(topOffset, totalHeight));
  const effectiveBottom = Math.max(0, Math.min(bottomOffset, totalHeight - effectiveTop));
  const captureHeight = Math.max(0, totalHeight - effectiveTop - effectiveBottom);
  if (captureHeight === 0) {
    throw new Error('Zbyt duże marginesy');
  }

  const maxScroll = Math.max(0, totalHeight - viewportHeight);
  const positions = [];
  for (let y = 0; y <= maxScroll; y += viewportHeight) {
    const position = Math.min(y, maxScroll);
    if (!positions.length || positions[positions.length - 1] !== position) {
      positions.push(position);
    }
  }
  if (!positions.length) {
    positions.push(0);
  }

  const captures = [];
  for (const pos of positions) {
    await chrome.tabs.sendMessage(tabId, { type: 'SCROLL_TO', y: pos });
    await sleep(150);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    captures.push({ dataUrl, scrollY: pos });
  }

  await chrome.tabs.sendMessage(tabId, { type: 'SCROLL_TO', y: scrollY });

  const totalWidthPx = Math.round(totalWidth * devicePixelRatio);
  const totalHeightPx = Math.round(captureHeight * devicePixelRatio);
  const baseCanvas = new OffscreenCanvas(totalWidthPx, totalHeightPx);
  const context = baseCanvas.getContext('2d');
  context.imageSmoothingEnabled = true;

  for (const capture of captures) {
    const bitmap = await dataUrlToBitmap(capture.dataUrl);
    const captureTop = capture.scrollY;
    const captureBottom = capture.scrollY + viewportHeight;
    const sliceStart = Math.max(effectiveTop, captureTop);
    const sliceEnd = Math.min(effectiveTop + captureHeight, captureBottom);
    if (sliceEnd <= sliceStart) {
      continue;
    }

    const sourceY = Math.round((sliceStart - captureTop) * devicePixelRatio);
    const sourceHeight = Math.round((sliceEnd - sliceStart) * devicePixelRatio);
    const destinationY = Math.round((sliceStart - effectiveTop) * devicePixelRatio);

    context.drawImage(bitmap, 0, sourceY, bitmap.width, sourceHeight, 0, destinationY, totalWidthPx, sourceHeight);
  }

  let outputCanvas = baseCanvas;
  let outputContext = context;

  if (compressionEnabled && compressionLevel < 100) {
    const scale = Math.max(0.4, compressionLevel / 100);
    const scaledWidth = Math.max(1, Math.round(totalWidthPx * scale));
    const scaledHeight = Math.max(1, Math.round(totalHeightPx * scale));
    outputCanvas = new OffscreenCanvas(scaledWidth, scaledHeight);
    outputContext = outputCanvas.getContext('2d');
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(baseCanvas, 0, 0, scaledWidth, scaledHeight);
  }

  const blob = await outputCanvas.convertToBlob({ type: 'image/png' });
  const dataUrl = await blobToDataUrl(blob);

  return {
    dataUrl,
    blob,
    width: outputCanvas.width,
    height: outputCanvas.height
  };
}

async function dataUrlToBitmap(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return createImageBitmap(blob);
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
