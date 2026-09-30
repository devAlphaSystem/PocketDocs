(function () {
  var PAGE_ICON_MAP = {
    readme: "book-open-text",
    license: "scales",
    licence: "scales",
    changelog: "clock-counter-clockwise",
    contributing: "git-pull-request",
    "code of conduct": "handshake",
    security: "shield-check",
    faq: "question",
    "getting started": "rocket-launch",
    installation: "download-simple",
    setup: "gear",
    configuration: "sliders-horizontal",
    api: "plugs-connected",
    "api reference": "plugs-connected",
    authentication: "lock-key",
    deployment: "cloud-arrow-up",
    troubleshooting: "wrench",
    architecture: "tree-structure",
    migration: "arrows-left-right",
    testing: "test-tube",
    examples: "code",
    tutorial: "graduation-cap",
    introduction: "hand-waving",
    overview: "binoculars",
    quickstart: "lightning",
    "quick start": "lightning",
    upgrade: "arrow-circle-up",
    plugins: "puzzle-piece",
    extensions: "puzzle-piece",
    glossary: "book-bookmark",
    reference: "files",
    usage: "book-open",
    guide: "compass",
    features: "star",
    "release notes": "newspaper",
    about: "info",
    support: "lifebuoy",
    contact: "envelope-simple",
    privacy: "eye-slash",
    "privacy policy": "eye-slash",
    terms: "file-text",
    "terms of service": "file-text",
  };

  var editorInstances = [];

  function sanitizeFileName(value) {
    return String(value || "")
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "");
  }

  function resolveDownloadFileName(textarea, form) {
    var slugInput = form ? form.querySelector('input[name="slug"]') : null;
    var titleInput = form ? form.querySelector('input[name="title"]') : null;
    var nameInput = form ? form.querySelector('input[name="name"]') : null;
    var candidates = [textarea.getAttribute("data-download-filename"), form && form.getAttribute("data-download-filename"), slugInput && slugInput.value, titleInput && titleInput.value, nameInput && nameInput.value, document.title];

    for (var i = 0; i < candidates.length; i += 1) {
      var normalized = sanitizeFileName(candidates[i]);
      if (!normalized) continue;
      return /\.md$/i.test(normalized) ? normalized : normalized + ".md";
    }

    return "document.md";
  }

  function downloadMarkdown(editor, textarea, form) {
    if (!window.URL || typeof window.URL.createObjectURL !== "function") return;

    var blob = new Blob([editor ? editor.value() : ""], { type: "text/markdown;charset=utf-8" });
    var fileUrl = window.URL.createObjectURL(blob);
    var link = document.createElement("a");

    link.href = fileUrl;
    link.download = resolveDownloadFileName(textarea, form);
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(fileUrl);
  }

  function refreshEditorLayout(instance) {
    if (!instance || !instance.codemirror) return;
    window.requestAnimationFrame(function () {
      instance.codemirror.refresh();
    });
  }

  function submitEditorForm(record) {
    if (!record || !record.form) return;
    record.textarea.value = record.editor.value();
    if (typeof record.form.requestSubmit === "function") {
      record.form.requestSubmit();
      return;
    }
    record.form.submit();
  }

  function initPageIcon(root) {
    root.querySelectorAll("[data-page-title-input]").forEach(function (titleInput) {
      if (titleInput.dataset.pageIconReady === "true") return;

      var form = titleInput.closest("form");
      var iconInput = form ? form.querySelector("[data-page-icon-input]") : null;
      if (!iconInput) return;

      titleInput.dataset.pageIconReady = "true";
      var autoIcon = !iconInput.value;

      iconInput.addEventListener("input", function () {
        autoIcon = false;
      });

      titleInput.addEventListener("input", function () {
        if (!autoIcon) return;
        iconInput.value = PAGE_ICON_MAP[titleInput.value.trim().toLowerCase()] || "";
      });
    });
  }

  function initContentItemCreators(root) {
    root.querySelectorAll("[data-content-item-create-form]").forEach(function (form) {
      if (form.dataset.contentItemCreateReady === "true") return;

      var itemTypeSelect = form.querySelector("[data-content-item-type]");
      var editorMeta = form.querySelector("[data-content-item-meta]");
      var titleGroup = form.querySelector("[data-content-item-title-group]");
      var titleInput = titleGroup ? titleGroup.querySelector('input[name="title"]') : null;
      var titleLabel = titleGroup ? titleGroup.querySelector("[data-content-item-title-label]") : null;
      var help = form.querySelector("[data-content-item-help]");
      var pageOnlyFields = form.querySelectorAll("[data-content-item-page-only]");
      var headerOnlyFields = form.querySelectorAll("[data-content-item-header-only]");
      var submitButton = document.querySelector('[data-content-item-submit][form="' + form.id + '"]');
      var submitLabel = submitButton ? submitButton.querySelector("span") : null;
      var textarea = form.querySelector("textarea#content");

      if (!itemTypeSelect || !titleGroup || !titleInput) return;
      form.dataset.contentItemCreateReady = "true";

      function updateContentItemFields() {
        var itemType = itemTypeSelect.value;
        var isPage = itemType === "page";
        var isHeader = itemType === "header";

        if (editorMeta) editorMeta.hidden = !isPage && !isHeader;
        titleGroup.hidden = !isPage && !isHeader;
        titleInput.required = isPage || isHeader;
        titleInput.maxLength = Number(isPage ? titleInput.dataset.pageTitleMaxlength : titleInput.dataset.headerTitleMaxlength);
        if (titleLabel) titleLabel.textContent = isHeader ? "Header title" : "Title";
        titleInput.placeholder = isHeader ? "API Reference" : "Getting Started";

        pageOnlyFields.forEach(function (field) {
          field.hidden = !isPage;
        });

        headerOnlyFields.forEach(function (field) {
          field.hidden = !isHeader;
        });

        if (help) {
          help.textContent = isPage ? "A page contains documentation and can be opened from the public sidebar." : isHeader ? "A header groups pages in a collapsible section of the public sidebar." : "A separator is displayed as a horizontal line in the public sidebar.";
        }

        if (submitLabel) {
          submitLabel.textContent = isPage ? "Create Page" : isHeader ? "Add Header" : "Add Separator";
        }

        if (isPage && textarea && textarea._pocketDocsEditor) {
          window.requestAnimationFrame(function () {
            textarea._pocketDocsEditor.editor.codemirror.refresh();
          });
        }
      }

      itemTypeSelect.addEventListener("change", updateContentItemFields);
      updateContentItemFields();
    });
  }

  function initEditor(textarea) {
    if (textarea.dataset.editorReady === "true" || typeof EasyMDE === "undefined") return;

    var form = textarea.closest("form");
    var editor = new EasyMDE({
      element: textarea,
      autoDownloadFontAwesome: false,
      spellChecker: false,
      autosave: {
        enabled: true,
        uniqueId: form && form.getAttribute("action") ? form.getAttribute("action") : window.location.pathname,
        delay: 5000,
      },
      status: ["autosave", "lines", "words"],
      shortcuts: {
        togglePreview: null,
        toggleSideBySide: null,
      },
      toolbar: [
        { name: "bold", action: EasyMDE.toggleBold, className: "ph ph-text-bolder", title: "Bold" },
        { name: "italic", action: EasyMDE.toggleItalic, className: "ph ph-text-italic", title: "Italic" },
        { name: "heading", action: EasyMDE.toggleHeadingSmaller, className: "ph ph-text-h", title: "Heading" },
        "|",
        { name: "quote", action: EasyMDE.toggleBlockquote, className: "ph ph-quotes", title: "Quote" },
        { name: "unordered-list", action: EasyMDE.toggleUnorderedList, className: "ph ph-list-bullets", title: "Unordered List" },
        { name: "ordered-list", action: EasyMDE.toggleOrderedList, className: "ph ph-list-numbers", title: "Ordered List" },
        "|",
        { name: "link", action: EasyMDE.drawLink, className: "ph ph-link", title: "Link" },
        { name: "image", action: EasyMDE.drawImage, className: "ph ph-image", title: "Image" },
        { name: "table", action: EasyMDE.drawTable, className: "ph ph-table", title: "Table" },
        { name: "horizontal-rule", action: EasyMDE.drawHorizontalRule, className: "ph ph-minus", title: "Horizontal Rule" },
        "|",
        { name: "code", action: EasyMDE.toggleCodeBlock, className: "ph ph-code", title: "Code" },
        { name: "fullscreen", action: EasyMDE.toggleFullScreen, className: "ph ph-arrows-out", title: "Fullscreen" },
        "|",
        {
          name: "download-markdown",
          action: function (instance) {
            downloadMarkdown(instance, textarea, form);
          },
          className: "ph ph-download-simple",
          title: "Download Markdown",
        },
        { name: "guide", action: "https://www.markdownguide.org/basic-syntax/", className: "ph ph-question", title: "Markdown Guide" },
      ],
      placeholder: "Write your documentation in Markdown...",
      renderingConfig: {
        codeSyntaxHighlighting: true,
      },
      onToggleFullScreen: function (isFullscreen) {
        document.body.classList.toggle("fullscreen", isFullscreen);
        refreshEditorLayout(editor);
      },
      minHeight: "400px",
    });

    var record = { textarea: textarea, form: form, editor: editor };
    textarea.dataset.editorReady = "true";
    textarea._pocketDocsEditor = record;
    editorInstances.push(record);

    if (form) {
      form.addEventListener("submit", function () {
        textarea.value = editor.value();
      });
    }

    editor.codemirror.addKeyMap({
      "Ctrl-S": function () {
        submitEditorForm(record);
      },
      "Cmd-S": function () {
        submitEditorForm(record);
      },
    });

    refreshEditorLayout(editor);
  }

  function initEditors(root) {
    var scope = root && root.querySelectorAll ? root : document;
    initContentItemCreators(scope);
    initPageIcon(scope);
    scope.querySelectorAll("textarea#content").forEach(initEditor);
  }

  function destroyEditors(root) {
    var scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll("textarea[data-editor-ready='true']").forEach(function (textarea) {
      var record = textarea._pocketDocsEditor;
      if (!record) return;

      textarea.value = record.editor.value();
      if (typeof record.editor.toTextArea === "function") {
        record.editor.toTextArea();
      }
      editorInstances = editorInstances.filter(function (item) {
        return item !== record;
      });
      delete textarea._pocketDocsEditor;
      delete textarea.dataset.editorReady;
    });
  }

  window.PocketDocs = window.PocketDocs || {};
  window.PocketDocs.initEditors = initEditors;
  window.PocketDocs.destroyEditors = destroyEditors;

  document.addEventListener(
    "keydown",
    function (event) {
      var isSaveCombo = (event.ctrlKey || event.metaKey) && (event.key === "s" || event.key === "S" || event.code === "KeyS");
      if (!isSaveCombo) return;

      var activeRecord = editorInstances.find(function (record) {
        return record.editor.codemirror && record.editor.codemirror.hasFocus();
      });
      if (!activeRecord) return;

      event.preventDefault();
      event.stopPropagation();
      submitEditorForm(activeRecord);
    },
    true,
  );

  window.addEventListener("resize", function () {
    editorInstances.forEach(function (record) {
      refreshEditorLayout(record.editor);
    });
  });

  document.addEventListener("fullscreenchange", function () {
    editorInstances.forEach(function (record) {
      refreshEditorLayout(record.editor);
    });
  });

  initEditors(document);
})();
