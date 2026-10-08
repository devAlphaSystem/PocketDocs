(function () {
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  window.PocketDocs = window.PocketDocs || {};

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  window.PocketDocs.slugify = slugify;

  document.addEventListener("click", function (event) {
    var activeMenu = event.target.closest ? event.target.closest("details.header-menu") : null;

    document.querySelectorAll("details.header-menu[open]").forEach(function (menu) {
      if (menu === activeMenu) return;
      menu.removeAttribute("open");
    });
  });

  document.addEventListener(
    "invalid",
    function (event) {
      var accordion = event.target.closest("details.accordion");
      if (!accordion || accordion.open || event.target.closest("summary")) return;

      accordion.open = true;
      event.target.reportValidity();
    },
    true,
  );

  function initAutoSlug(root) {
    var scope = root && root.querySelectorAll ? root : document;

    scope.querySelectorAll("[data-auto-slug-source]").forEach(function (source) {
      if (source.dataset.autoSlugReady === "true") return;

      var targetId = source.getAttribute("data-auto-slug-target");
      var form = source.closest("form");
      var target = targetId && form ? form.querySelector("#" + targetId) : null;
      if (!target && targetId) target = document.getElementById(targetId);
      if (!target) return;

      source.dataset.autoSlugReady = "true";
      var autoSlug = source.getAttribute("data-auto-slug-when-empty") === "true" ? !target.value : true;

      target.addEventListener("input", function () {
        autoSlug = false;
      });

      source.addEventListener("input", function () {
        if (autoSlug) {
          target.value = slugify(source.value);
        }
      });
    });
  }

  window.PocketDocs.initAutoSlug = initAutoSlug;
  initAutoSlug(document);

  function initPocketBaseFields(root) {
    var scope = root && root.querySelectorAll ? root : document;

    scope.querySelectorAll(".dialog-body .form-group, .admin-drawer-body .form-group").forEach(function (group) {
      if (group.dataset.pocketBaseFieldReady === "true") return;

      var surface = document.createElement("div");
      surface.className = "pb-field-surface";

      Array.prototype.slice.call(group.childNodes).forEach(function (node) {
        var isAuxiliaryContent = node.nodeType === 1 && node.matches(".form-hint, .version-label-suggestions, .field-error, .form-error");
        if (!isAuxiliaryContent) surface.appendChild(node);
      });

      if (!surface.children.length) return;

      group.insertBefore(surface, group.firstChild);
      group.dataset.pocketBaseFieldReady = "true";
    });
  }

  window.PocketDocs.initPocketBaseFields = initPocketBaseFields;
  initPocketBaseFields(document);

  document.addEventListener("click", function (event) {
    var fillTrigger = event.target.closest ? event.target.closest("[data-fill-target][data-fill-value]") : null;
    if (!fillTrigger) return;

    var targetId = fillTrigger.getAttribute("data-fill-target");
    var target = targetId ? document.getElementById(targetId) : null;
    if (!target || typeof target.value === "undefined") return;

    event.preventDefault();

    var value = fillTrigger.getAttribute("data-fill-value") || "";
    target.value = value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.focus();

    if (typeof target.setSelectionRange === "function") {
      target.setSelectionRange(value.length, value.length);
    }
  });

  function openDialog(dialog) {
    if (!dialog) return;
    if (dialog.hasAttribute("data-dialog-reset-on-open")) {
      var form = dialog.querySelector("form");
      if (form) form.reset();
    }
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      return;
    }
    dialog.setAttribute("open", "");
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function") {
      dialog.close();
      return;
    }
    dialog.removeAttribute("open");
  }

  function requestDialogClose(dialog) {
    if (!dialog) return;
    var cancelEvent = new Event("cancel", { cancelable: true });
    if (!dialog.dispatchEvent(cancelEvent)) return;
    closeDialog(dialog);
  }

  function isDialogBackdropClick(dialog, event) {
    if (!dialog || !dialog.open || event.target !== dialog) return false;

    var rect = dialog.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }

  document.addEventListener("click", function (event) {
    var openTrigger = event.target.closest ? event.target.closest("[data-dialog-open]") : null;
    if (openTrigger) {
      event.preventDefault();
      openDialog(document.getElementById(openTrigger.getAttribute("data-dialog-open")));
      return;
    }

    var closeTrigger = event.target.closest ? event.target.closest("[data-dialog-close]") : null;
    if (closeTrigger) {
      event.preventDefault();
      requestDialogClose(document.getElementById(closeTrigger.getAttribute("data-dialog-close")));
    }
  });

  document.querySelectorAll("dialog.admin-dialog").forEach(function (dialog) {
    dialog.addEventListener("click", function (event) {
      if (!isDialogBackdropClick(dialog, event)) return;
      event.preventDefault();
      requestDialogClose(dialog);
    });
  });

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented) return;

    document.querySelectorAll("dialog.admin-dialog[open]").forEach(function (dialog) {
      if (dialog.contains(event.target)) return;
      requestDialogClose(dialog);
    });
  });

  document.querySelectorAll("[data-dialog-autoshow]").forEach(function (dialog) {
    if (!dialog.open) {
      openDialog(dialog);
    }
  });

  var adminDrawer = document.getElementById("adminDrawer");
  var adminDrawerPanel = adminDrawer ? adminDrawer.querySelector(".admin-drawer-panel") : null;
  var adminDrawerTitle = document.getElementById("adminDrawerTitle");
  var adminDrawerBody = document.getElementById("adminDrawerBody");
  var adminDrawerFooter = document.getElementById("adminDrawerFooter");
  var drawerLastFocus = null;
  var drawerRequestId = 0;
  var overlayCloseId = 0;

  function isDrawerOpen() {
    return Boolean(adminDrawer && !adminDrawer.hasAttribute("hidden"));
  }

  function setOverlayScrollLock() {
    var drawerVisible = isDrawerOpen() || (adminDrawer && adminDrawer.hasAttribute("data-closing"));
    var modalVisible = modal && (!modal.hasAttribute("hidden") || modal.hasAttribute("data-closing"));
    document.body.style.overflow = drawerVisible || modalVisible ? "hidden" : "";
  }

  function closeOverlay(overlay, onClosed) {
    var closeId = String(++overlayCloseId);
    overlay.setAttribute("data-closing", closeId);
    overlay.inert = true;
    overlay.setAttribute("hidden", "");

    Promise.allSettled(
      overlay.getAnimations().map(function (animation) {
        return animation.finished;
      }),
    ).then(function () {
      if (overlay.getAttribute("data-closing") !== closeId) return;
      overlay.removeAttribute("data-closing");
      onClosed();
      setOverlayScrollLock();
    });
  }

  function setDrawerLoading() {
    if (!adminDrawerBody || !adminDrawerFooter) return;
    adminDrawerBody.classList.add("admin-drawer-body-loading");
    adminDrawerBody.innerHTML = '<div class="admin-modal-spinner" aria-label="Loading"></div>';
    adminDrawerFooter.innerHTML = "";
  }

  function destroyDrawerContent() {
    if (window.PocketDocs && typeof window.PocketDocs.destroyEditors === "function" && adminDrawerBody) {
      window.PocketDocs.destroyEditors(adminDrawerBody);
    }
    if (adminDrawerBody) {
      adminDrawerBody.classList.remove("admin-drawer-body-loading");
      adminDrawerBody.innerHTML = "";
    }
    if (adminDrawerFooter) adminDrawerFooter.innerHTML = "";
  }

  function closeDrawer() {
    if (!isDrawerOpen()) return;
    drawerRequestId += 1;
    closeOverlay(adminDrawer, function () {
      destroyDrawerContent();
      if (drawerLastFocus && typeof drawerLastFocus.focus === "function" && (document.activeElement === document.body || adminDrawer.contains(document.activeElement))) {
        drawerLastFocus.focus();
      }
      drawerLastFocus = null;
    });
  }

  function resourceUrl(value) {
    try {
      return new URL(value, window.location.href).href;
    } catch {
      return "";
    }
  }

  function resourceKey(value) {
    try {
      var url = new URL(value, window.location.href);
      return url.origin + url.pathname;
    } catch {
      return "";
    }
  }

  function loadDrawerStyles(parsedDocument) {
    var existing = {};
    document.querySelectorAll('link[rel="stylesheet"][href]').forEach(function (link) {
      existing[resourceKey(link.getAttribute("href"))] = true;
    });

    parsedDocument.querySelectorAll('link[rel="stylesheet"][href]').forEach(function (link) {
      var href = resourceUrl(link.getAttribute("href"));
      var key = resourceKey(href);
      if (!href || !key || existing[key]) return;

      var stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = href;
      document.head.appendChild(stylesheet);
      existing[key] = true;
    });
  }

  function loadDrawerScripts(parsedDocument) {
    var existing = {};
    document.querySelectorAll("script[src]").forEach(function (script) {
      existing[resourceKey(script.getAttribute("src"))] = true;
    });

    var sources = [];
    parsedDocument.querySelectorAll("script[src]").forEach(function (script) {
      var src = resourceUrl(script.getAttribute("src"));
      var key = resourceKey(src);
      if (!src || !key || existing[key]) return;
      existing[key] = true;
      sources.push(src);
    });

    return sources.reduce(function (chain, src) {
      return chain.then(function () {
        return new Promise(function (resolve, reject) {
          var script = document.createElement("script");
          script.src = src;
          script.onload = resolve;
          script.onerror = reject;
          document.body.appendChild(script);
        });
      });
    }, Promise.resolve());
  }

  function normalizeDrawerCloseAction(actions) {
    if (!actions) return;

    var closeAction = actions.querySelector("[data-drawer-close]");
    if (!closeAction) {
      actions.querySelectorAll("a.btn, button.btn").forEach(function (action) {
        if (closeAction) return;
        var label = action.textContent.trim().toLowerCase();
        if (label === "cancel" || label === "close") closeAction = action;
      });
    }

    if (!closeAction) {
      closeAction = document.createElement("button");
      closeAction.type = "button";
      closeAction.className = "btn";
    }

    closeAction.setAttribute("data-drawer-close", "");
    closeAction.classList.remove("btn-outline");
    closeAction.classList.add("btn-ghost");
    closeAction.textContent = "Close";

    var dangerButton = actions.querySelector(".btn-danger");
    var dangerAction = dangerButton ? dangerButton.closest("form") || dangerButton : null;
    var leadingActions = actions.querySelector(":scope > .drawer-leading-actions");

    if (!leadingActions) {
      leadingActions = document.createElement("div");
      leadingActions.className = "drawer-leading-actions";
      actions.insertBefore(leadingActions, actions.firstChild);
    }

    leadingActions.appendChild(closeAction);
    if (dangerAction && dangerAction !== closeAction) leadingActions.appendChild(dangerAction);
  }

  function prepareDrawerActions(fragment) {
    var pageHeader = fragment.querySelector(".page-header");
    if (!pageHeader || !adminDrawerFooter) return;

    var actions = pageHeader.querySelector(".header-actions");
    if (actions) {
      normalizeDrawerCloseAction(actions);
      adminDrawerFooter.appendChild(actions);
    }
    pageHeader.remove();
  }

  function prepareAutoshowDialog(parsedDocument) {
    var sourceDialog = parsedDocument.querySelector(".admin-view dialog[data-dialog-autoshow]");
    if (!sourceDialog) return null;

    var sourceForm = sourceDialog.querySelector("form");
    if (!sourceForm) return null;

    var form = sourceForm.cloneNode(true);
    var formId = form.id || "admin-drawer-form-" + Date.now().toString(36);
    form.id = formId;
    form.classList.add("admin-drawer-form");

    var footer = form.querySelector(".dialog-footer");
    if (footer && adminDrawerFooter) {
      var actions = document.createElement("div");
      actions.className = "header-actions";

      while (footer.firstChild) {
        var action = footer.firstChild;
        if (action.nodeType === 1) {
          if (action.matches("button[type='submit']")) action.setAttribute("form", formId);
        }
        actions.appendChild(action);
      }
      normalizeDrawerCloseAction(actions);
      footer.remove();
      adminDrawerFooter.appendChild(actions);
    }

    var body = form.querySelector(".dialog-body");
    if (body) {
      while (body.firstChild) {
        form.insertBefore(body.firstChild, body);
      }
      body.remove();
    }

    var heading = sourceDialog.querySelector(".dialog-header h2");
    return {
      fragment: form,
      title: heading ? heading.textContent.trim() : "Details",
    };
  }

  function initDrawerContent() {
    if (window.PocketDocs && typeof window.PocketDocs.initPocketBaseFields === "function") {
      window.PocketDocs.initPocketBaseFields(adminDrawerBody);
    }
    if (window.PocketDocs && typeof window.PocketDocs.initAutoSlug === "function") {
      window.PocketDocs.initAutoSlug(adminDrawerBody);
    }
    if (window.PocketDocs && typeof window.PocketDocs.initEditors === "function") {
      window.PocketDocs.initEditors(adminDrawerBody);
    }
  }

  function renderDrawerDocument(parsedDocument, title) {
    var source = parsedDocument.querySelector(".admin-view");
    if (!source || !adminDrawerBody || !adminDrawerFooter) {
      throw new Error("The requested form could not be loaded.");
    }

    destroyDrawerContent();
    var dialogContent = prepareAutoshowDialog(parsedDocument);
    var fragment = dialogContent ? dialogContent.fragment : source.cloneNode(true);
    adminDrawerTitle.textContent = title || (dialogContent && dialogContent.title) || parsedDocument.title.split("|")[0].trim() || "Details";

    if (!dialogContent) prepareDrawerActions(fragment);
    adminDrawerBody.appendChild(fragment);
    loadDrawerStyles(parsedDocument);

    return loadDrawerScripts(parsedDocument).then(function () {
      initDrawerContent();
      window.PocketDocs.showPageToasts(parsedDocument);
    });
  }

  function showDrawerError(url) {
    if (!adminDrawerBody || !adminDrawerFooter) return;
    destroyDrawerContent();
    adminDrawerBody.innerHTML = '<div class="admin-drawer-error"><a class="btn btn-outline" href="' + escapeHtml(url) + '">Open full page</a></div>';
    window.showToast("Unable to load this form. Try again or open the full page.", "error");
  }

  function fetchDrawerDocument(url) {
    return fetch(url, {
      method: "GET",
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Request failed");
        return response.text();
      })
      .then(function (html) {
        return new DOMParser().parseFromString(html, "text/html");
      });
  }

  function openDrawer(url, title) {
    if (!adminDrawer || !adminDrawerPanel || !adminDrawerTitle || !adminDrawerBody || !adminDrawerFooter) {
      window.location.href = url;
      return;
    }

    drawerRequestId += 1;
    var requestId = drawerRequestId;
    drawerLastFocus = document.activeElement;
    adminDrawerTitle.textContent = title || "Details";
    adminDrawer.removeAttribute("data-closing");
    adminDrawer.inert = false;
    adminDrawer.removeAttribute("hidden");
    destroyDrawerContent();
    setDrawerLoading();
    setOverlayScrollLock();
    adminDrawerPanel.focus();

    fetchDrawerDocument(url)
      .then(function (parsedDocument) {
        if (requestId !== drawerRequestId) return;
        return renderDrawerDocument(parsedDocument, title);
      })
      .catch(function () {
        if (requestId !== drawerRequestId) return;
        showDrawerError(url);
      });
  }

  window.PocketDocs.openDrawer = openDrawer;
  window.PocketDocs.closeDrawer = closeDrawer;

  document.addEventListener("click", function (event) {
    var closeTrigger = event.target.closest ? event.target.closest("[data-drawer-close]") : null;
    if (closeTrigger && isDrawerOpen()) {
      event.preventDefault();
      closeDrawer();
      return;
    }

    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var trigger = event.target.closest ? event.target.closest("[data-drawer-url]") : null;
    if (!trigger) return;
    if (trigger.matches("[data-row-link]") && event.target.closest("a, button, input, select, textarea, label, form")) return;

    var url = trigger.getAttribute("data-drawer-url") || trigger.getAttribute("href");
    if (!url) return;

    event.preventDefault();
    openDrawer(url, trigger.getAttribute("data-drawer-title") || trigger.getAttribute("title") || "Details");
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && isDrawerOpen()) {
      event.preventDefault();
      closeDrawer();
      return;
    }

    if (event.key !== "Enter" && event.key !== " ") return;
    var row = event.target.closest ? event.target.closest("[data-row-link]") : null;
    if (!row || event.target !== row) return;

    event.preventDefault();
    var href = row.getAttribute("data-row-link");
    if (!href) return;
    if (row.hasAttribute("data-drawer-url")) {
      openDrawer(row.getAttribute("data-drawer-url") || href, row.getAttribute("data-drawer-title") || "Details");
      return;
    }
    window.location.href = href;
  });

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented) return;
    var row = event.target.closest ? event.target.closest("[data-row-link]") : null;
    if (!row || event.target.closest("a, button, input, select, textarea, label, form")) return;

    var href = row.getAttribute("data-row-link");
    if (!href) return;
    if (row.hasAttribute("data-drawer-url")) {
      event.preventDefault();
      openDrawer(row.getAttribute("data-drawer-url") || href, row.getAttribute("data-drawer-title") || "Details");
      return;
    }
    window.location.href = href;
  });

  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!isDrawerOpen() || !form || !form.matches || !form.matches("form")) return;
    if (!adminDrawer.contains(form) || form.hasAttribute("data-confirm-message")) return;

    var method = (form.getAttribute("method") || "GET").toUpperCase();
    if (method === "GET") return;

    event.preventDefault();
    var submitter = event.submitter;
    if (submitter) submitter.disabled = true;
    var requestId = drawerRequestId;

    var formData = new FormData(form);
    var enctype = (form.getAttribute("enctype") || "").toLowerCase();
    var body = enctype === "multipart/form-data" ? formData : new URLSearchParams(formData);

    fetch(form.action, {
      method: method,
      body: body,
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
      .then(function (response) {
        if (response.redirected) {
          window.location.href = response.url;
          return null;
        }
        if (response.status === 204) {
          window.location.reload();
          return null;
        }
        if (!response.ok && (response.headers.get("Content-Type") || "").includes("application/json")) {
          return response.json().then(function (payload) {
            if (requestId !== drawerRequestId) return null;
            if (submitter) submitter.disabled = false;
            window.showToast(payload.error.message, "error");
            return null;
          });
        }
        return response.text().then(function (html) {
          return {
            response: response,
            document: new DOMParser().parseFromString(html, "text/html"),
          };
        });
      })
      .then(function (result) {
        if (!result || requestId !== drawerRequestId) return;
        return renderDrawerDocument(result.document, adminDrawerTitle.textContent);
      })
      .catch(function () {
        if (submitter) submitter.disabled = false;
        if (typeof window.showToast === "function") {
          window.showToast("Unable to save changes. Please try again.", "error");
        }
      });
  });

  var modal = document.getElementById("adminModal");
  var modalDialog = modal ? modal.querySelector(".admin-modal-dialog") : null;
  var modalBody = modal ? modal.querySelector(".admin-modal-body") : null;
  var modalTitle = document.getElementById("adminModalTitle");
  var modalLoading = document.getElementById("adminModalLoading");
  var modalMessage = document.getElementById("adminModalMessage");
  var modalCancel = document.getElementById("adminModalCancel");
  var modalConfirm = document.getElementById("adminModalConfirm");
  var modalCloseEls = modal ? modal.querySelectorAll("[data-modal-close]") : [];
  var modalState = null;
  var lastFocus = null;

  function resetModal() {
    if (!modal || !modalDialog || !modalBody || !modalMessage || !modalCancel || !modalConfirm) return;

    modal.dataset.mode = "confirm";
    if (modalLoading) {
      modalLoading.setAttribute("hidden", "");
      modalLoading.setAttribute("aria-hidden", "true");
    }
    modalMessage.removeAttribute("hidden");
    modalBody.classList.remove("admin-modal-body-loading");
    modalCancel.removeAttribute("hidden");
    modalConfirm.removeAttribute("hidden");
    modal.removeAttribute("data-presentation");
  }

  function canDismissModal() {
    return Boolean(modalState && modalState.dismissible !== false);
  }

  function closeModal(result) {
    if (!modal || !modalState) return;
    var resolver = modalState.resolve;
    modalState = null;
    closeOverlay(modal, function () {
      resetModal();
      if (lastFocus && typeof lastFocus.focus === "function" && (document.activeElement === document.body || modal.contains(document.activeElement))) {
        lastFocus.focus();
      }
      lastFocus = null;
    });
    if (typeof resolver === "function") {
      resolver(Boolean(result));
    }
  }

  function openModal(options) {
    options = options || {};
    var isLoading = options.mode === "loading";

    if (!modal || !modalDialog || !modalTitle || !modalMessage || !modalConfirm || !modalCancel) {
      if (isLoading) {
        return Promise.resolve(false);
      }
      return Promise.resolve(window.confirm(options.message || "Are you sure?"));
    }

    if (modalState) {
      if (typeof modalState.resolve === "function") {
        modalState.resolve(false);
      }
      modalState = null;
    }

    resetModal();
    lastFocus = document.activeElement;
    modalTitle.textContent = options.title || "Confirm Action";
    modalMessage.textContent = options.message || "Are you sure you want to continue?";
    modalConfirm.textContent = options.confirmText || "Confirm";
    modalCancel.textContent = options.cancelText || "Cancel";
    modalConfirm.className = "btn " + (options.confirmVariant === "primary" ? "btn-primary" : "btn-danger");

    if (!isLoading && options.confirmVariant !== "primary") {
      modal.dataset.presentation = "dialog";
    }

    if (isLoading) {
      modal.dataset.mode = "loading";
      if (modalLoading) {
        modalLoading.removeAttribute("hidden");
        modalLoading.setAttribute("aria-hidden", "false");
      }
      modalCancel.setAttribute("hidden", "");
      modalConfirm.setAttribute("hidden", "");
    }

    modal.removeAttribute("data-closing");
    modal.inert = false;
    modal.removeAttribute("hidden");
    setOverlayScrollLock();

    return new Promise(function (resolve) {
      modalState = {
        resolve: resolve,
        dismissible: options.dismissible !== false && !isLoading,
      };
      setTimeout(function () {
        modalDialog.focus();
      }, 0);
    });
  }

  window.showConfirm = function (options) {
    return openModal(options || {});
  };

  window.showLoadingModal = function (options) {
    options = options || {};
    return openModal({
      title: options.title || "Working",
      message: options.message || "Please wait while we prepare your request.",
      mode: "loading",
      dismissible: false,
    });
  };

  window.hideModal = function () {
    closeModal(false);
  };

  if (modal) {
    if (modalCancel) {
      modalCancel.addEventListener("click", function () {
        if (!canDismissModal()) return;
        closeModal(false);
      });
    }

    if (modalConfirm) {
      modalConfirm.addEventListener("click", function () {
        if (!canDismissModal()) return;
        closeModal(true);
      });
    }

    modalCloseEls.forEach(function (el) {
      el.addEventListener("click", function () {
        if (!canDismissModal()) return;
        closeModal(false);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (!modalState) return;
      if (event.key === "Escape") {
        if (!canDismissModal()) return;
        event.preventDefault();
        closeModal(false);
      }
    });
  }

  document.addEventListener(
    "submit",
    function (event) {
      var form = event.target;
      if (!form || !form.matches || !form.matches("form[data-confirm-message]")) return;
      if (form.dataset.confirmed === "true") return;

      event.preventDefault();

      var options = {
        title: form.getAttribute("data-confirm-title") || "Confirm Action",
        message: form.getAttribute("data-confirm-message") || "Are you sure you want to continue?",
        confirmText: form.getAttribute("data-confirm-button") || "Confirm",
        cancelText: form.getAttribute("data-cancel-button") || "Cancel",
        confirmVariant: form.getAttribute("data-confirm-variant") || "danger",
      };

      openModal(options).then(function (confirmed) {
        if (!confirmed) return;
        form.dataset.confirmed = "true";
        form.submit();
      });
    },
    true,
  );

  var activeDownload = null;

  function createDownloadToken() {
    return "dl" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function getCookieValue(name) {
    var escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    var match = document.cookie.match(new RegExp("(?:^|; )" + escaped + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : "";
  }

  function clearCookie(name) {
    document.cookie = name + "=; Max-Age=0; path=/; SameSite=Strict";
  }

  function getDownloadFrame() {
    var frame = document.getElementById("adminDownloadFrame");
    if (frame) return frame;

    frame = document.createElement("iframe");
    frame.id = "adminDownloadFrame";
    frame.name = "adminDownloadFrame";
    frame.hidden = true;
    frame.tabIndex = -1;
    document.body.appendChild(frame);
    return frame;
  }

  function handleDownloadLink(link) {
    if (activeDownload) {
      if (typeof window.showToast === "function") {
        window.showToast("A download is already being prepared.", "info");
      }
      return;
    }

    var token = createDownloadToken();
    var downloadUrl = new URL(link.href, window.location.origin);
    downloadUrl.searchParams.set("downloadToken", token);

    if (typeof window.showLoadingModal === "function") {
      window.showLoadingModal({
        title: link.getAttribute("data-download-title") || "Preparing download",
        message: link.getAttribute("data-download-message") || "Please wait while your file is being prepared.",
      });
    }

    var frame = getDownloadFrame();
    var state = {
      token: token,
      frame: frame,
      completed: false,
      pollId: null,
      timeoutId: null,
      loadHandler: null,
    };

    function cleanup() {
      if (state.pollId) {
        window.clearInterval(state.pollId);
      }
      if (state.timeoutId) {
        window.clearTimeout(state.timeoutId);
      }
      if (state.loadHandler) {
        state.frame.removeEventListener("load", state.loadHandler);
      }
      activeDownload = null;
    }

    state.loadHandler = function () {
      if (state.completed) return;

      try {
        var doc = state.frame.contentDocument;
        var text = doc && doc.body ? doc.body.textContent.trim() : "";
        if (!text) return;
      } catch {
        return;
      }

      cleanup();
      if (typeof window.hideModal === "function") {
        window.hideModal();
      }
      window.showToast("We couldn't start the ZIP export. Please try again.", "error");
    };

    state.pollId = window.setInterval(function () {
      if (getCookieValue("pd_download") !== token) return;

      state.completed = true;
      clearCookie("pd_download");
      cleanup();

      if (typeof window.hideModal === "function") {
        window.hideModal();
      }
      if (typeof window.showToast === "function") {
        window.showToast("Download started.", "success");
      }
    }, 250);

    state.timeoutId = window.setTimeout(function () {
      if (state.completed) return;
      cleanup();

      if (typeof window.hideModal === "function") {
        window.hideModal();
      }
      window.showToast("The ZIP export is taking longer than expected. Please wait a moment and try again if the download does not start.", "warning");
    }, 45000);

    activeDownload = state;
    state.frame.addEventListener("load", state.loadHandler);
    state.frame.src = downloadUrl.toString();
  }

  document.addEventListener("click", function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var link = event.target.closest ? event.target.closest("a[data-download-link]") : null;
    if (!link) return;

    event.preventDefault();
    handleDownloadLink(link);
  });

  function isSaveShortcut(event) {
    if (event.defaultPrevented) return false;
    if (!(event.ctrlKey || event.metaKey)) return false;
    return event.key === "s" || event.key === "S" || event.code === "KeyS";
  }

  function isEligibleSaveForm(form) {
    if (!form || form.tagName !== "FORM") return false;
    if (form.classList.contains("inline-form")) return false;
    if (form.classList.contains("auth-form")) return false;
    if (form.hasAttribute("data-confirm-message")) return false;
    if (form.getAttribute("data-save-shortcut") === "off") return false;

    var method = (form.getAttribute("method") || "GET").toUpperCase();
    return method === "POST";
  }

  function resolveSaveTargetForm() {
    var activeElement = document.activeElement;
    if (activeElement && typeof activeElement.closest === "function") {
      var focusedForm = activeElement.closest("form");
      if (isEligibleSaveForm(focusedForm)) {
        return focusedForm;
      }
    }

    var fallback = document.querySelector("#adminDrawer form[method='POST']:not(.inline-form):not(.auth-form):not([data-confirm-message]):not([data-save-shortcut='off']), dialog.admin-dialog[open] form[method='POST']:not(.inline-form):not(.auth-form):not([data-confirm-message]):not([data-save-shortcut='off']), main.admin-content form[method='POST']:not(.inline-form):not(.auth-form):not([data-confirm-message]):not([data-save-shortcut='off'])");
    return fallback || null;
  }

  document.addEventListener("keydown", function (event) {
    if (!isSaveShortcut(event)) return;

    var form = resolveSaveTargetForm();
    if (!form) return;

    event.preventDefault();
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return;
    }
    form.submit();
  });

  var ipEnabledToggle = document.getElementById("ipEnabledToggle");
  if (ipEnabledToggle) {
    var ipEnabledValue = document.getElementById(ipEnabledToggle.getAttribute("data-value-target"));
    var ipStatusBadge = document.querySelector("[data-ip-status-badge]");

    function syncIpRestrictionState() {
      var enabled = ipEnabledToggle.checked;
      if (ipEnabledValue) ipEnabledValue.value = enabled ? "enable" : "disable";
      ipEnabledToggle.setAttribute("aria-checked", enabled ? "true" : "false");

      if (ipStatusBadge) {
        ipStatusBadge.textContent = enabled ? "Enabled" : "Disabled";
        ipStatusBadge.classList.toggle("badge-public", enabled);
        ipStatusBadge.classList.toggle("badge-private", !enabled);
      }
    }

    ipEnabledToggle.addEventListener("change", syncIpRestrictionState);
    syncIpRestrictionState();
  }

  var insertIpLink = document.getElementById("insert-my-ip");
  if (insertIpLink) {
    insertIpLink.addEventListener("click", function (event) {
      event.preventDefault();
      var ip = insertIpLink.getAttribute("data-ip");
      var textarea = document.getElementById("allowedIps");
      if (!ip || !textarea) return;

      var current = textarea.value.trim();
      var lines = current
        ? current.split(/\r?\n/).map(function (l) {
            return l.trim();
          })
        : [];
      if (lines.indexOf(ip) !== -1) return;

      textarea.value = current ? current + "\n" + ip : ip;
      textarea.focus();
    });
  }

  var siteIconFile = document.querySelector("[data-site-icon-file]");
  var siteIconValue = document.querySelector("[data-site-icon-value]");
  var siteIconRemove = document.querySelector("[data-site-icon-remove]");
  var siteIconPreview = document.querySelector("[data-site-icon-preview]");
  var siteIconReset = document.querySelector("[data-site-icon-reset]");

  if (siteIconFile && siteIconValue && siteIconPreview) {
    var siteIconMaxBytes = 256 * 1024;
    var siteIconTypes = ["image/svg+xml", "image/png", "image/jpeg", "image/webp"];

    siteIconFile.addEventListener("change", function () {
      var file = siteIconFile.files && siteIconFile.files[0];
      if (!file) return;

      if (siteIconTypes.indexOf(file.type) === -1 || file.size > siteIconMaxBytes) {
        siteIconFile.value = "";
        if (typeof window.showToast === "function") {
          window.showToast("Choose a PNG, JPEG, or WebP image up to 256 KB.", "error");
        }
        return;
      }

      var reader = new FileReader();
      reader.addEventListener("load", function () {
        if (typeof reader.result !== "string") return;
        siteIconValue.value = reader.result;
        if (siteIconRemove) siteIconRemove.value = "false";
        siteIconPreview.src = reader.result;
        if (siteIconReset) siteIconReset.hidden = false;
      });
      reader.addEventListener("error", function () {
        siteIconFile.value = "";
        if (typeof window.showToast === "function") {
          window.showToast("Unable to read this image.", "error");
        }
      });
      reader.readAsDataURL(file);
    });

    if (siteIconReset) {
      siteIconReset.addEventListener("click", function () {
        siteIconFile.value = "";
        siteIconValue.value = "";
        if (siteIconRemove) siteIconRemove.value = "true";
        siteIconPreview.src = siteIconPreview.getAttribute("data-default-src");
        siteIconReset.hidden = true;
      });
    }
  }
})();
