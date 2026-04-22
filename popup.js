const DEFAULTS = {
  enabled: true,
  minutes: 15,
  excludedHosts: [],
};

// ---------- Tab switching ----------
const tabButtons = document.querySelectorAll("#tab-nav .tab");
const panels = document.querySelectorAll(".panel");

function activatePanel(name) {
  tabButtons.forEach((b) =>
    b.classList.toggle("active", b.dataset.panel === name)
  );
  panels.forEach((p) => {
    const match = p.dataset.panel === name;
    p.hidden = !match;
    p.classList.toggle("active", match);
  });
  if (name === "cookies") loadCookies();
  if (name === "redirects") loadRedirects();
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => activatePanel(btn.dataset.panel));
});

// ---------- Tabs panel ----------
const $enabled = document.getElementById("enabled");
const $minutes = document.getElementById("minutes");
const $hostInput = document.getElementById("host-input");
const $hostAdd = document.getElementById("host-add");
const $hostList = document.getElementById("host-list");
const $statClosed = document.getElementById("stat-closed");
const $runNow = document.getElementById("run-now");
const $runResult = document.getElementById("run-result");

function normalizeHost(value) {
  let h = value.trim().toLowerCase();
  if (!h) return "";
  h = h.replace(/^https?:\/\//, "");
  h = h.replace(/\/.*$/, "");
  h = h.replace(/^www\./, "");
  return h;
}

async function loadTabsPanel() {
  const [s, localVals] = await Promise.all([
    chrome.storage.sync.get(DEFAULTS),
    chrome.storage.local.get({ closedCount: 0 }),
  ]);
  $enabled.setAttribute("aria-checked", String(!!s.enabled));
  $minutes.value = s.minutes;
  renderHosts(s.excludedHosts);
  $statClosed.textContent = String(localVals.closedCount);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.closedCount) {
    $statClosed.textContent = String(changes.closedCount.newValue ?? 0);
  }
});

async function saveSettings(patch) {
  await chrome.storage.sync.set(patch);
}

function renderHosts(hosts) {
  $hostList.innerHTML = "";
  if (!hosts.length) {
    const li = document.createElement("li");
    li.className = "empty-state";
    li.textContent = "No excluded hosts yet.";
    $hostList.appendChild(li);
    return;
  }
  for (const host of hosts) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.className = "host";
    span.textContent = host;
    const btn = document.createElement("button");
    btn.className = "remove";
    btn.type = "button";
    btn.setAttribute("aria-label", `Remove ${host}`);
    btn.textContent = "✕";
    btn.addEventListener("click", () => removeHost(host));
    li.append(span, btn);
    $hostList.appendChild(li);
  }
}

async function addHost() {
  const host = normalizeHost($hostInput.value);
  if (!host) return;
  const { excludedHosts } = await chrome.storage.sync.get({ excludedHosts: [] });
  if (excludedHosts.includes(host)) {
    $hostInput.value = "";
    return;
  }
  const next = [...excludedHosts, host];
  await saveSettings({ excludedHosts: next });
  $hostInput.value = "";
  renderHosts(next);
}

async function removeHost(host) {
  const { excludedHosts } = await chrome.storage.sync.get({ excludedHosts: [] });
  const next = excludedHosts.filter((h) => h !== host);
  await saveSettings({ excludedHosts: next });
  renderHosts(next);
}

$enabled.addEventListener("click", async () => {
  const next = $enabled.getAttribute("aria-checked") !== "true";
  $enabled.setAttribute("aria-checked", String(next));
  await saveSettings({ enabled: next });
});

$minutes.addEventListener("change", async () => {
  let v = parseInt($minutes.value, 10);
  if (!Number.isFinite(v) || v < 1) v = 1;
  $minutes.value = v;
  await saveSettings({ minutes: v });
});

