(function () {
  var container = document.getElementById("toastContainer");
  if (!container) return;

  var icons = {
    success: "ph-check",
    warning: "ph-warning",
    error: "ph-warning-circle",
    info: "ph-info",
  };

  function positionContainer() {
    var dialogs = document.querySelectorAll("dialog[open]");
    var parent = dialogs.length ? dialogs[dialogs.length - 1] : document.body;
    if (container.parentElement === parent) return;

    if (container.matches(":popover-open")) container.hidePopover();
    parent.appendChild(container);
  }

  window.showToast = function (message, type) {
    if (!message) return;
    type = type === "warn" ? "warning" : type || "info";
    if (!Object.prototype.hasOwnProperty.call(icons, type)) type = "info";

    var toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    toast.setAttribute("role", type === "error" || type === "warning" ? "alert" : "status");
    toast.setAttribute("aria-atomic", "true");

    var icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.setAttribute("aria-hidden", "true");
    var symbol = document.createElement("i");
    symbol.className = "ph " + icons[type];
    icon.appendChild(symbol);

    var text = document.createElement("span");
    text.className = "toast-message";
    text.textContent = message;

    var close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.setAttribute("aria-label", "Close notification");
    var closeIcon = document.createElement("i");
    closeIcon.className = "ph ph-x";
    closeIcon.setAttribute("aria-hidden", "true");
    close.appendChild(closeIcon);

    toast.appendChild(icon);
    toast.appendChild(text);
    toast.appendChild(close);
    positionContainer();
    container.appendChild(toast);
    if (!container.matches(":popover-open")) container.showPopover();

    function dismiss() {
      window.clearTimeout(timer);
      toast.remove();
      if (!container.children.length && container.matches(":popover-open")) container.hidePopover();
    }

    var timer = window.setTimeout(dismiss, 5000);
    close.addEventListener("click", dismiss);
  };

  document.addEventListener(
    "close",
    function (event) {
      if (event.target.tagName !== "DIALOG" || !event.target.contains(container)) return;
      positionContainer();
      if (container.children.length && !container.matches(":popover-open")) container.showPopover();
    },
    true,
  );

  window.PocketDocs = window.PocketDocs || {};
  window.PocketDocs.showPageToasts = function (root, pageUrl) {
    var source = root.querySelector("#toastContainer");
    var url = pageUrl ? new URL(pageUrl, window.location.href) : null;
    var cleaned = false;

    Object.keys(icons).forEach(function (type) {
      var attribute = "data-toast-" + type;
      var message = source ? source.getAttribute(attribute) : "";
      if (!message && url) message = url.searchParams.get(type);
      if (type === "warning" && !message && url) message = url.searchParams.get("warn");
      if (message) window.showToast(message, type);
      if (source) source.removeAttribute(attribute);
      if (url && url.searchParams.has(type)) {
        url.searchParams.delete(type);
        cleaned = true;
      }
    });

    if (url && url.searchParams.has("warn")) {
      url.searchParams.delete("warn");
      cleaned = true;
    }
    if (root === document && cleaned) {
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    }
  };

  window.PocketDocs.showPageToasts(document, window.location.href);
})();
