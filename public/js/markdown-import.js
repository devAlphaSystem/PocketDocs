(function () {
  var dialog = document.querySelector("[data-markdown-import-dialog]");
  var openButton = document.querySelector("[data-markdown-import-open]");
  if (!dialog || !openButton) return;

  var form = dialog.querySelector("[data-markdown-import-form]");
  var fileInputs = Array.from(dialog.querySelectorAll("[data-markdown-import-input]"));
  var submitButton = dialog.querySelector("[data-markdown-import-submit]");
  var summary = dialog.querySelector("[data-markdown-import-summary]");
  var fileList = dialog.querySelector("[data-markdown-import-file-list]");
  var errorBox = dialog.querySelector("[data-markdown-import-error]");
  var closeButtons = dialog.querySelectorAll("[data-markdown-import-close]");
  var importUrl = dialog.getAttribute("data-import-url") || "";
  var pageEditorBaseUrl = dialog.getAttribute("data-page-editor-base-url") || "";
  var csrfToken = dialog.getAttribute("data-csrf") || "";
  var maxTotalContent = Number(dialog.getAttribute("data-max-total-content")) || 1500000;
  var markdownExtensionPattern = /\.(md|markdown)$/i;
  var selectedFiles = [];
  var selectedInput = null;
  var importing = false;

  function setError(message) {
    if (!errorBox) return;
    errorBox.textContent = message || "";
    if (message) {
      errorBox.removeAttribute("hidden");
    } else {
      errorBox.setAttribute("hidden", "");
    }
  }

  function showError(title, message) {
    if (typeof window.showAlert === "function") {
      window.showAlert({
        title: title || "Import failed",
        message: message || "We couldn't import the selected Markdown files.",
        confirmText: "Close",
      });
      return;
    }
    setError(message || "We couldn't import the selected Markdown files.");
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
  }

  function isFolderInput(input) {
    return input && input.getAttribute("data-markdown-import-source") === "folder";
  }

  function getRelativePath(path, stripRoot) {
    var segments = String(path || "")
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean);

    if (stripRoot && segments.length > 1) {
      segments.shift();
    }

    return segments.join("/") || "Markdown file";
  }

  function getFileDisplayName(file) {
    var path = file.webkitRelativePath || file.name || "Markdown file";
    return getRelativePath(path, isFolderInput(selectedInput) && Boolean(file.webkitRelativePath));
  }

  function isMarkdownFile(file) {
    return markdownExtensionPattern.test(getFileDisplayName(file));
  }

  function clearChildren(element) {
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function clearUpdatedPageDrafts(pageIds) {
    if (!pageEditorBaseUrl || !Array.isArray(pageIds) || typeof window.localStorage === "undefined") return;

    try {
      pageIds.forEach(function (pageId) {
        if (!pageId) return;
        window.localStorage.removeItem("smde_" + pageEditorBaseUrl + "/" + pageId);
      });
    } catch {}
  }

  function resetDialog() {
    selectedFiles = [];
    selectedInput = null;
    importing = false;
    fileInputs.forEach(function (input) {
      input.value = "";
    });
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.removeAttribute("aria-busy");
    }
    if (summary) {
      summary.textContent = "";
      summary.setAttribute("hidden", "");
    }
    if (fileList) {
      clearChildren(fileList);
      fileList.setAttribute("hidden", "");
    }
    setError("");
  }

  function closeDialog() {
    if (importing) return;
    if (dialog.open) {
      dialog.close();
    }
    resetDialog();
  }

  function closeDialogForProcessing() {
    if (dialog.open && typeof dialog.close === "function") {
      dialog.close();
      return;
    }
    dialog.removeAttribute("open");
  }

  function renderFileList(files) {
    if (!summary || !fileList) return;

    clearChildren(fileList);

    if (!files.length) {
      summary.textContent = "";
      summary.setAttribute("hidden", "");
      fileList.setAttribute("hidden", "");
      return;
    }

    var totalBytes = files.reduce(function (sum, file) {
      return sum + file.size;
    }, 0);
    summary.textContent = files.length + " file" + (files.length !== 1 ? "s" : "") + " selected - " + formatBytes(totalBytes) + " of " + formatBytes(maxTotalContent);
    summary.removeAttribute("hidden");

    files.forEach(function (file) {
      var item = document.createElement("li");
      var name = document.createElement("span");
      var size = document.createElement("span");

      item.className = "markdown-import-file-item";
      name.className = "markdown-import-file-name";
      size.className = "markdown-import-file-size";

      name.textContent = getFileDisplayName(file);
      size.textContent = formatBytes(file.size);

      item.appendChild(name);
      item.appendChild(size);
      fileList.appendChild(item);
    });

    fileList.removeAttribute("hidden");
  }

  function validateSelectedFiles(files) {
    if (!files.length) {
      return "Select at least one Markdown file to import.";
    }
    var invalidFile = files.find(function (file) {
      return !isMarkdownFile(file);
    });
    if (invalidFile) {
      return getFileDisplayName(invalidFile) + " is not a Markdown file.";
    }

    var totalBytes = files.reduce(function (sum, file) {
      return sum + file.size;
    }, 0);
    if (totalBytes > maxTotalContent) {
      return "The selected Markdown files are larger than the " + formatBytes(maxTotalContent) + " import limit.";
    }

    return "";
  }

  async function readSelectedFiles(files) {
    var payload = [];
    var totalContentLength = 0;

    for (var index = 0; index < files.length; index += 1) {
      var file = files[index];
      var content = await file.text();
      totalContentLength += content.length;
      if (totalContentLength > maxTotalContent) {
        throw new Error("The selected Markdown files are larger than the " + formatBytes(maxTotalContent) + " import limit.");
      }
      payload.push({
        filename: getFileDisplayName(file),
        content: content,
      });
    }

    return payload;
  }

  async function parseErrorMessage(response) {
    try {
      var body = await response.json();
      return (body && body.error && body.error.message) || "We couldn't import the selected Markdown files.";
    } catch {
      return "We couldn't import the selected Markdown files.";
    }
  }

  openButton.addEventListener("click", function (event) {
    event.preventDefault();
    resetDialog();
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      return;
    }
    dialog.setAttribute("open", "");
  });

  closeButtons.forEach(function (button) {
    button.addEventListener("click", closeDialog);
  });

  dialog.addEventListener("cancel", function (event) {
    if (importing) {
      event.preventDefault();
      return;
    }
    resetDialog();
  });

  fileInputs.forEach(function (input) {
    input.addEventListener("change", function () {
      selectedInput = input;
      fileInputs.forEach(function (otherInput) {
        if (otherInput !== input) {
          otherInput.value = "";
        }
      });

      var files = Array.from(input.files || []);
      selectedFiles = isFolderInput(input)
        ? files.filter(function (file) {
            return isMarkdownFile(file);
          })
        : files;

      var errorMessage = validateSelectedFiles(selectedFiles);
      setError(errorMessage);
      renderFileList(selectedFiles);
      if (submitButton) {
        submitButton.disabled = Boolean(errorMessage) || selectedFiles.length === 0;
      }
    });
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (importing) return;

    var errorMessage = validateSelectedFiles(selectedFiles);
    if (errorMessage) {
      setError(errorMessage);
      return;
    }

    importing = true;
    setError("");
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.setAttribute("aria-busy", "true");
    }

    if (typeof window.showLoadingModal === "function") {
      closeDialogForProcessing();
      window.showLoadingModal({
        title: "Importing Markdown",
        message: "Please wait while the selected files are imported.",
      });
    }

    try {
      var files = await readSelectedFiles(selectedFiles);
      var response = await fetch(importUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ files: files }),
      });

      if (!response.ok) {
        throw new Error(await parseErrorMessage(response));
      }

      var result = await response.json();
      clearUpdatedPageDrafts(result.updatedPageIds);
      if (typeof window.hideModal === "function") {
        window.hideModal();
      }
      window.location.href = result.redirectUrl || window.location.href;
    } catch (error) {
      importing = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.removeAttribute("aria-busy");
      }
      if (typeof window.hideModal === "function") {
        window.hideModal();
      }
      showError("Import failed", error.message);
    }
  });
})();
