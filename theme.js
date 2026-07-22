(() => {
  const storageKey = "bp-theme";
  const darkStartHour = 19;
  const lightStartHour = 7;

  function storedPreference() {
    try {
      const value = localStorage.getItem(storageKey);
      return ["light", "dark"].includes(value) ? value : "auto";
    } catch {
      return "auto";
    }
  }

  function themeForTime(date = new Date()) {
    const hour = date.getHours();
    return hour >= darkStartHour || hour < lightStartHour ? "dark" : "light";
  }

  function applyTheme(preference = storedPreference()) {
    const theme = preference === "auto" ? themeForTime() : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.style.colorScheme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    themeColor?.setAttribute("content", theme === "dark" ? "#08142d" : "#1557d6");
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      const preferenceLabel = preference === "auto" ? "Auto" : theme[0].toUpperCase() + theme.slice(1);
      button.dataset.themeState = preference;
      button.title = `Theme: ${preferenceLabel}`;
      button.setAttribute("aria-label", `Theme is ${theme}. ${preference === "auto" ? "Automatic by local time." : "Manual setting."} Activate to change.`);
    });
    return theme;
  }

  function cycleTheme() {
    const current = storedPreference();
    const next = current === "auto" ? "light" : current === "light" ? "dark" : "auto";
    try {
      if (next === "auto") localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, next);
    } catch {
      // The time-based theme still works when storage is unavailable.
    }
    applyTheme(next);
  }

  window.BroadwayPixelsTheme = { applyTheme, cycleTheme, themeForTime };
  applyTheme();
  window.setInterval(() => {
    if (storedPreference() === "auto") applyTheme("auto");
  }, 60_000);
})();
