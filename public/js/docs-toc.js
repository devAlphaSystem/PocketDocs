(() => {
  const toc = document.querySelector(".docs-toc");
  const contentRoot = document.querySelector(".docs-content");

  if (!toc || !contentRoot) {
    return;
  }

  const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
  const byId = new Map(
    links
      .map((link) => {
        const id = decodeURIComponent(link.getAttribute("href").slice(1));
        return [id, link];
      })
      .filter(([id]) => Boolean(id)),
  );

  const headings = Array.from(contentRoot.querySelectorAll("h2[id], h3[id], h4[id]"));
  if (headings.length === 0) {
    return;
  }

  const setActive = (id) => {
    links.forEach((link) => {
      const isActive = link.getAttribute("href") === `#${id}`;
      link.classList.toggle("active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  };

  const scrollToHeading = (id, behavior = "smooth") => {
    const target = document.getElementById(id);
    if (!target) {
      return;
    }

    const offset = 88;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top, behavior: reduceMotion ? "auto" : behavior });
  };

  links.forEach((link) => {
    link.addEventListener("click", (event) => {
      const id = decodeURIComponent(link.getAttribute("href").slice(1));
      if (!id || !document.getElementById(id)) {
        return;
      }

      event.preventDefault();
      setActive(id);
      history.pushState(null, "", `#${encodeURIComponent(id)}`);
      scrollToHeading(id);
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

      if (visible.length > 0) {
        setActive(visible[0].target.id);
      }
    },
    {
      root: null,
      rootMargin: "-12% 0px -70% 0px",
      threshold: [0, 1],
    },
  );

  headings.forEach((heading) => observer.observe(heading));

  const initial = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (initial && byId.has(initial) && document.getElementById(initial)) {
    setActive(initial);
    window.requestAnimationFrame(() => scrollToHeading(initial, "auto"));
  } else if (headings[0]) {
    setActive(headings[0].id);
  }
})();
