(function () {
  var instanceMap = new Map();
  var uid = 0;

  function nextId(prefix) {
    uid += 1;
    return prefix + uid;
  }

  function isEnhanceableSelect(select) {
    if (!select || select.tagName !== "SELECT") return false;
    if (select.multiple) return false;
    if (select.dataset.nativeSelect === "true") return false;
    if (select.dataset.customSelectEnhanced === "true") return false;
    if (select.closest(".select-enhanced")) return false;

    var size = select.getAttribute("size");
    return !size || Number(size) <= 1;
  }

  function ensureLabelId(select) {
    if (!select.id) return null;

    var label = document.querySelector('label[for="' + CSS.escape(select.id) + '"]');
    if (!label) return null;
    if (!label.id) label.id = nextId("select-label-");
    return label.id;
  }

  function getSelectText(select) {
    var option = select.options[select.selectedIndex];
    return option ? option.textContent : "";
  }

  function createOptionButton(option, optionIndex, selectId) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "select-enhanced-option";
    button.dataset.optionIndex = String(optionIndex);
    button.setAttribute("role", "option");
    button.id = selectId + "-option-" + optionIndex;
    button.textContent = option.textContent;

    if (option.disabled) {
      button.disabled = true;
      button.setAttribute("aria-disabled", "true");
    }

    return button;
  }

  function buildOptions(select, listbox, selectId) {
    var buttons = [];

    Array.prototype.forEach.call(select.children, function (child) {
      if (child.tagName !== "OPTION") return;
      var optionButton = createOptionButton(child, buttons.length, selectId);
      listbox.appendChild(optionButton);
      buttons.push(optionButton);
    });

    return buttons;
  }

  function closeAll(exceptSelect) {
    instanceMap.forEach(function (instance, select) {
      if (select !== exceptSelect) instance.close();
    });
  }

  function enhanceSelect(select) {
    if (!isEnhanceableSelect(select)) return;

    var selectId = select.id || nextId("custom-select-");
    if (!select.id) select.id = selectId;

    var wrapper = document.createElement("div");
    wrapper.className = "select-enhanced";

    var button = document.createElement("button");
    button.type = "button";
    button.className = "select-enhanced-trigger";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", selectId + "-menu");

    var label = document.createElement("span");
    label.className = "select-enhanced-trigger-label";
    button.appendChild(label);

    var icon = document.createElement("i");
    icon.className = "ph ph-caret-down select-enhanced-icon";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);

    var menu = document.createElement("div");
    menu.className = "select-enhanced-menu";
    menu.id = selectId + "-menu";
    menu.hidden = true;

    var listbox = document.createElement("div");
    listbox.className = "select-enhanced-options";
    listbox.setAttribute("role", "listbox");
    menu.appendChild(listbox);

    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    wrapper.appendChild(button);
    wrapper.appendChild(menu);

    select.classList.add("select-enhanced-native");
    select.dataset.customSelectEnhanced = "true";
    select.tabIndex = -1;
    select.setAttribute("aria-hidden", "true");

    var labelledBy = ensureLabelId(select);
    if (labelledBy) {
      button.setAttribute("aria-labelledby", labelledBy + " " + selectId + "-value");
      label.id = selectId + "-value";
      listbox.setAttribute("aria-labelledby", labelledBy);
    } else if (select.getAttribute("aria-label")) {
      button.setAttribute("aria-label", select.getAttribute("aria-label"));
      listbox.setAttribute("aria-label", select.getAttribute("aria-label"));
    }

    var optionButtons = buildOptions(select, listbox, selectId);

    function syncFromSelect() {
      label.textContent = getSelectText(select);
      button.disabled = select.disabled;
      wrapper.classList.toggle("is-disabled", !!select.disabled);

      optionButtons.forEach(function (optionButton, index) {
        var option = select.options[index];
        var isSelected = select.selectedIndex === index;
        optionButton.classList.toggle("is-active", isSelected);
        optionButton.setAttribute("aria-selected", isSelected ? "true" : "false");
        optionButton.disabled = !!option.disabled;
        if (option.disabled) {
          optionButton.setAttribute("aria-disabled", "true");
        } else {
          optionButton.removeAttribute("aria-disabled");
        }
      });
    }

    function focusSelected() {
      var selectedButton = optionButtons[select.selectedIndex] || optionButtons[0];
      if (!selectedButton) return;
      selectedButton.focus();
      selectedButton.scrollIntoView({ block: "nearest" });
    }

    function open() {
      if (button.disabled) return;
      closeAll(select);
      menu.hidden = false;
      wrapper.classList.add("is-open");
      button.setAttribute("aria-expanded", "true");
      focusSelected();
    }

    function close() {
      menu.hidden = true;
      wrapper.classList.remove("is-open");
      button.setAttribute("aria-expanded", "false");
    }

    function toggle() {
      if (menu.hidden) {
        open();
        return;
      }
      close();
    }

    function commitSelection(index) {
      var option = select.options[index];
      if (!option || option.disabled) return;

      if (select.selectedIndex !== index) {
        select.selectedIndex = index;
        syncFromSelect();
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }

      close();
      button.focus();
    }

    button.addEventListener("click", toggle);
    button.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });

    optionButtons.forEach(function (optionButton, index) {
      optionButton.addEventListener("click", function () {
        commitSelection(index);
      });

      optionButton.addEventListener("keydown", function (event) {
        var nextIndex = index;

        if (event.key === "ArrowDown") nextIndex = Math.min(index + 1, optionButtons.length - 1);
        if (event.key === "ArrowUp") nextIndex = Math.max(index - 1, 0);
        if (event.key === "Home") nextIndex = 0;
        if (event.key === "End") nextIndex = optionButtons.length - 1;

        if (nextIndex !== index) {
          event.preventDefault();
          optionButtons[nextIndex].focus();
          optionButtons[nextIndex].scrollIntoView({ block: "nearest" });
        }

        if (event.key === "Escape") {
          event.preventDefault();
          close();
          button.focus();
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          commitSelection(index);
        }
      });
    });

    select.addEventListener("change", syncFromSelect);

    var form = select.form;
    if (form) {
      form.addEventListener("reset", function () {
        window.setTimeout(syncFromSelect, 0);
      });
    }

    syncFromSelect();

    instanceMap.set(select, {
      close: close,
      wrapper: wrapper,
    });
  }

  function enhanceAll(root) {
    var scope = root || document;
    Array.prototype.forEach.call(scope.querySelectorAll("select"), enhanceSelect);
  }

  document.addEventListener("click", function (event) {
    instanceMap.forEach(function (instance) {
      if (!instance.wrapper.contains(event.target)) instance.close();
    });
  });

  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    instanceMap.forEach(function (instance) {
      instance.close();
    });
  });

  document.addEventListener("DOMContentLoaded", function () {
    enhanceAll(document);

    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        Array.prototype.forEach.call(mutation.addedNodes, function (node) {
          if (!(node instanceof HTMLElement)) return;
          if (node.tagName === "SELECT") enhanceSelect(node);
          enhanceAll(node);
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });

  window.PocketDocsEnhanceSelects = enhanceAll;
})();
