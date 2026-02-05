// Open index.html when the extension icon is clicked.
// Reuse an existing tab if one is already open.
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('index.html');

  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0) {
    try {
      await chrome.tabs.update(tabs[0].id, { active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
      return;
    } catch (e) {
      console.debug('Failed to reuse existing tab:', e.message);
    }
  }

  try {
    await chrome.tabs.create({ url });
  } catch (e) {
    console.debug('Failed to create tab:', e.message);
  }
});
