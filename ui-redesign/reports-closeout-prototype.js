(() => {
  "use strict";

  const body = document.body;
  const menuButton = document.querySelector("#menu-button");
  const sidebar = document.querySelector("#prototype-sidebar");
  const navBackdrop = document.querySelector("#nav-backdrop");
  const modalBackdrop = document.querySelector("#prototype-modal");
  const modalDialog = modalBackdrop?.querySelector("[role='dialog']");
  const modalTitle = document.querySelector("#modal-title");
  const modalDescription = document.querySelector("#modal-description");
  const modalClose = document.querySelector("#modal-close");
  const modalConfirm = document.querySelector("#modal-confirm");
  const serviceDate = document.querySelector("#service-date");
  const reportViewButtons = [...document.querySelectorAll("[data-report-view]")];
  const reportSections = [...document.querySelectorAll("[data-report-section]")];
  const reportViewStatus = document.querySelector("#report-view-status");
  const desktopNavigation = window.matchMedia("(min-width: 1101px)");
  let lastFocusedElement = null;

  const focusableSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(",");

  const syncBodyOverlayState = () => {
    const menuOpen = sidebar?.classList.contains("is-open");
    const modalOpen = modalBackdrop && !modalBackdrop.hidden;
    body.classList.toggle("has-open-overlay", Boolean(menuOpen || modalOpen));
  };

  const setMenuOpen = (open, restoreFocus = false) => {
    if (!menuButton || !sidebar || !navBackdrop) return;

    sidebar.classList.toggle("is-open", open);
    sidebar.toggleAttribute("inert", !open && !desktopNavigation.matches);
    navBackdrop.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
    menuButton.setAttribute("title", open ? "Close navigation menu" : "Open navigation menu");
    const menuSymbol = menuButton.querySelector("span");
    if (menuSymbol) menuSymbol.textContent = open ? "\u00d7" : "\u2630";
    syncBodyOverlayState();

    if (restoreFocus) menuButton.focus();
  };

  const openModal = (trigger, title, message) => {
    if (!modalBackdrop || !modalTitle || !modalDescription || !modalClose) return;

    lastFocusedElement = trigger instanceof HTMLElement ? trigger : document.activeElement;
    modalTitle.textContent = title || "Visual prototype only";
    modalDescription.textContent = message || "This is a visual prototype. No operational data was changed.";
    modalBackdrop.hidden = false;
    syncBodyOverlayState();
    window.requestAnimationFrame(() => modalClose.focus());
  };

  const closeModal = () => {
    if (!modalBackdrop || modalBackdrop.hidden) return;

    modalBackdrop.hidden = true;
    syncBodyOverlayState();
    if (lastFocusedElement instanceof HTMLElement && document.contains(lastFocusedElement)) {
      lastFocusedElement.focus();
    }
    lastFocusedElement = null;
  };

  const containModalFocus = (event) => {
    if (!modalDialog || modalBackdrop?.hidden || event.key !== "Tab") return;

    const focusableElements = [...modalDialog.querySelectorAll(focusableSelector)]
      .filter((element) => element instanceof HTMLElement && element.offsetParent !== null);

    if (!focusableElements.length) {
      event.preventDefault();
      modalDialog.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  menuButton?.addEventListener("click", () => {
    const isOpen = sidebar?.classList.contains("is-open");
    setMenuOpen(!isOpen);
  });

  document.querySelectorAll(".sidebar a").forEach((link) => {
    link.addEventListener("click", () => setMenuOpen(false));
  });

  navBackdrop?.addEventListener("mousedown", () => setMenuOpen(false, true));

  document.querySelectorAll("[data-prototype-nav]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setMenuOpen(false);
      const label = link.textContent.trim();
      openModal(
        desktopNavigation.matches ? link : menuButton,
        `${label} navigation preview`,
        `${label} is shown only to demonstrate the future application shell. This standalone prototype does not navigate to operational pages.`
      );
    });
  });

  document.querySelectorAll("[data-modal-title]").forEach((button) => {
    button.addEventListener("click", () => {
      openModal(button, button.dataset.modalTitle, button.dataset.modalMessage);
    });
  });

  modalClose?.addEventListener("click", closeModal);
  modalConfirm?.addEventListener("click", closeModal);

  modalBackdrop?.addEventListener("mousedown", (event) => {
    if (event.target === modalBackdrop) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalBackdrop && !modalBackdrop.hidden) {
      event.preventDefault();
      closeModal();
      return;
    }

    if (event.key === "Escape" && sidebar?.classList.contains("is-open")) {
      event.preventDefault();
      setMenuOpen(false, true);
      return;
    }

    containModalFocus(event);
  });

  desktopNavigation.addEventListener("change", () => setMenuOpen(false));

  reportViewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const selectedView = button.dataset.reportView;

      reportViewButtons.forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });

      reportSections.forEach((section) => {
        const visibleInView = selectedView === "full" || section.dataset.views.split(" ").includes(selectedView);
        section.classList.toggle("is-filtered-out", !visibleInView);
      });

      if (reportViewStatus) {
        reportViewStatus.textContent = `${button.textContent.trim()} view selected. Fictional sample sections updated.`;
      }
    });
  });

  serviceDate?.addEventListener("change", () => {
    document.querySelectorAll("[data-service-date-output]").forEach((output) => {
      output.textContent = serviceDate.value;
    });

    const compactDate = serviceDate.selectedOptions[0]?.dataset.compact || serviceDate.value;
    document.querySelectorAll("[data-service-date-compact]").forEach((output) => {
      output.textContent = `${compactDate} \u00b7 Service review`;
    });
  });

  setMenuOpen(false);
})();
