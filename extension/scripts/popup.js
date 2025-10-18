const settings = {
  topOffset: 0,
  bottomOffset: 0,
  compressionEnabled: true,
  compressionLevel: 85,
  accentColor: '#7F00FF',
  debug: false
};

const elements = {
  topOffset: document.getElementById('topOffset'),
  bottomOffset: document.getElementById('bottomOffset'),
  topValue: document.getElementById('topValue'),
  bottomValue: document.getElementById('bottomValue'),
  compressionToggle: document.getElementById('compressionToggle'),
  compressionLabel: document.getElementById('compressionLabel'),
  compressionLevel: document.getElementById('compressionLevel'),
  compressionValue: document.getElementById('compressionValue'),
  compressionGroup: document.getElementById('compressionGroup'),
  saveButton: document.getElementById('saveButton'),
  clipboardButton: document.getElementById('clipboardButton'),
  notification: document.getElementById('notification'),
  settingsButton: document.getElementById('settingsButton'),
  settingsPanel: document.getElementById('settingsPanel'),
  settingsBackdrop: document.getElementById('settingsBackdrop'),
  closeSettings: document.getElementById('closeSettings'),
  accentColor: document.getElementById('accentColor'),
  debugToggle: document.getElementById('debugToggle'),
  app: document.querySelector('.app')
};

let notificationTimeout;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function logDebug(...args) {
  if (settings.debug) {
    console.debug('[Fluent Capture]', ...args);
  }
}

async function notifyAccentChange(color) {
  try {
    await chrome.runtime.sendMessage({ type: 'UPDATE_ACCENT_ICON', accentColor: color });
  } catch (error) {
    logDebug('Icon sync message failed', error);
  }
}

async function loadSettings() {
  const stored = await chrome.storage.sync.get(settings);
  Object.assign(settings, stored);
  elements.topOffset.value = settings.topOffset;
  elements.bottomOffset.value = settings.bottomOffset;
  elements.compressionToggle.checked = settings.compressionEnabled;
  elements.compressionLevel.value = settings.compressionLevel;
  elements.accentColor.value = settings.accentColor;
  elements.debugToggle.checked = settings.debug;
  updateRangeValues();
  updateCompressionState();
  applyAccent(settings.accentColor);
  await notifyAccentChange(settings.accentColor);
}

function updateRangeValues() {
  elements.topValue.textContent = `${elements.topOffset.value} px`;
  elements.bottomValue.textContent = `${elements.bottomOffset.value} px`;
  elements.compressionValue.textContent = `${elements.compressionLevel.value}%`;
}

function updateCompressionState() {
  elements.compressionGroup.classList.toggle('is-disabled', !elements.compressionToggle.checked);
  elements.compressionLevel.disabled = !elements.compressionToggle.checked;
  elements.compressionLabel.textContent = elements.compressionToggle.checked ? 'Włączona' : 'Wyłączona';
}

function applyAccent(color) {
  elements.app.style.setProperty('--accent', color);
}

function showNotification(message) {
  clearTimeout(notificationTimeout);
  elements.notification.textContent = message;
  elements.notification.classList.add('is-visible');
  notificationTimeout = setTimeout(() => {
    elements.notification.classList.remove('is-visible');
  }, 4200);
}

async function saveSettings() {
  await chrome.storage.sync.set(settings);
}

async function requestCapture(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    showNotification('Nie można znaleźć aktywnej karty');
    return;
  }

  const topOffset = Number(elements.topOffset.value);
  const bottomOffset = Number(elements.bottomOffset.value);
  const compressionEnabled = elements.compressionToggle.checked;
  const compressionLevel = Number(elements.compressionLevel.value);

  elements.saveButton.disabled = true;
  elements.clipboardButton.disabled = true;
  showNotification('Pracuję nad zrzutem...');

  try {
    const page = await getPageDetails(tab.id);
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

    const positions = calculateScrollPositions(totalHeight, viewportHeight);
    let captures;
    try {
      captures = await captureSlices(tab, positions);
    } finally {
      await restoreScroll(tab.id, scrollY);
    }

    const stitched = await stitchCaptures({
      captures,
      totalWidth,
      captureHeight,
      viewportHeight,
      devicePixelRatio,
      effectiveTop
    });

    const finalImage = await applyCompression(stitched, { compressionEnabled, compressionLevel });

    await outputResult(mode, finalImage);
  } catch (error) {
    logDebug('Capture failed', error);
    const message = error?.message === 'Could not establish connection. Receiving end does not exist.'
      ? 'Nie udało się połączyć ze stroną. Odśwież kartę i spróbuj ponownie.'
      : error?.message || 'Wystąpił nieoczekiwany błąd';
    showNotification(message);
  } finally {
    elements.saveButton.disabled = false;
    elements.clipboardButton.disabled = false;
  }
}

async function getPageDetails(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_DETAILS' });
  } catch (error) {
    logDebug('Failed to get page details', error);
    throw error;
  }
}

function calculateScrollPositions(totalHeight, viewportHeight) {
  const positions = [];
  const maxScroll = Math.max(0, totalHeight - viewportHeight);

  for (let y = 0; y <= maxScroll; y += viewportHeight) {
    const position = Math.min(y, maxScroll);
    if (!positions.length || positions[positions.length - 1] !== position) {
      positions.push(position);
    }
  }

  if (!positions.length) {
    positions.push(0);
  }

  return positions;
}

