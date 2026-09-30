(function () {
  var container = document.querySelector("[data-load-more-container]");
  var button = container ? container.querySelector("[data-load-more]") : null;
  var list = document.querySelector("[data-load-more-list]");
  if (!container || !button || !list) return;

  var loading = false;
  var idleLabel = button.textContent;

  function setLoading(value) {
    loading = value;
    button.setAttribute("aria-busy", value ? "true" : "false");
    button.textContent = value ? "Loading..." : idleLabel;
  }

  function loadedItemIds() {
    return new Set(
      Array.from(list.querySelectorAll("[data-load-more-item]")).map(function (item) {
        return item.getAttribute("data-load-more-item");
      }),
    );
  }

  button.addEventListener("click", function (event) {
    if (event.defaultPrevented || loading) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    setLoading(true);

    fetch(button.href, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Failed to load more items");
        return response.text();
      })
      .then(function (html) {
        var parsed = new DOMParser().parseFromString(html, "text/html");
        var nextList = parsed.querySelector("[data-load-more-list]");
        if (!nextList) throw new Error("Missing list in response");

        var knownIds = loadedItemIds();
        var appendedItems = [];

        Array.from(nextList.querySelectorAll(":scope > [data-load-more-item]")).forEach(function (item) {
          var itemId = item.getAttribute("data-load-more-item");
          if (knownIds.has(itemId)) return;
          knownIds.add(itemId);
          appendedItems.push(item);
          list.appendChild(item);
        });

        var nextButton = parsed.querySelector("[data-load-more]");
        if (nextButton) {
          button.setAttribute("href", nextButton.getAttribute("href"));
          setLoading(false);
        } else {
          container.remove();
        }

        document.dispatchEvent(
          new CustomEvent("pocketdocs:items-loaded", {
            detail: { items: appendedItems },
          }),
        );
      })
      .catch(function () {
        setLoading(false);
        if (typeof window.showToast === "function") {
          window.showToast("Could not load more items. Please try again.", "error");
        }
      });
  });
})();
