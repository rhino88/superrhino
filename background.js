const DEFAULTS = {
  enabled: true,
  minutes: 15,
  excludedHosts: [],
};

const ALARM_NAME = 'superrhino-check';

async function getSettings() {
  return await chrome.storage.sync.get(DEFAULTS);
}

async function getLastActive() {
  const { lastActive } = await chrome.storage.session.get({ lastActive: {} });
  return lastActive;
}

async function setLastActive(lastActive) {
  await chrome.storage.session.set({ lastActive });
}

async function touchTab(tabId) {
  const lastActive = await getLastActive();
  lastActive[tabId] = Date.now();
  await setLastActive(lastActive);
}

async function forgetTab(tabId) {
  const lastActive = await getLastActive();
  delete lastActive[tabId];
  await setLastActive(lastActive);
}

async function seedLastActive() {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  const lastActive = {};
  for (const tab of tabs) lastActive[tab.id] = now;
  await setLastActive(lastActive);
}

function ensureAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  const legacy = await chrome.storage.sync.get(['hours', 'minutes']);
  if (legacy.hours != null && legacy.minutes == null) {
    await chrome.storage.sync.set({ minutes: Number(legacy.hours) * 60 });
    await chrome.storage.sync.remove('hours');
  }
  const current = await chrome.storage.sync.get(DEFAULTS);
  await chrome.storage.sync.set(current);
  await seedLastActive();
  ensureAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await seedLastActive();
  ensureAlarm();
});

chrome.tabs.onCreated.addListener((tab) => {
  touchTab(tab.id);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  touchTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    touchTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
  chrome.storage.session.remove(`redirects_${tabId}`);
});

const redirectQueues = new Map();

function queueRedirectWrite(tabId, fn) {
  const prev = redirectQueues.get(tabId) || Promise.resolve();
  const next = prev.then(fn).catch((e) => console.error('redirect write', e));
  redirectQueues.set(tabId, next);
  return next;
}

async function resetChain(tabId) {
  await chrome.storage.session.set({ [`redirects_${tabId}`]: [] });
}

async function appendChain(tabId, entry) {
  const key = `redirects_${tabId}`;
  const { [key]: chain = [] } = await chrome.storage.session.get(key);
  chain.push(entry);
  await chrome.storage.session.set({ [key]: chain });
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;
    queueRedirectWrite(details.tabId, () => resetChain(details.tabId));
  },
  { urls: ['<all_urls>'], types: ['main_frame'] }
);

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.tabId < 0) return;
    queueRedirectWrite(details.tabId, () =>
      appendChain(details.tabId, {
        url: details.url,
        statusCode: details.statusCode,
        kind: 'redirect',
      })
    );
  },
  { urls: ['<all_urls>'], types: ['main_frame'] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;
    queueRedirectWrite(details.tabId, () =>
      appendChain(details.tabId, {
        url: details.url,
        statusCode: details.statusCode,
        kind: 'final',
      })
    );
  },
  { urls: ['<all_urls>'], types: ['main_frame'] }
);

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) touchTab(tab.id);
});

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isExcluded(host, excludedHosts) {
  if (!host) return false;
  return excludedHosts.some((raw) => {
    const h = raw.toLowerCase().trim().replace(/^www\./, '');
    if (!h) return false;
    return host === h || host.endsWith('.' + h);
  });
}

async function runSweep({ force = false } = {}) {
  const settings = await getSettings();
  if (!force && !settings.enabled) {
    return { ran: false, reason: 'disabled', checked: 0, closed: 0 };
  }

  const thresholdMs = Number(settings.minutes) * 60 * 1000;
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) {
    return { ran: false, reason: 'bad threshold', checked: 0, closed: 0 };
  }

  const lastActive = await getLastActive();
  const now = Date.now();
  const tabs = await chrome.tabs.query({});
  let mutated = false;
  let closed = 0;

  const remainingByWindow = {};
  for (const tab of tabs) {
    remainingByWindow[tab.windowId] = (remainingByWindow[tab.windowId] || 0) + 1;
  }

  for (const tab of tabs) {
    if (tab.active || tab.pinned || tab.audible) continue;
    if (remainingByWindow[tab.windowId] <= 1) continue;
    const host = hostnameOf(tab.url);
    if (isExcluded(host, settings.excludedHosts)) continue;

    if (lastActive[tab.id] == null) {
      lastActive[tab.id] = now;
      mutated = true;
      continue;
    }

    if (now - lastActive[tab.id] >= thresholdMs) {
      try {
        await chrome.tabs.remove(tab.id);
        remainingByWindow[tab.windowId] -= 1;
        delete lastActive[tab.id];
        mutated = true;
        closed += 1;
      } catch {
        // tab already gone
      }
    }
  }

  if (mutated) await setLastActive(lastActive);
  if (closed > 0) {
    const { closedCount = 0 } = await chrome.storage.local.get('closedCount');
    await chrome.storage.local.set({ closedCount: closedCount + closed });
  }
  return { ran: true, checked: tabs.length, closed };
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await runSweep();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'run-sweep') {
    runSweep({ force: true }).then(sendResponse);
    return true;
  }
});