async function captureSlices(tab, positions) {
  const captures = [];

  for (const pos of positions) {
    await chrome.tabs.sendMessage(tab.id, { type: 'SCROLL_TO', y: pos });
    await delay(160);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    captures.push({ dataUrl, scrollY: pos });
  }

  return captures;
}

async function restoreScroll(tabId, originalScroll) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SCROLL_TO', y: originalScroll });
  } catch (error) {
    logDebug('Failed to restore scroll position', error);
  }
}

async function stitchCaptures({
  captures,
  totalWidth,
  captureHeight,
  viewportHeight,
  devicePixelRatio,
  effectiveTop
}) {
  const totalWidthPx = Math.round(totalWidth * devicePixelRatio);
  const totalHeightPx = Math.round(captureHeight * devicePixelRatio);
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = totalWidthPx;
  baseCanvas.height = totalHeightPx;
  const context = baseCanvas.getContext('2d');
  context.imageSmoothingEnabled = true;

  for (const capture of captures) {
    const bitmap = await loadBitmap(capture.dataUrl);
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

    context.drawImage(
      bitmap,
      0,
      sourceY,
      bitmap.width,
      sourceHeight,
      0,
      destinationY,
      totalWidthPx,
      sourceHeight
    );
  }

  return { canvas: baseCanvas, width: totalWidthPx, height: totalHeightPx };
}

async function loadBitmap(dataUrl) {
  try {
    return await createImageBitmap(await (await fetch(dataUrl)).blob());
  } catch (error) {
    logDebug('createImageBitmap failed, falling back to Image()', error);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = dataUrl;
    });
  }
}

async function applyCompression(stitched, { compressionEnabled, compressionLevel }) {
  const { canvas, width, height } = stitched;

  if (!compressionEnabled || compressionLevel >= 100) {
    const blob = await canvasToBlob(canvas);
    const dataUrl = await blobToDataUrl(blob);
    return { blob, dataUrl, width, height };
  }

  const scale = Math.max(0.4, compressionLevel / 100);
  const scaledWidth = Math.max(1, Math.round(width * scale));
  const scaledHeight = Math.max(1, Math.round(height * scale));
  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = scaledWidth;
  scaledCanvas.height = scaledHeight;
  const scaledContext = scaledCanvas.getContext('2d');
  scaledContext.imageSmoothingEnabled = true;
  scaledContext.imageSmoothingQuality = 'high';
  scaledContext.drawImage(canvas, 0, 0, scaledWidth, scaledHeight);

  const blob = await canvasToBlob(scaledCanvas);
  const dataUrl = await blobToDataUrl(blob);

  return { blob, dataUrl, width: scaledWidth, height: scaledHeight };
}

async function outputResult(mode, finalImage) {
  if (mode === 'download') {
    const filename = `fluent-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
    await chrome.downloads.download({
      url: finalImage.dataUrl,
      filename,
      saveAs: false
    });
    showNotification('Zapisano pełny zrzut strony');
    return;
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': finalImage.blob })
    ]);
    showNotification('Zrzut zapisany w schowku');
  } catch (error) {
    logDebug('Clipboard write failed, fallback to download', error);
    const fallbackName = `fluent-capture-${Date.now()}.png`;
    await chrome.downloads.download({ url: finalImage.dataUrl, filename: fallbackName, saveAs: true });
    showNotification('Schowek niedostępny, zapisano plik');
  }
}

async function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Nie udało się utworzyć obrazu'));
      }
    }, 'image/png');
  });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function bindEvents() {
  elements.topOffset.addEventListener('input', () => {
    settings.topOffset = Number(elements.topOffset.value);
    updateRangeValues();
    saveSettings();
  });

  elements.bottomOffset.addEventListener('input', () => {
    settings.bottomOffset = Number(elements.bottomOffset.value);
    updateRangeValues();
    saveSettings();
  });

  elements.compressionToggle.addEventListener('change', () => {
    settings.compressionEnabled = elements.compressionToggle.checked;
    updateCompressionState();
    saveSettings();
  });

  elements.compressionLevel.addEventListener('input', () => {
    settings.compressionLevel = Number(elements.compressionLevel.value);
    updateRangeValues();
    saveSettings();
  });

  elements.saveButton.addEventListener('click', () => requestCapture('download'));
  elements.clipboardButton.addEventListener('click', () => requestCapture('clipboard'));

  elements.settingsButton.addEventListener('click', () => toggleSettings(true));
  elements.closeSettings.addEventListener('click', () => toggleSettings(false));
  elements.settingsBackdrop.addEventListener('click', () => toggleSettings(false));

  elements.accentColor.addEventListener('input', (event) => {
    const color = event.target.value;
    settings.accentColor = color;
    applyAccent(color);
    saveSettings();
    notifyAccentChange(color);
  });

  elements.debugToggle.addEventListener('change', () => {
    settings.debug = elements.debugToggle.checked;
    saveSettings();
  });
}

function toggleSettings(open) {
  elements.settingsPanel.hidden = !open;
  elements.settingsBackdrop.hidden = !open;
}

loadSettings();
bindEvents();
