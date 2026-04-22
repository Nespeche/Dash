export function createAccessibleCombobox({
  input,
  dropdown,
  wrap,
  optionSelector,
  onSelect
}) {
  let activeIndex = -1;

  if (!input || !dropdown) {
    return {
      open() {},
      close() {},
      syncOptions() {},
      handleKeydown() {},
      selectActiveOrFirst() { return false; },
      isOpen() { return false; }
    };
  }

  const listboxId = dropdown.id || `combobox-${Math.random().toString(36).slice(2, 8)}`;
  dropdown.id = listboxId;
  dropdown.setAttribute("role", "listbox");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-haspopup", "listbox");
  input.setAttribute("aria-controls", listboxId);
  input.setAttribute("aria-expanded", "false");

  function getOptions() {
    return Array.from(dropdown.querySelectorAll(optionSelector));
  }

  function applyExpandedState() {
    const open = dropdown.classList.contains("open");
    input.setAttribute("aria-expanded", open ? "true" : "false");
    wrap?.classList.toggle("is-open", open);
    if (!open) {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function syncOptions() {
    const options = getOptions();
    options.forEach((option, index) => {
      option.id = option.id || `${listboxId}-opt-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.classList.remove("active");
      option.setAttribute("tabindex", "-1");
    });

    if (!options.length) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
      applyExpandedState();
      return;
    }

    if (activeIndex < 0 || activeIndex >= options.length) {
      activeIndex = 0;
    }

    setActiveIndex(activeIndex, { scroll: false });
    applyExpandedState();
  }

  function setActiveIndex(index, { scroll = true } = {}) {
    const options = getOptions();
    if (!options.length) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
      return null;
    }

    activeIndex = Math.max(0, Math.min(options.length - 1, index));

    options.forEach((option, idx) => {
      const active = idx === activeIndex;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", active ? "true" : "false");
      if (active) {
        input.setAttribute("aria-activedescendant", option.id);
        if (scroll) option.scrollIntoView({ block: "nearest" });
      }
    });

    return options[activeIndex];
  }

  function open() {
    dropdown.classList.add("open");
    syncOptions();
    applyExpandedState();
  }

  function close() {
    activeIndex = -1;
    dropdown.classList.remove("open");
    getOptions().forEach(option => {
      option.classList.remove("active");
      option.setAttribute("aria-selected", "false");
    });
    applyExpandedState();
  }

  function selectOption(option) {
    if (!option) return false;
    if (typeof onSelect === "function") onSelect(option);
    return true;
  }

  function selectActiveOrFirst() {
    const options = getOptions();
    if (!options.length) return false;
    return selectOption(options[activeIndex >= 0 ? activeIndex : 0]);
  }

  function handleKeydown(event) {
    const options = getOptions();
    const openState = dropdown.classList.contains("open");

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!openState) {
        open();
        return;
      }
      if (options.length) setActiveIndex(activeIndex < 0 ? 0 : (activeIndex + 1) % options.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!openState) {
        open();
        return;
      }
      if (options.length) {
        setActiveIndex(activeIndex < 0 ? options.length - 1 : (activeIndex - 1 + options.length) % options.length);
      }
      return;
    }

    if ((event.key === "Home" || event.key === "PageUp") && openState && options.length) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if ((event.key === "End" || event.key === "PageDown") && openState && options.length) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
      return;
    }

    if (event.key === "Enter" && openState && options.length) {
      event.preventDefault();
      selectActiveOrFirst();
      return;
    }

    if (event.key === "Escape") {
      if (openState) {
        event.preventDefault();
        close();
      }
      return;
    }

    if (event.key === "Tab") {
      close();
    }
  }

  dropdown.addEventListener("mousemove", event => {
    const option = event.target.closest(optionSelector);
    if (!option) return;
    const index = getOptions().indexOf(option);
    if (index >= 0) setActiveIndex(index, { scroll: false });
  });

  dropdown.addEventListener("click", event => {
    const option = event.target.closest(optionSelector);
    if (!option) return;
    event.preventDefault();
    selectOption(option);
  });

  return {
    open,
    close,
    syncOptions,
    handleKeydown,
    selectActiveOrFirst,
    isOpen() {
      return dropdown.classList.contains("open");
    }
  };
}
