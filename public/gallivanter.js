(() => {
  const dialog = document.querySelector("#signup-dialog");
  const form = document.querySelector("#signup-form");
  const success = document.querySelector("#signup-success");
  const platformSelect = document.querySelector("#signup-platform");

  if (!(dialog instanceof HTMLDialogElement) || !(form instanceof HTMLFormElement) || !(success instanceof HTMLElement) || !(platformSelect instanceof HTMLSelectElement)) {
    return;
  }

  const openSignup = (platform) => {
    if (platform === "mobile" || platform === "desktop" || platform === "both") {
      platformSelect.value = platform;
    }
    form.hidden = false;
    success.hidden = true;
    if (!dialog.open) dialog.showModal();
    window.setTimeout(() => document.querySelector("#signup-email")?.focus(), 40);
  };

  document.querySelectorAll("[data-open-signup]").forEach((trigger) => {
    trigger.addEventListener("click", () => {
      const platform = trigger instanceof HTMLElement ? trigger.dataset.platform : undefined;
      openSignup(platform);
    });
  });

  document.querySelectorAll("[data-close-signup]").forEach((trigger) => {
    trigger.addEventListener("click", () => dialog.close());
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener("close", () => {
    form.reset();
    platformSelect.value = "both";
    form.hidden = false;
    success.hidden = true;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    form.hidden = true;
    success.hidden = false;
    success.querySelector("button")?.focus();
  });
})();