$runNow.addEventListener("click", async () => {
  $runNow.disabled = true;
  $runResult.textContent = "";
  try {
    const result = await chrome.runtime.sendMessage({ type: "run-sweep" });
    if (!result) {
      $runResult.textContent = "no response";
    } else if (!result.ran) {
      $runResult.textContent = `skipped (${result.reason})`;
    } else {
      $runResult.textContent = `checked ${result.checked}, closed ${result.closed}`;
    }
  } catch (e) {
    $runResult.textContent = `error: ${e.message}`;
  } finally {
    $runNow.disabled = false;
    setTimeout(() => {
      $runResult.textContent = "";
    }, 4000);
  }
});

$hostAdd.addEventListener("click", addHost);
$hostInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addHost();
});

// ---------- Helpers ----------
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function canManageCookies(url) {
  if (!url) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

// ---------- Cookies panel ----------
const $cookiesCount = document.getElementById("cookies-count");
const $cookiesDomain = document.getElementById("cookies-domain");
const $cookiesList = document.getElementById("cookies-list");
const $cookiesEmpty = document.getElementById("cookies-empty");
const $cookiesAdd = document.getElementById("cookies-add");
const $cookiesNuke = document.getElementById("cookies-nuke");
const $cookiesRefreshBtn = document.getElementById("cookies-refresh-btn");
const $cookiesExport = document.getElementById("cookies-export");

const cookiesState = {
  tabUrl: null,
  host: null,
  cookies: [],
  pendingNew: null,
  expandedKey: null,
  advancedOpen: new Set(),
};

const NEW_KEY = "__new__";

function cookieKey(c) {
  return `${c.name}|${c.domain}|${c.path}|${c.storeId ?? ""}`;
}

function cookieUrl(c) {
  const scheme = c.secure ? "https" : "http";
  const host = (c.domain || "").startsWith(".")
    ? c.domain.slice(1)
    : c.domain || "";
  return `${scheme}://${host}${c.path || "/"}`;
}

function setCookiesToolbarEnabled(enabled) {
  [$cookiesAdd, $cookiesNuke, $cookiesRefreshBtn, $cookiesExport].forEach(
    (b) => (b.disabled = !enabled)
  );
}

async function loadCookies() {
  const tab = await getActiveTab();
  cookiesState.tabUrl = tab?.url || null;
  let host = "—";
  try {
    host = new URL(cookiesState.tabUrl).hostname;
  } catch {}
  cookiesState.host = host;
  $cookiesDomain.textContent = host;

  if (!canManageCookies(cookiesState.tabUrl)) {
    cookiesState.cookies = [];
    cookiesState.pendingNew = null;
    $cookiesCount.textContent = "0";
    $cookiesList.innerHTML = "";
    $cookiesEmpty.hidden = false;
    $cookiesEmpty.textContent = "Cookies can only be managed on http/https pages.";
    setCookiesToolbarEnabled(false);
    return;
  }
  setCookiesToolbarEnabled(true);

  const cookies = await chrome.cookies.getAll({ url: cookiesState.tabUrl });
  cookies.sort((a, b) => a.name.localeCompare(b.name));
  cookiesState.cookies = cookies;
  $cookiesCount.textContent = String(cookies.length);
  renderCookies();
}

function renderCookies() {
  $cookiesList.innerHTML = "";
  const items = [];
  if (cookiesState.pendingNew) items.push(cookiesState.pendingNew);
  items.push(...cookiesState.cookies);

  if (!items.length) {
    $cookiesEmpty.hidden = false;
    $cookiesEmpty.textContent = "No cookies.";
    return;
  }
  $cookiesEmpty.hidden = true;

  for (const c of items) {
    const key = c.__isNew ? NEW_KEY : cookieKey(c);
    const expanded = cookiesState.expandedKey === key;

    const li = document.createElement("li");
    li.className = "cookie-item" + (expanded ? " expanded" : "");

    const head = document.createElement("div");
    head.className = "cookie-head";
    head.addEventListener("click", () => {
      cookiesState.expandedKey = expanded ? null : key;
      renderCookies();
    });

    const disc = document.createElement("span");
    disc.className = "cookie-disclosure";
    disc.textContent = "▼";

    const name = document.createElement("span");
    name.className = "cookie-name";
    name.textContent = c.name || "(new cookie)";

    head.append(disc, name);
    li.append(head);

    if (expanded) li.append(buildCookieBody(c, key));
    $cookiesList.append(li);
  }
}

function buildCookieBody(cookie, key) {
  const body = document.createElement("div");
  body.className = "cookie-body";

  const nameField = field("Name");
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = cookie.name || "";
  nameField.append(nameInput);

  const valueField = field("Value");
  const valueInput = document.createElement("textarea");
  valueInput.value = cookie.value ?? "";
  valueField.append(valueInput);

  const advancedOpen = cookiesState.advancedOpen.has(key);

  const advancedToggle = document.createElement("div");
  advancedToggle.className = "advanced-toggle";
  const advancedBtn = document.createElement("button");
  advancedBtn.type = "button";
  advancedBtn.className = "linkish";
  advancedBtn.textContent = advancedOpen ? "Hide Advanced" : "Show Advanced";
  advancedBtn.addEventListener("click", () => {
    if (cookiesState.advancedOpen.has(key)) {
      cookiesState.advancedOpen.delete(key);
    } else {
      cookiesState.advancedOpen.add(key);
    }
    renderCookies();
  });
  advancedToggle.append(advancedBtn);

  const advanced = document.createElement("div");
  advanced.className = "cookie-advanced";
  advanced.hidden = !advancedOpen;

  const domainField = field("Domain");
  const domainInput = document.createElement("input");
  domainInput.type = "text";
  domainInput.value = cookie.domain || "";
  domainField.append(domainInput);

  const pathField = field("Path");
  const pathInput = document.createElement("input");
  pathInput.type = "text";
  pathInput.value = cookie.path || "/";
  pathField.append(pathInput);

  const flags = document.createElement("div");
  flags.className = "cookie-flags";
  const [secureLbl, secureInput] = checkbox("Secure", !!cookie.secure);
  const [httpLbl, httpInput] = checkbox("HttpOnly", !!cookie.httpOnly);
  flags.append(secureLbl, httpLbl);

  const ssField = field("SameSite");
  const ssInput = document.createElement("select");
  for (const opt of ["no_restriction", "lax", "strict", "unspecified"]) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    if ((cookie.sameSite || "unspecified") === opt) o.selected = true;
    ssInput.append(o);
  }
  ssField.append(ssInput);

  const expField = field("Expires (blank = session)");
  const expInput = document.createElement("input");
  expInput.type = "datetime-local";
  if (cookie.expirationDate) {
    const d = new Date(cookie.expirationDate * 1000);
    const pad = (n) => String(n).padStart(2, "0");
    expInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  expField.append(expInput);

  advanced.append(domainField, pathField, flags, ssField, expField);

  const actions = document.createElement("div");
  actions.className = "cookie-actions";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn-save";
  saveBtn.innerHTML = "<span>💾</span><span>Save</span>";
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn-delete";
  deleteBtn.innerHTML = "<span>🗑</span><span>Delete</span>";
  actions.append(saveBtn, deleteBtn);

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
      const edits = {
        name: nameInput.value.trim(),
        value: valueInput.value,
        domain: domainInput.value.trim(),
        path: pathInput.value.trim() || "/",
        secure: secureInput.checked,
        httpOnly: httpInput.checked,
        sameSite: ssInput.value,
        expirationDate: expInput.value
          ? new Date(expInput.value).getTime() / 1000
          : undefined,
      };
      if (!edits.name) throw new Error("Name is required");
      if (!edits.domain) throw new Error("Domain is required");
      await applyCookieEdit(cookie, edits);
      if (cookie.__isNew) cookiesState.pendingNew = null;
      cookiesState.expandedKey = null;
      cookiesState.advancedOpen.delete(key);
      await loadCookies();
    } catch (err) {
      saveBtn.disabled = false;
      alert(`Failed to save cookie: ${err.message}`);
    }
  });

  deleteBtn.addEventListener("click", async () => {
    if (cookie.__isNew) {
      cookiesState.pendingNew = null;
      cookiesState.expandedKey = null;
      cookiesState.advancedOpen.delete(key);
      renderCookies();
      return;
    }
    await removeCookie(cookie);
    cookiesState.expandedKey = null;
    cookiesState.advancedOpen.delete(key);
    await loadCookies();
  });

  body.append(nameField, valueField, advancedToggle, advanced, actions);
  return body;
}

