export function initAccessibleTabs({ root, onChange, initialTab = "" }) {
  const tabs = Array.from(root?.querySelectorAll("[data-tab]") || []);
  const panels = new Map();

  if (!root || !tabs.length) {
    return {
      activate() {},
      setTop() {},
      tabs: []
    };
  }

  root.setAttribute("role", "tablist");
  root.setAttribute("aria-label", "Secciones principales del dashboard");

  tabs.forEach((tab, index) => {
    const tabName = String(tab.dataset.tab || "").trim();
    const panel = document.getElementById(`page-${tabName}`);
    const tabId = tab.id || `tab-${tabName || index}`;

    tab.id = tabId;
    tab.setAttribute("role", "tab");
    tab.setAttribute("type", "button");
    tab.setAttribute("aria-selected", "false");
    tab.setAttribute("tabindex", "-1");
    if (panel) {
      panel.id = panel.id || `page-${tabName}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tabId);
      panel.hidden = true;
      panels.set(tabName, panel);
      tab.setAttribute("aria-controls", panel.id);
    }

    tab.addEventListener("click", () => {
      activate(tabName, { emit: true, focus: false });
    });

    tab.addEventListener("keydown", event => {
      const lastIndex = tabs.length - 1;
      const currentIndex = tabs.indexOf(tab);

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        tabs[(currentIndex + 1) > lastIndex ? 0 : currentIndex + 1]?.focus();
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        tabs[(currentIndex - 1) < 0 ? lastIndex : currentIndex - 1]?.focus();
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        tabs[0]?.focus();
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        tabs[lastIndex]?.focus();
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate(tabName, { emit: true, focus: true });
      }
    });
  });

  function activate(tabName, { emit = false, focus = false } = {}) {
    tabs.forEach(tab => {
      const isActive = tab.dataset.tab === tabName;
      tab.classList.toggle("on", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      tab.setAttribute("tabindex", isActive ? "0" : "-1");
      if (focus && isActive) tab.focus();
    });

    panels.forEach((panel, name) => {
      const isActive = name === tabName;
      panel.classList.toggle("on", isActive);
      panel.hidden = !isActive;
    });

    if (emit && typeof onChange === "function") {
      onChange(tabName);
    }
  }

  function setTop(offsetPx) {
    root.style.top = `${Math.max(0, Number(offsetPx) || 0)}px`;
  }

  activate(initialTab || tabs[0]?.dataset.tab || "", { emit: false });

  return {
    activate,
    setTop,
    tabs
  };
}
