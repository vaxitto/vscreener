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

  const request = {
    type: 'CAPTURE_FULL_PAGE',
    tabId: tab.id,
    topOffset: Number(elements.topOffset.value),
    bottomOffset: Number(elements.bottomOffset.value),
    compressionEnabled: elements.compressionToggle.checked,
    compressionLevel: Number(elements.compressionLevel.value),
    mode
  };

  elements.saveButton.disabled = true;
  elements.clipboardButton.disabled = true;
  showNotification('Pracuję nad zrzutem...');

  try {
    const response = await chrome.runtime.sendMessage(request);
    if (!response?.success) {
      throw new Error(response?.error || 'Nie udało się utworzyć zrzutu');
    }

    const { dataUrl, blob, width, height } = response;

    if (mode === 'download') {
      const filename = `fluent-capture-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      await chrome.downloads.download({
        url: dataUrl,
        filename,
        saveAs: false
      });
      showNotification('Zapisano pełny zrzut strony');
    } else {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
        showNotification('Zrzut zapisany w schowku');
      } catch (error) {
        logDebug('Clipboard write failed, fallback to download', error);
        const fallbackName = `fluent-capture-${Date.now()}.png`;
        await chrome.downloads.download({ url: dataUrl, filename: fallbackName, saveAs: true });
        showNotification('Schowek niedostępny, zapisano plik');
      }
    }
  } catch (error) {
    logDebug('Capture failed', error);
    showNotification(error.message || 'Wystąpił nieoczekiwany błąd');
  } finally {
    elements.saveButton.disabled = false;
    elements.clipboardButton.disabled = false;
  }
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