function field(labelText) {
  const wrap = document.createElement("div");
  wrap.className = "cookie-field";
  const lbl = document.createElement("label");
  lbl.textContent = labelText;
  wrap.append(lbl);
  return wrap;
}

function checkbox(labelText, checked) {
  const lbl = document.createElement("label");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  lbl.append(input, document.createTextNode(labelText));
  return [lbl, input];
}

async function removeCookie(c) {
  await chrome.cookies.remove({
    url: cookieUrl(c),
    name: c.name,
    storeId: c.storeId,
  });
}

async function applyCookieEdit(original, edits) {
  if (!original.__isNew) {
    await chrome.cookies.remove({
      url: cookieUrl(original),
      name: original.name,
      storeId: original.storeId,
    });
  }
  const scheme = edits.secure ? "https" : "http";
  const host = edits.domain.startsWith(".")
    ? edits.domain.slice(1)
    : edits.domain;
  const url = `${scheme}://${host}${edits.path || "/"}`;

  const details = {
    url,
    name: edits.name,
    value: edits.value,
    path: edits.path || "/",
    secure: edits.secure,
    httpOnly: edits.httpOnly,
    sameSite: edits.sameSite,
    domain: edits.domain,
  };
  if (original.storeId) details.storeId = original.storeId;
  if (edits.expirationDate) details.expirationDate = edits.expirationDate;

  await chrome.cookies.set(details);
}

