(function () {
  var tree = document.querySelector("[data-sortable-tree]") || document.getElementById("pagesTree");
  if (!tree) return;

  var projectId = tree.dataset.project;
  var versionId = tree.dataset.version;
  var csrfToken = tree.dataset.csrf;
  var reorderUrl = tree.dataset.reorderUrl || (projectId && versionId ? "/admin/projects/" + encodeURIComponent(projectId) + "/versions/" + encodeURIComponent(versionId) + "/pages/reorder" : "");
  var successMessage = tree.dataset.sortSuccess || "Pages reordered";
  var errorMessage = tree.dataset.sortError || "Failed to reorder pages";
  var boundarySnapDistance = 12;
  var dragState = null;
  var dragStartedFromControl = false;

  function getItems() {
    return Array.prototype.filter.call(tree.children, function (element) {
      return element.classList.contains("page-tree-item");
    });
  }

  function getItemMap(items) {
    var itemMap = new Map();
    items.forEach(function (item) {
      itemMap.set(item.dataset.id, item);
    });
    return itemMap;
  }

  function hasAncestorInSet(item, ancestorIds, itemMap) {
    var parentId = item.dataset.parent || "";
    var visited = new Set();

    while (parentId && !visited.has(parentId)) {
      if (ancestorIds.has(parentId)) return true;
      visited.add(parentId);
      var parent = itemMap.get(parentId);
      parentId = parent ? parent.dataset.parent || "" : "";
    }

    return false;
  }

  function getDragRoots(dragItem, items, itemMap) {
    var checkbox = dragItem.querySelector("[data-page-select]");
    var candidates =
      checkbox && checkbox.checked
        ? items.filter(function (item) {
            var itemCheckbox = item.querySelector("[data-page-select]");
            return itemCheckbox && itemCheckbox.checked;
          })
        : [dragItem];
    var candidateIds = new Set(
      candidates.map(function (item) {
        return item.dataset.id;
      }),
    );

    return candidates.filter(function (item) {
      return !hasAncestorInSet(item, candidateIds, itemMap);
    });
  }

  function getDraggedItems(roots, items, itemMap) {
    var rootIds = new Set(
      roots.map(function (item) {
        return item.dataset.id;
      }),
    );

    return items.filter(function (item) {
      return rootIds.has(item.dataset.id) || hasAncestorInSet(item, rootIds, itemMap);
    });
  }

  function isNavigationItem(item) {
    return item.classList.contains("sidebar-navigation-card");
  }

  function clearDropIndicators() {
    tree.classList.remove("drop-at-start", "drop-at-end");
    tree.querySelectorAll(".drop-before, .drop-into").forEach(function (item) {
      item.classList.remove("drop-before", "drop-into");
    });
  }

  function showDropIntent(intent) {
    clearDropIndicators();
    if (!intent) return;

    if (intent.marker === tree) {
      tree.classList.add(intent.markerClass);
      return;
    }

    intent.marker.classList.add(intent.markerClass);
  }

  function isBoundaryAllowed(reference, parentId) {
    if (reference && dragState.itemIds.has(reference.dataset.id)) return false;
    if (parentId && dragState.itemIds.has(parentId)) return false;
    if (parentId && dragState.roots.some(isNavigationItem)) return false;
    return true;
  }

  function boundaryIntent(items, clientY) {
    if (!items.length) return null;

    var boundaries = [];
    var firstRect = items[0].getBoundingClientRect();
    boundaries.push({
      position: firstRect.top,
      reference: items[0],
      parent: "",
      marker: tree,
      markerClass: "drop-at-start",
    });

    for (var index = 1; index < items.length; index += 1) {
      var previousRect = items[index - 1].getBoundingClientRect();
      var currentRect = items[index].getBoundingClientRect();
      boundaries.push({
        position: (previousRect.bottom + currentRect.top) / 2,
        reference: items[index],
        parent: items[index].dataset.parent || "",
        marker: items[index],
        markerClass: "drop-before",
      });
    }

    var lastRect = items[items.length - 1].getBoundingClientRect();
    boundaries.push({
      position: lastRect.bottom,
      reference: null,
      parent: "",
      marker: tree,
      markerClass: "drop-at-end",
    });

    var closest = boundaries.reduce(function (result, boundary) {
      var distance = Math.abs(clientY - boundary.position);
      if (!result || distance < result.distance) {
        return { boundary: boundary, distance: distance };
      }
      return result;
    }, null);

    if (!closest || closest.distance > boundarySnapDistance) return null;
    if (!isBoundaryAllowed(closest.boundary.reference, closest.boundary.parent)) return null;

    return {
      type: "before",
      reference: closest.boundary.reference,
      parent: closest.boundary.parent,
      marker: closest.boundary.marker,
      markerClass: closest.boundary.markerClass,
    };
  }

  function childIntent(items, clientX, clientY) {
    var target = items.find(function (item) {
      var rect = item.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY > rect.top && clientY < rect.bottom;
    });

    if (!target || dragState.itemIds.has(target.dataset.id)) return null;
    if (isNavigationItem(target) || dragState.roots.some(isNavigationItem)) return null;

    return {
      type: "child",
      target: target,
      parent: target.dataset.id,
      marker: target,
      markerClass: "drop-into",
    };
  }

  function resolveDropIntent(clientX, clientY) {
    if (!dragState) return null;
    var items = getItems();
    return boundaryIntent(items, clientY) || childIntent(items, clientX, clientY);
  }

  function isDescendantOf(item, parentId, itemMap) {
    return hasAncestorInSet(item, new Set([parentId]), itemMap);
  }

  function getLastDescendant(target) {
    var items = getItems();
    var itemMap = getItemMap(items);
    var targetIndex = items.indexOf(target);
    var lastDescendant = target;

    for (var index = targetIndex + 1; index < items.length; index += 1) {
      if (!isDescendantOf(items[index], target.dataset.id, itemMap)) break;
      lastDescendant = items[index];
    }

    return lastDescendant;
  }

  function updateDepths() {
    var items = getItems();
    var itemMap = getItemMap(items);

    items.forEach(function (item) {
      var depth = 0;
      var parentId = item.dataset.parent || "";
      var visited = new Set([item.dataset.id]);

      while (parentId && itemMap.has(parentId) && !visited.has(parentId)) {
        visited.add(parentId);
        depth += 1;
        parentId = itemMap.get(parentId).dataset.parent || "";
      }

      item.style.setProperty("--depth", depth);
    });
  }

  function applyDrop(intent) {
    var fragment = document.createDocumentFragment();
    dragState.items.forEach(function (item) {
      fragment.appendChild(item);
    });
    dragState.roots.forEach(function (item) {
      item.dataset.parent = intent.parent;
    });

    if (intent.type === "child") {
      var lastDescendant = getLastDescendant(intent.target);
      tree.insertBefore(fragment, lastDescendant.nextElementSibling);
    } else if (intent.reference) {
      tree.insertBefore(fragment, intent.reference);
    } else {
      tree.appendChild(fragment);
    }

    updateDepths();
  }

  function serializeItems() {
    return getItems().map(function (item, index) {
      item.dataset.order = index;
      return { id: item.dataset.id, order: index, parent: item.dataset.parent || "" };
    });
  }

  function persistOrder(pages) {
    if (!reorderUrl) return;

    fetch(reorderUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({ pages: pages }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Reorder failed");
        if (typeof window.showToast === "function") {
          window.showToast(successMessage, "success");
        }
      })
      .catch(function () {
        if (typeof window.showToast === "function") {
          window.showToast(errorMessage, "error");
        }
        window.location.reload();
      });
  }

  function finishDrag() {
    if (dragState) {
      dragState.items.forEach(function (item) {
        item.classList.remove("dragging");
      });
    }
    dragState = null;
    dragStartedFromControl = false;
    clearDropIndicators();
  }

  tree.addEventListener("pointerdown", function (e) {
    dragStartedFromControl = Boolean(e.target.closest("a, button, input, select, textarea, label, form"));
  });

  tree.addEventListener("dragstart", function (e) {
    var dragItem = e.target.closest(".page-tree-item");
    if (!dragItem || dragStartedFromControl) {
      e.preventDefault();
      dragStartedFromControl = false;
      return;
    }

    var items = getItems();
    var itemMap = getItemMap(items);
    var roots = getDragRoots(dragItem, items, itemMap);
    var draggedItems = getDraggedItems(roots, items, itemMap);
    dragState = {
      roots: roots,
      items: draggedItems,
      itemIds: new Set(
        draggedItems.map(function (item) {
          return item.dataset.id;
        }),
      ),
    };

    draggedItems.forEach(function (item) {
      item.classList.add("dragging");
    });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      "text/plain",
      roots
        .map(function (item) {
          return item.dataset.id;
        })
        .join(","),
    );
  });

  tree.addEventListener("dragend", finishDrag);

  tree.addEventListener("dragover", function (e) {
    var intent = resolveDropIntent(e.clientX, e.clientY);
    showDropIntent(intent);

    if (!intent) {
      e.dataTransfer.dropEffect = "none";
      return;
    }

    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });

  tree.addEventListener("dragleave", function (e) {
    if (!e.relatedTarget || !tree.contains(e.relatedTarget)) {
      showDropIntent(null);
    }
  });

  tree.addEventListener("drop", function (e) {
    var intent = resolveDropIntent(e.clientX, e.clientY);
    if (!intent || !dragState) return;

    e.preventDefault();
    applyDrop(intent);
    var pages = serializeItems();
    finishDrag();
    persistOrder(pages);
  });
})();
