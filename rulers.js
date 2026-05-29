// Injected into the active page via chrome.scripting.executeScript.
// Manages draggable horizontal/vertical guide lines for alignment checks.
(function () {
  if (window.__superrhinoRulers) return;

  const HOST_ID = "__superrhino-rulers-host";
  const state = { guides: [], nextId: 1 };

  const host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "2147483647",
  });
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host, * { box-sizing: border-box; }
    .guide {
      position: fixed;
      pointer-events: auto;
      background: rgba(239, 76, 106, 0.95);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.4);
    }
    .guide.h {
      left: 0;
      right: 0;
      height: 1px;
      cursor: ns-resize;
      padding: 6px 0;
      margin-top: -6px;
      background: transparent;
    }
    .guide.h::before {
      content: "";
      position: absolute;
      left: 0; right: 0; top: 6px;
      height: 1px;
      background: rgba(239, 76, 106, 0.95);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.4);
    }
    .guide.v {
      top: 0;
      bottom: 0;
      width: 1px;
      cursor: ew-resize;
      padding: 0 6px;
      margin-left: -6px;
      background: transparent;
    }
    .guide.v::before {
      content: "";
      position: absolute;
      top: 0; bottom: 0; left: 6px;
      width: 1px;
      background: rgba(239, 76, 106, 0.95);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.4);
    }
    .label {
      position: absolute;
      background: #ef4c6a;
      color: #fff;
      font: 600 11px ui-monospace, SFMono-Regular, Menlo, monospace;
      padding: 2px 6px;
      border-radius: 4px;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.25);
    }
    .guide.h .label { top: 10px; left: 8px; }
    .guide.v .label { left: 10px; top: 8px; }
    .guide.dragging::before { background: #ffeb3b; }
    .guide.dragging .label { background: #ffeb3b; color: #000; }
  `;
  shadow.appendChild(style);

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function makeGuide(orientation, position) {
    const id = state.nextId++;
    const el = document.createElement("div");
    el.className = `guide ${orientation === "horizontal" ? "h" : "v"}`;
    const label = document.createElement("span");
    label.className = "label";
    el.appendChild(label);
    shadow.appendChild(el);

    const guide = { id, orientation, position, el, label };
    state.guides.push(guide);

    const setPos = (px) => {
      const max = orientation === "horizontal"
        ? window.innerHeight - 1
        : window.innerWidth - 1;
      guide.position = clamp(Math.round(px), 0, max);
      if (orientation === "horizontal") {
        el.style.top = `${guide.position}px`;
        label.textContent = `y: ${guide.position}px`;
      } else {
        el.style.left = `${guide.position}px`;
        label.textContent = `x: ${guide.position}px`;
      }
    };
    setPos(position);

    let dragging = false;
    el.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      el.classList.add("dragging");
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      setPos(orientation === "horizontal" ? e.clientY : e.clientX);
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("dragging");
    });
    el.addEventListener("dblclick", () => removeGuide(id));

    return guide;
  }

  function removeGuide(id) {
    const idx = state.guides.findIndex((g) => g.id === id);
    if (idx === -1) return;
    state.guides[idx].el.remove();
    state.guides.splice(idx, 1);
  }

  function addGuide(orientation) {
    const center = orientation === "horizontal"
      ? Math.round(window.innerHeight / 2)
      : Math.round(window.innerWidth / 2);
    // offset stacked guides slightly so they don't perfectly overlap
    const sameAxis = state.guides.filter((g) => g.orientation === orientation).length;
    const pos = center + sameAxis * 12;
    makeGuide(orientation, pos);
  }

  function clearAll() {
    for (const g of state.guides) g.el.remove();
    state.guides = [];
  }

  function count() {
    return state.guides.length;
  }

  window.__superrhinoRulers = { addGuide, clearAll, count };
})();