$cookiesAdd.addEventListener("click", () => {
  if (!canManageCookies(cookiesState.tabUrl)) return;
  if (cookiesState.pendingNew) {
    cookiesState.expandedKey = NEW_KEY;
    renderCookies();
    return;
  }
  const isHttps = cookiesState.tabUrl.startsWith("https://");
  cookiesState.pendingNew = {
    __isNew: true,
    name: "",
    value: "",
    domain: cookiesState.host || "",
    path: "/",
    secure: isHttps,
    httpOnly: false,
    sameSite: "lax",
    hostOnly: true,
  };
  cookiesState.expandedKey = NEW_KEY;
  cookiesState.advancedOpen.add(NEW_KEY);
  renderCookies();
  setTimeout(() => {
    const input = $cookiesList.querySelector('.cookie-body input[type="text"]');
    if (input) input.focus();
  }, 0);
});

$cookiesNuke.addEventListener("click", async () => {
  if (!canManageCookies(cookiesState.tabUrl)) return;
  const cookies = await chrome.cookies.getAll({ url: cookiesState.tabUrl });
  if (!cookies.length) return;
  if (!confirm(`Delete all ${cookies.length} cookies for this site?`)) return;
  await Promise.all(cookies.map(removeCookie));
  cookiesState.expandedKey = null;
  cookiesState.pendingNew = null;
  loadCookies();
});

$cookiesRefreshBtn.addEventListener("click", () => {
  cookiesState.pendingNew = null;
  loadCookies();
});

