/**
 * Service worker.
 *
 * It exists for one reason: a fetch issued from a content script carries the
 * host page's origin and is blocked by CORS, while a fetch from here uses the
 * extension's own origin and its declared host permissions.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['gatewayUrl', 'reportingEnabled']).then(current => {
    chrome.storage.local.set({
      gatewayUrl: current.gatewayUrl ?? 'http://localhost:3000',
      // Off by default: reporting is a network egress the user must opt into.
      reportingEnabled: current.reportingEnabled ?? false
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'synapse:report') return false;

  (async () => {
    try {
      const { reportingEnabled = false, gatewayUrl = 'http://localhost:3000', apiKey = '' } =
        await chrome.storage.local.get(['reportingEnabled', 'gatewayUrl', 'apiKey']);

      if (!reportingEnabled) return sendResponse({ sent: false, reason: 'disabled' });

      const res = await fetch(`${gatewayUrl}/api/extension/event`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(message.payload)
      });

      sendResponse({ sent: res.ok, status: res.status });
    } catch (err) {
      // The gateway being offline must never break the user's chat session.
      sendResponse({ sent: false, reason: err.message });
    }
  })();

  return true; // keeps the message channel open for the async response
});
