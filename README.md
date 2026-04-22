# superrhino

A Chrome extension that auto-closes idle tabs, manages cookies per site, and inspects redirect chains for the current tab.

Inspired by [@levelsio](https://x.com/levelsio)'s "super levels" extension — [see his tweet](https://x.com/levelsio/status/2046254207884271626).

## Features

**Tabs**
- Auto-close tabs after N minutes of inactivity
- Excluded hosts list with subdomain matching (excluding `google.com` also protects `mail.google.com`)
- Never closes: the currently active tab, pinned tabs, audible tabs, or the last tab in a window
- Lifetime counter of tabs auto-closed
- "Run now" button to trigger the sweep on demand

**Cookies**
- Per-site list of cookies for the current tab
- Expand any cookie to edit name, value, and advanced fields (domain, path, Secure, HttpOnly, SameSite, expiration)
- Add new cookies, Delete All, Refresh, Export as JSON

**Redirects**
- Full redirect chain for the current tab with status codes and labels
- Copy the chain to clipboard

## Install (unpacked)

1. Clone this repo
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the repo directory

## Permissions

`tabs`, `storage`, `alarms`, `cookies`, `webRequest`, `clipboardWrite`, and host access to all URLs — required for cookie management and redirect observation.
