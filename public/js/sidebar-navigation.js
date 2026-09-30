(function () {
  var dialog = document.querySelector("[data-sidebar-header-dialog]");
  if (!dialog) return;

  var form = dialog.querySelector("[data-sidebar-header-edit-form]");
  var titleInput = dialog.querySelector("[data-sidebar-header-title]");
  var collapsedSelect = dialog.querySelector("[data-sidebar-header-collapsed]");
  if (!form || !titleInput || !collapsedSelect) return;

  document.addEventListener("click", function (event) {
    var button = event.target.closest ? event.target.closest("[data-sidebar-header-edit]") : null;
    if (!button) return;

    form.action = button.dataset.editUrl || "";
    titleInput.value = button.dataset.headerTitle || "";
    collapsedSelect.value = button.dataset.headerCollapsed;
    collapsedSelect.dispatchEvent(new Event("change", { bubbles: true }));
    window.requestAnimationFrame(function () {
      titleInput.focus();
      titleInput.select();
    });
  });
})();
