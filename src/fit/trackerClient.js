/**
 * Applications Tracker — Client-side: search, inline editing, theme toggle.
 */
(function () {
  "use strict";

  var token = window.__TRACKER__ && window.__TRACKER__.token;
  if (!token) return;

  // ── Theme ──────────────────────────────────────────────────────────────

  var html = document.documentElement;
  var stored = localStorage.getItem("dashboard-theme");
  if (stored) html.setAttribute("data-theme", stored);

  var themeBtn = document.getElementById("theme-toggle");
  function updateThemeBtn() {
    themeBtn.textContent = html.getAttribute("data-theme") === "dark" ? "Light Mode" : "Dark Mode";
  }
  updateThemeBtn();

  themeBtn.addEventListener("click", function () {
    var next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", next);
    localStorage.setItem("dashboard-theme", next);
    updateThemeBtn();
  });

  // ── Search ─────────────────────────────────────────────────────────────

  var searchInput = document.getElementById("search");
  var rows = document.querySelectorAll("#app-tbody tr");

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      var q = this.value.toLowerCase().trim();
      rows.forEach(function (row) {
        var text = row.getAttribute("data-search") || "";
        row.style.display = text.indexOf(q) >= 0 ? "" : "none";
      });
    });
  }

  // ── Flash saved indicator ──────────────────────────────────────────────

  function flash(appId) {
    var el = document.getElementById("flash-" + appId);
    if (!el) return;
    el.classList.add("show");
    setTimeout(function () { el.classList.remove("show"); }, 1500);
  }

  // ── API helper ─────────────────────────────────────────────────────────

  function patchApp(appId, body) {
    return fetch("/tracker/api/applications/" + appId + "?token=" + token, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) flash(appId);
        return data;
      });
  }

  // ── Status change ──────────────────────────────────────────────────────

  document.querySelectorAll(".status-select").forEach(function (sel) {
    sel.addEventListener("change", function () {
      var appId = this.getAttribute("data-id");
      var newStatus = this.value;

      // Update class for color
      this.className = "status-select status-" + newStatus;

      patchApp(appId, { status: newStatus });
    });
  });

  // ── Referrer name (debounced save) ─────────────────────────────────────

  var debounceTimers = {};

  document.querySelectorAll(".ref-input").forEach(function (input) {
    input.addEventListener("input", function () {
      var appId = this.getAttribute("data-id");
      var value = this.value;

      if (debounceTimers[appId]) clearTimeout(debounceTimers[appId]);
      debounceTimers[appId] = setTimeout(function () {
        patchApp(appId, { referral_contact: value });
      }, 800);
    });
  });

  // ── Referral checkbox ──────────────────────────────────────────────────

  document.querySelectorAll(".ref-check").forEach(function (cb) {
    cb.addEventListener("change", function () {
      var appId = this.getAttribute("data-id");
      var row = this.closest("tr");
      var nameInput = row ? row.querySelector(".ref-input") : null;

      if (!this.checked && nameInput) {
        // Uncheck = clear referrer
        nameInput.value = "";
        patchApp(appId, { referral_contact: "" });
      }
    });
  });

})();
