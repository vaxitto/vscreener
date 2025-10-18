let originalScrollY = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message?.type) {
    case 'GET_PAGE_DETAILS': {
      originalScrollY = window.scrollY;
      const totalWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
      const totalHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const viewportHeight = window.innerHeight;
      sendResponse({
        totalWidth,
        totalHeight,
        viewportHeight,
        devicePixelRatio: window.devicePixelRatio || 1,
        scrollY: originalScrollY
      });
      return true;
    }
    case 'SCROLL_TO': {
      window.scrollTo({ top: message.y, behavior: 'auto' });
      sendResponse({ ok: true });
      return true;
    }
    default:
      break;
  }
  return false;
});
