(function () {
  var input = document.getElementById("docsSearch");
  var resultsContainer = document.getElementById("searchResults");
  if (!input || !resultsContainer) return;

  var projectSlug = input.dataset.project;
  var versionId = input.dataset.version;
  var debounceTimer = null;
  var requestId = 0;
  var activeController = null;

  function setExpanded(expanded) {
    resultsContainer.classList.toggle("active", expanded);
    resultsContainer.hidden = !expanded;
  }

  function closeResults() {
    setExpanded(false);
  }

  function renderStatus(message) {
    resultsContainer.innerHTML = '<div class="search-results-status" role="status">' + escapeHtml(message) + "</div>";
    setExpanded(true);
  }

  function getResultLinks() {
    return Array.prototype.slice.call(resultsContainer.querySelectorAll(".search-results-item"));
  }

  input.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    if (activeController) activeController.abort();

    var query = input.value.trim();
    if (query.length < 2) {
      requestId += 1;
      resultsContainer.innerHTML = "";
      resultsContainer.setAttribute("aria-busy", "false");
      closeResults();
      return;
    }

    renderStatus(input.dataset.searching);
    resultsContainer.setAttribute("aria-busy", "true");
    debounceTimer = setTimeout(function () {
      fetchResults(query);
    }, 300);
  });

  input.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeResults();
      return;
    }

    if (event.key === "ArrowDown") {
      var firstResult = getResultLinks()[0];
      if (firstResult) {
        event.preventDefault();
        firstResult.focus();
      }
    }
  });

  resultsContainer.addEventListener("keydown", function (event) {
    var links = getResultLinks();
    var currentIndex = links.indexOf(document.activeElement);
    if (currentIndex === -1) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeResults();
      input.focus();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      var direction = event.key === "ArrowDown" ? 1 : -1;
      var nextIndex = (currentIndex + direction + links.length) % links.length;
      links[nextIndex].focus();
    }
  });

  document.addEventListener("click", function (event) {
    if (!input.contains(event.target) && !resultsContainer.contains(event.target)) {
      closeResults();
    }
  });

  function fetchResults(query) {
    requestId += 1;
    var currentRequestId = requestId;
    activeController = typeof AbortController === "function" ? new AbortController() : null;
    var url = "/api/search?project=" + encodeURIComponent(projectSlug) + "&version=" + encodeURIComponent(versionId) + "&q=" + encodeURIComponent(query);
    var options = activeController ? { signal: activeController.signal } : {};

    fetch(url, options)
      .then(function (res) {
        if (!res.ok) throw new Error("Search request failed");
        return res.json();
      })
      .then(function (data) {
        if (currentRequestId !== requestId || input.value.trim() !== query) return;

        if (!data.results || data.results.length === 0) {
          renderStatus(input.dataset.noResults);
          return;
        }

        resultsContainer.innerHTML = data.results
          .map(function (result) {
            var safeTitle = escapeHtml(result.title);
            var safeSlug = escapeHtml(result.slug);
            var safeMeta = result.sectionLabel ? escapeHtml(result.sectionLabel) + " / " + safeSlug : "/" + safeSlug;
            var fallbackHref = result.simpleMode ? "/docs/" + encodeURIComponent(projectSlug) + "/" + encodeURIComponent(result.slug) : "/docs/" + encodeURIComponent(projectSlug) + "/" + encodeURIComponent(result.versionSlug || "") + "/" + encodeURIComponent(result.slug);
            var href = typeof result.href === "string" && result.href.charAt(0) === "/" ? result.href : fallbackHref;
            return '<a href="' + escapeHtml(href) + '" class="search-results-item"><strong dir="auto">' + safeTitle + '</strong><span dir="auto">' + safeMeta + "</span></a>";
          })
          .join("");
        setExpanded(true);
      })
      .catch(function (error) {
        if ((error && error.name === "AbortError") || currentRequestId !== requestId) return;
        renderStatus(input.dataset.unavailable);
      })
      .finally(function () {
        if (currentRequestId === requestId) {
          resultsContainer.setAttribute("aria-busy", "false");
        }
      });
  }

  function escapeHtml(value) {
    var div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  }
})();