$cookiesExport.addEventListener("click", async () => {
  if (!canManageCookies(cookiesState.tabUrl)) return;
  const cookies = await chrome.cookies.getAll({ url: cookiesState.tabUrl });
  const blob = new Blob([JSON.stringify(cookies, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `cookies-${cookiesState.host}-${Date.now()}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ---------- Redirects panel ----------
const $redirectsList = document.getElementById("redirects-list");
const $redirectsEmpty = document.getElementById("redirects-empty");
const $redirectsRefresh = document.getElementById("redirects-refresh");
const $redirectsCopy = document.getElementById("redirects-copy");

function statusLabel(entry) {
  const code = entry.statusCode;
  if (entry.kind === "final") {
    if (code >= 200 && code < 300) return "Final destination";
    if (code >= 400) return "Final (error)";
    return "Final destination";
  }
  if (code === 301 || code === 308) return "Permanent redirect";
  if (code === 302 || code === 303 || code === 307) return "Temporary redirect";
  return "Redirect";
}

function statusPillClass(entry) {
  const code = entry.statusCode;
  if (entry.kind === "final") {
    if (code >= 200 && code < 300) return "ok";
    if (code >= 400) return "warn";
    return "info";
  }
  return "info";
}

function iconClass(entry) {
  if (entry.kind === "final") {
    if (entry.statusCode >= 400) return "err";
    return "final";
  }
  return "step";
}

function iconGlyph(entry) {
  if (entry.kind === "final") {
    if (entry.statusCode >= 400) return "!";
    return "✓";
  }
  return "↓";
}

async function loadRedirects() {
  const tab = await getActiveTab();
  if (!tab) {
    renderRedirects([]);
    return;
  }
  const key = `redirects_${tab.id}`;
  const { [key]: chain = [] } = await chrome.storage.session.get(key);

  const display = [...chain];
  const last = display[display.length - 1];
  const needsFinal = !last || last.kind !== "final" || last.url !== tab.url;
  if (needsFinal && tab.url) {
    display.push({
      url: tab.url,
      statusCode: null,
      kind: "final",
      synthetic: true,
    });
  }
  renderRedirects(display);
}

function renderRedirects(chain) {
  $redirectsList.innerHTML = "";
  if (!chain.length) {
    $redirectsEmpty.hidden = false;
    return;
  }
  $redirectsEmpty.hidden = true;
  for (const entry of chain) {
    const li = document.createElement("li");
    li.className = "redirect-item";

    const icon = document.createElement("div");
    icon.className = `redirect-icon ${iconClass(entry)}`;
    icon.textContent = iconGlyph(entry);

    const info = document.createElement("div");
    info.className = "redirect-info";
    const url = document.createElement("div");
    url.className = "redirect-url";
    url.textContent = entry.url;
    const meta = document.createElement("div");
    meta.className = "redirect-meta";
    if (entry.statusCode != null) {
      const pill = document.createElement("span");
      pill.className = `status-pill ${statusPillClass(entry)}`;
      pill.textContent = String(entry.statusCode);
      meta.append(pill);
    }
    const label = document.createElement("span");
    label.className = "redirect-label";
    label.textContent = statusLabel(entry);
    meta.append(label);
    info.append(url, meta);

    li.append(icon, info);
    $redirectsList.append(li);
  }
}

$redirectsRefresh.addEventListener("click", loadRedirects);

$redirectsCopy.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab) return;
  const { [`redirects_${tab.id}`]: chain = [] } =
    await chrome.storage.session.get(`redirects_${tab.id}`);
  const entries = chain.length ? chain : tab.url ? [{ url: tab.url }] : [];
  const text = entries
    .map((e) => (e.statusCode != null ? `${e.statusCode}  ${e.url}` : e.url))
    .join("\n");
  try {
    await navigator.clipboard.writeText(text);
    const orig = $redirectsCopy.querySelector("span:last-child").textContent;
    $redirectsCopy.querySelector("span:last-child").textContent = "Copied";
    setTimeout(() => {
      $redirectsCopy.querySelector("span:last-child").textContent = orig;
    }, 1000);
  } catch {
    alert("Copy failed.");
  }
});

// ---------- Init ----------
loadTabsPanel();
