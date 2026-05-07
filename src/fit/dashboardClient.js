/**
 * Dashboard client — Chart.js bindings, animations, theme toggle.
 * Reads window.__DASHBOARD_DATA__ and initializes all charts.
 */
(function () {
  "use strict";

  var data = window.__DASHBOARD_DATA__;
  if (!data) return;

  // ── Theme management ───────────────────────────────────────────────────

  var html = document.documentElement;
  var stored = localStorage.getItem("dashboard-theme");
  if (stored) html.setAttribute("data-theme", stored);

  var themeBtn = document.getElementById("theme-toggle");
  function updateThemeBtn() {
    var isDark = html.getAttribute("data-theme") === "dark";
    themeBtn.textContent = isDark ? "Light Mode" : "Dark Mode";
  }
  updateThemeBtn();

  themeBtn.addEventListener("click", function () {
    var isDark = html.getAttribute("data-theme") === "dark";
    var next = isDark ? "light" : "dark";
    html.setAttribute("data-theme", next);
    localStorage.setItem("dashboard-theme", next);
    updateThemeBtn();
    // Rebuild all charts with new theme colors
    rebuildAllCharts();
  });

  function isDark() {
    return html.getAttribute("data-theme") === "dark";
  }

  function themeColors() {
    return {
      grid: isDark() ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)",
      text: isDark() ? "#94a3b8" : "#64748b",
      tooltipBg: isDark() ? "#1e293b" : "#ffffff",
      tooltipText: isDark() ? "#f1f5f9" : "#0f172a",
      tooltipBorder: isDark() ? "#334155" : "#e2e8f0",
    };
  }

  // ── Color palettes ─────────────────────────────────────────────────────

  var VIBRANT = [
    "#00b0ff", "#00e676", "#ffab00", "#ff4081", "#7c4dff",
    "#00e5ff", "#ff6d00", "#76ff03", "#e040fb", "#18ffff",
    "#651fff", "#ff1744", "#00c853",
  ];

  var FUNNEL_COLORS = {
    "Not Started": "#546e7a",
    "Researching": "#00b0ff",
    "Applied": "#00e5ff",
    "Interviewing": "#ffab00",
    "Offer": "#00e676",
    "Rejected": "#ff4081",
    "Withdrawn": "#78909c",
  };

  var TREEMAP_COLORS = {
    "Technical": "#00b0ff",
    "Tools": "#00e5ff",
    "Methodologies": "#ffab00",
    "Soft Skills": "#ff4081",
    "Domain": "#00e676",
    "Certifications": "#7c4dff",
    "Other": "#546e7a",
  };

  var WORK_COLORS = { "Remote": "#00e676", "Hybrid": "#00b0ff", "Onsite": "#ffab00" };
  var LIFECYCLE_COLORS = { "Active": "#00e676", "Closed": "#546e7a" };

  // ── Helpers ────────────────────────────────────────────────────────────

  function truncate(t, n) { return t && t.length > n ? t.substring(0, n) + "..." : t || ""; }
  function fmtWeek(iso) { if (!iso) return ""; var p = iso.split("-"); return p[1] + "/" + p[2]; }
  function fmtHour(h) { if (h === 0) return "12 AM"; if (h === 12) return "12 PM"; return h < 12 ? h + " AM" : (h - 12) + " PM"; }
  function getCtx(id) { var el = document.getElementById(id); return el ? el.getContext("2d") : null; }

  function makeGradient(ctx, c1, c2) {
    var g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    return g;
  }

  function baseTooltip() {
    var t = themeColors();
    return {
      backgroundColor: t.tooltipBg,
      titleColor: t.tooltipText,
      bodyColor: t.tooltipText,
      borderColor: t.tooltipBorder,
      borderWidth: 1,
      cornerRadius: 8,
      padding: 10,
      titleFont: { weight: "bold" },
    };
  }

  function baseScales(opts) {
    var t = themeColors();
    var s = {};
    if (opts && opts.x !== false) {
      s.x = Object.assign({ grid: { color: t.grid }, ticks: { color: t.text, font: { size: 11 } } }, opts.x || {});
    }
    if (opts && opts.y !== false) {
      s.y = Object.assign({ grid: { color: t.grid }, ticks: { color: t.text, font: { size: 11 } } }, opts.y || {});
    }
    return s;
  }

  // ── Chart.js global defaults ───────────────────────────────────────────

  Chart.defaults.animation.duration = 1200;
  Chart.defaults.animation.easing = "easeOutQuart";
  Chart.defaults.plugins.legend.labels.color = themeColors().text;

  // ── Count-up animation for KPIs ────────────────────────────────────────

  var kpiEls = document.querySelectorAll("[data-countup]");
  function animateCountUp() {
    kpiEls.forEach(function (el) {
      var target = parseFloat(el.getAttribute("data-countup"));
      var isPercent = el.textContent.indexOf("%") > -1;
      var isFloat = String(target).indexOf(".") > -1;
      var start = 0;
      var duration = 1200;
      var startTime = null;

      function step(ts) {
        if (!startTime) startTime = ts;
        var progress = Math.min((ts - startTime) / duration, 1);
        var eased = 1 - Math.pow(1 - progress, 3);
        var current = start + (target - start) * eased;

        if (isFloat) {
          el.textContent = current.toFixed(1) + (isPercent ? "%" : "");
        } else {
          el.textContent = Math.round(current).toLocaleString() + (isPercent ? "%" : "");
        }
        if (progress < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }

  // ── Scroll fade-in (IntersectionObserver) ──────────────────────────────

  var sections = document.querySelectorAll(".dashboard-section");
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add("visible");
        observer.unobserve(e.target);
      }
    });
  }, { threshold: 0.1 });

  sections.forEach(function (s) { observer.observe(s); });

  // Make first section visible immediately
  if (sections.length) sections[0].classList.add("visible");

  // Start count-up after a brief delay
  setTimeout(animateCountUp, 300);

  // ── Chart instances (for theme rebuild) ────────────────────────────────

  var charts = {};

  function destroyAll() {
    Object.keys(charts).forEach(function (k) {
      if (charts[k]) { charts[k].destroy(); charts[k] = null; }
    });
  }

  function rebuildAllCharts() {
    destroyAll();
    Chart.defaults.plugins.legend.labels.color = themeColors().text;
    buildAllCharts();
  }

  function buildAllCharts() {
    buildFunnel();
    buildAppsOverTime();
    buildAppliedVsDiscovered();
    buildActiveClosed();
    buildTopSkills();
    buildSkillsGap();
    buildReusedBullets();
    buildLocation();
    buildWorkType();
    buildCompanyCategories();
    buildAtsPlatforms();
    buildTopCompanies();
    buildCompanyCoverage();
    buildAppliedCompanies();
    buildTimeToApply();
    buildFreshness();
    buildAppsByHour();
    buildAppsByDay();
    buildWeeklyHeatmap();
    buildAppsPerDay();
    buildDiscoveryHours();
    buildFitVsOutcome();
    buildRejectionByCat();
    buildYoeMismatch();
    buildHotCompanies();
    buildResponseRate();
    buildDaysPerStage();
    buildLifespan();
    buildSalary();
    buildReposted();
    buildFitTrend();
    buildQualityTrend();
    buildGapTrend();
    buildNewPerWeek();
    buildVelocity();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Chart builders
  // ══════════════════════════════════════════════════════════════════════

  function buildFunnel() {
    var ctx = getCtx("chart-funnel");
    if (!ctx || !data.statusCounts.length) return;
    charts.funnel = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.statusCounts.map(function (s) { return s.label; }),
        datasets: [{
          data: data.statusCounts.map(function (s) { return s.count; }),
          backgroundColor: data.statusCounts.map(function (s) { return FUNNEL_COLORS[s.label] || "#00d4ff"; }),
          borderRadius: 6, barThickness: 28,
        }],
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false } } }),
      },
    });
  }

  function buildAppsOverTime() {
    var ctx = getCtx("chart-apps-over-time");
    if (!ctx || !data.applicationsPerWeek.length) return;
    var grad = makeGradient(ctx, "rgba(13, 148, 136, 0.25)", "rgba(13, 148, 136, 0.02)");
    charts.appsTime = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.applicationsPerWeek.map(function (d) { return fmtWeek(d.week); }),
        datasets: [{
          label: "Applications",
          data: data.applicationsPerWeek.map(function (d) { return d.count; }),
          fill: true, backgroundColor: grad,
          borderColor: "#00d4ff", borderWidth: 2.5, tension: 0.4,
          pointRadius: 4, pointBackgroundColor: "#00d4ff", pointBorderColor: "#fff", pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }),
      },
    });
  }

  function buildAppliedVsDiscovered() {
    var ctx = getCtx("chart-applied-vs-discovered");
    if (!ctx || !data.appliedVsDiscoveredPerWeek.length) return;
    charts.avd = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.appliedVsDiscoveredPerWeek.map(function (d) { return fmtWeek(d.week); }),
        datasets: [
          { label: "Discovered", data: data.appliedVsDiscoveredPerWeek.map(function (d) { return d.discovered; }), backgroundColor: "rgba(14, 165, 233, 0.3)", borderColor: "#00b0ff", borderWidth: 1, borderRadius: 3 },
          { label: "Applied", data: data.appliedVsDiscoveredPerWeek.map(function (d) { return d.applied; }), backgroundColor: "#00d4ff", borderRadius: 3 },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "top" }, tooltip: baseTooltip() },
        scales: baseScales({ x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } }),
      },
    });
  }

  function buildActiveClosed() {
    var ctx = getCtx("chart-active-closed");
    if (!ctx || !data.activeVsClosed.length) return;
    charts.lifecycle = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: data.activeVsClosed.map(function (d) { return d.label; }),
        datasets: [{
          data: data.activeVsClosed.map(function (d) { return d.count; }),
          backgroundColor: data.activeVsClosed.map(function (d) { return LIFECYCLE_COLORS[d.label] || "#64748b"; }),
          borderWidth: 3, borderColor: isDark() ? "#1e293b" : "#ffffff",
        }],
      },
      options: {
        responsive: true, cutout: "60%",
        plugins: {
          legend: { position: "bottom", labels: { padding: 16, font: { size: 12 } } },
          tooltip: baseTooltip(),
        },
      },
    });
  }

  function buildTopSkills() {
    var ctx = getCtx("chart-top-skills");
    if (!ctx || !data.topSkills.length) return;
    var colors = data.topSkills.map(function (_, i) {
      var ratio = i / data.topSkills.length;
      if (ratio < 0.33) return "#00b0ff";
      if (ratio < 0.66) return "#06b6d4";
      return "#14b8a6";
    });
    charts.skills = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.topSkills.map(function (s) { return s.skill; }),
        datasets: [{ data: data.topSkills.map(function (s) { return s.count; }), backgroundColor: colors, borderRadius: 4, barThickness: 16 }],
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ x: { beginAtZero: true }, y: { grid: { display: false } } }),
      },
    });
  }

  function buildSkillsGap() {
    var ctx = getCtx("chart-skills-gap");
    if (!ctx || !data.skillsGapTreemap.length) return;
    charts.gap = new Chart(ctx, {
      type: "treemap",
      data: {
        datasets: [{
          tree: data.skillsGapTreemap, key: "count",
          groups: ["category", "skill"],
          spacing: 2, borderWidth: 2,
          borderColor: isDark() ? "rgba(30,41,59,0.8)" : "rgba(255,255,255,0.8)",
          backgroundColor: function (c) {
            if (!c.raw || !c.raw._data) return "#334155";
            var cat = c.raw._data.category || c.raw._data.label || "Other";
            return TREEMAP_COLORS[cat] || "#64748b";
          },
          labels: {
            display: true, align: "center", position: "middle",
            color: "#fff", font: { size: 11, weight: "bold" },
            formatter: function (c) {
              if (!c.raw || !c.raw._data) return "";
              var d = c.raw._data;
              return d.skill ? d.skill + " (" + d.count + ")" : d.label || "";
            },
          },
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: function (items) { return items.length && items[0].raw._data ? items[0].raw._data.skill || items[0].raw._data.label || "" : ""; },
              label: function (item) {
                if (!item.raw._data) return "";
                var d = item.raw._data;
                var r = [];
                if (d.count) r.push("Frequency: " + d.count + " jobs");
                if (d.category) r.push("Category: " + d.category);
                return r;
              },
            },
          },
        },
      },
    });
  }

  function buildReusedBullets() {
    var ctx = getCtx("chart-reused-bullets");
    if (!ctx || !data.topReusedBullets.length) return;
    var fullTexts = data.topReusedBullets.map(function (b) { return b.text; });
    var colors = data.topReusedBullets.map(function (_, i) {
      return VIBRANT[i % VIBRANT.length];
    });
    charts.bullets = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.topReusedBullets.map(function (b) { return truncate(b.text, 60); }),
        datasets: [{ data: data.topReusedBullets.map(function (b) { return b.count; }), backgroundColor: colors, borderRadius: 4, barThickness: 20 }],
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, baseTooltip(), {
            callbacks: {
              title: function (items) { return items.length ? fullTexts[items[0].dataIndex] || "" : ""; },
              label: function (item) { return "Used " + item.raw + " time" + (item.raw === 1 ? "" : "s"); },
            },
          }),
        },
        scales: baseScales({ x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false } } }),
      },
    });
  }

  // Donuts
  function buildDonut(id, items, colorMap, key) {
    var ctx = getCtx(id);
    if (!ctx || !items.length) return;
    charts[key] = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: items.map(function (d) { return d.label; }),
        datasets: [{
          data: items.map(function (d) { return d.count; }),
          backgroundColor: items.map(function (d, i) { return (colorMap && colorMap[d.label]) || VIBRANT[i % VIBRANT.length]; }),
          borderWidth: 3, borderColor: isDark() ? "#1e293b" : "#ffffff",
        }],
      },
      options: {
        responsive: true, cutout: "55%",
        plugins: {
          legend: { position: "right", labels: { font: { size: 11 }, padding: 10, boxWidth: 12, color: themeColors().text } },
          tooltip: baseTooltip(),
        },
      },
    });
  }

  function buildLocation() { buildDonut("chart-location", data.locationCounts, null, "loc"); }
  function buildWorkType() { buildDonut("chart-work-type", data.workTypeCounts, WORK_COLORS, "work"); }
  function buildHBar(id, items, colors, key) {
    var ctx = getCtx(id);
    if (!ctx || !items.length) return;
    charts[key] = new Chart(ctx, {
      type: "bar",
      data: {
        labels: items.map(function (c) { return c.label; }),
        datasets: [{
          data: items.map(function (c) { return c.count; }),
          backgroundColor: items.map(function (_, i) { return (colors && colors[i]) || VIBRANT[i % VIBRANT.length]; }),
          borderRadius: 4, barThickness: 20,
        }],
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ x: { beginAtZero: true }, y: { grid: { display: false } } }),
      },
    });
  }

  function buildCompanyCategories() { buildHBar("chart-company-categories", data.companyCategoryCounts, null, "cats"); }
  function buildAtsPlatforms() { buildHBar("chart-ats-platforms", data.atsPlatformCounts, null, "ats"); }
  function buildTopCompanies() {
    var ctx = getCtx("chart-top-companies");
    if (!ctx || !data.topHiringCompanies.length) return;
    var grad = data.topHiringCompanies.map(function (_, i) {
      return VIBRANT[i % VIBRANT.length];
    });
    charts.companies = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.topHiringCompanies.map(function (c) { return c.label; }),
        datasets: [{
          data: data.topHiringCompanies.map(function (c) { return c.count; }),
          backgroundColor: grad, borderRadius: 6, barThickness: 32,
        }],
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ x: { beginAtZero: true }, y: { grid: { display: false } } }),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Section 4b: Company Coverage + Applied Companies
  // ══════════════════════════════════════════════════════════════════════

  function buildCompanyCoverage() {
    var ctx = getCtx("chart-company-coverage");
    if (!ctx || !data.companyCoverage.length) return;
    charts.coverage = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.companyCoverage.map(function (c) { return c.company; }),
        datasets: [
          { label: "Discovered", data: data.companyCoverage.map(function (c) { return c.discovered; }), backgroundColor: "rgba(14, 165, 233, 0.4)", borderColor: "#00b0ff", borderWidth: 1, borderRadius: 3 },
          { label: "Applied", data: data.companyCoverage.map(function (c) { return c.applied; }), backgroundColor: "#00e676", borderRadius: 3 },
        ],
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: { legend: { position: "top" }, tooltip: baseTooltip() },
        scales: baseScales({ x: { beginAtZero: true }, y: { grid: { display: false } } }),
      },
    });
  }

  function buildAppliedCompanies() {
    var ctx = getCtx("chart-applied-companies");
    if (!ctx || !data.appliedCompanies.length) return;
    charts.appliedCo = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.appliedCompanies.map(function (c) { return c.label; }),
        datasets: [{
          data: data.appliedCompanies.map(function (c) { return c.count; }),
          backgroundColor: data.appliedCompanies.map(function (_, i) { return VIBRANT[i % VIBRANT.length]; }),
          borderRadius: 6, barThickness: 28,
        }],
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false } } }),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Section 5: Application Timing
  // ══════════════════════════════════════════════════════════════════════

  function buildTimeToApply() {
    var ctx = getCtx("chart-time-to-apply");
    if (!ctx) return;
    var items = data.timeToApplyBuckets.filter(function (b) { return b.count > 0; });
    if (!items.length) return;
    var colors = ["#00e676", "#06b6d4", "#00b0ff", "#ffab00", "#ff6d00", "#ff4081", "#ef4444"];
    charts.tta = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.timeToApplyBuckets.map(function (b) { return b.label; }),
        datasets: [{
          data: data.timeToApplyBuckets.map(function (b) { return b.count; }),
          backgroundColor: colors.slice(0, data.timeToApplyBuckets.length),
          borderRadius: 6, barThickness: 32,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }),
      },
    });
  }

  function buildFreshness() {
    var ctx = getCtx("chart-freshness");
    if (!ctx) return;
    if (!data.freshnessAtApply.some(function (b) { return b.count > 0; })) return;
    charts.fresh = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: data.freshnessAtApply.map(function (b) { return b.label; }),
        datasets: [{
          data: data.freshnessAtApply.map(function (b) { return b.count; }),
          backgroundColor: ["#00e676", "#06b6d4", "#00b0ff", "#ffab00", "#ff6d00", "#ff4081"],
          borderWidth: 3, borderColor: isDark() ? "#1e293b" : "#ffffff",
        }],
      },
      options: {
        responsive: true, cutout: "55%",
        plugins: { legend: { position: "right", labels: { font: { size: 11 }, padding: 10, boxWidth: 12, color: themeColors().text } }, tooltip: baseTooltip() },
      },
    });
  }

  function buildAppsByHour() {
    var ctx = getCtx("chart-apps-by-hour");
    if (!ctx) return;
    if (!data.applicationsByHour.some(function (h) { return h.count > 0; })) return;
    var colors = data.applicationsByHour.map(function (h) {
      if (h.hour >= 9 && h.hour < 12) return "#00e676";   // morning
      if (h.hour >= 12 && h.hour < 17) return "#00b0ff";   // afternoon
      if (h.hour >= 17 && h.hour < 21) return "#ffab00";   // evening
      return "#64748b";                                      // night
    });
    charts.byHour = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.applicationsByHour.map(function (h) { return fmtHour(h.hour); }),
        datasets: [{
          data: data.applicationsByHour.map(function (h) { return h.count; }),
          backgroundColor: colors, borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }),
      },
    });
  }

  function buildAppsByDay() {
    var ctx = getCtx("chart-apps-by-day");
    if (!ctx) return;
    if (!data.applicationsByDayOfWeek.some(function (d) { return d.count > 0; })) return;
    var dayColors = ["#64748b", "#00b0ff", "#06b6d4", "#00d4ff", "#00e676", "#ffab00", "#64748b"];
    charts.byDay = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.applicationsByDayOfWeek.map(function (d) { return d.day.substring(0, 3); }),
        datasets: [{
          data: data.applicationsByDayOfWeek.map(function (d) { return d.count; }),
          backgroundColor: dayColors, borderRadius: 6, barThickness: 36,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }),
      },
    });
  }

  function buildWeeklyHeatmap() {
    var ctx = getCtx("chart-weekly-heatmap");
    if (!ctx || !data.appsByDayAndHour.length) return;

    // Build a 7×24 matrix for the bubble chart
    var dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var maxCount = 0;
    var grid = {};
    data.appsByDayAndHour.forEach(function (d) {
      var key = d.day + "|" + d.hour;
      grid[key] = d.count;
      if (d.count > maxCount) maxCount = d.count;
    });

    var points = [];
    dayLabels.forEach(function (dayShort, di) {
      var dayFull = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][di];
      for (var h = 6; h < 24; h++) {
        var key = dayFull + "|" + h;
        var count = grid[key] || 0;
        if (count > 0) {
          points.push({ x: h, y: di, r: Math.max(4, (count / Math.max(maxCount, 1)) * 20), count: count });
        }
      }
    });

    charts.heatmap = new Chart(ctx, {
      type: "bubble",
      data: {
        datasets: [{
          data: points,
          backgroundColor: function (ctx) {
            if (!ctx.raw) return "#00d4ff55";
            var ratio = ctx.raw.count / Math.max(maxCount, 1);
            if (ratio > 0.7) return "#00d4ff";
            if (ratio > 0.4) return "#14b8a6cc";
            return "#14b8a688";
          },
          borderColor: "#00d4ff",
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, baseTooltip(), {
            callbacks: {
              label: function (item) {
                var d = item.raw;
                var dayName = dayLabels[d.y];
                return dayName + " " + fmtHour(d.x) + ": " + d.count + " application" + (d.count === 1 ? "" : "s");
              },
            },
          }),
        },
        scales: {
          x: {
            min: 5.5, max: 23.5,
            ticks: { callback: function (v) { return fmtHour(v); }, color: themeColors().text, stepSize: 2 },
            grid: { color: themeColors().grid },
            title: { display: true, text: "Hour (PT)", color: themeColors().text },
          },
          y: {
            min: -0.5, max: 6.5, reverse: true,
            ticks: { callback: function (v) { return dayLabels[v] || ""; }, color: themeColors().text, stepSize: 1 },
            grid: { color: themeColors().grid },
          },
        },
      },
    });
  }

  function buildAppsPerDay() {
    var ctx = getCtx("chart-apps-per-day");
    if (!ctx || !data.applicationsPerDay.length) return;
    var grad = makeGradient(ctx, "rgba(139, 92, 246, 0.25)", "rgba(139, 92, 246, 0.02)");
    charts.perDay = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.applicationsPerDay.map(function (d) { var p = d.date.split("-"); return p[1] + "/" + p[2]; }),
        datasets: [{
          label: "Applications",
          data: data.applicationsPerDay.map(function (d) { return d.count; }),
          fill: true, backgroundColor: grad,
          borderColor: "#7c4dff", borderWidth: 2.5, tension: 0.4,
          pointRadius: 5, pointBackgroundColor: "#7c4dff", pointBorderColor: "#fff", pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }),
      },
    });
  }

  function buildDiscoveryHours() {
    var ctx = getCtx("chart-discovery-hours");
    if (!ctx) return;
    if (!data.discoveryByHour.some(function (h) { return h.count > 0; })) return;
    var grad = makeGradient(ctx, "rgba(132, 204, 22, 0.3)", "rgba(132, 204, 22, 0.02)");
    charts.discHour = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.discoveryByHour.map(function (h) { return fmtHour(h.hour); }),
        datasets: [{
          data: data.discoveryByHour.map(function (h) { return h.count; }),
          backgroundColor: "rgba(132, 204, 22, 0.6)", borderColor: "#76ff03", borderWidth: 1, borderRadius: 3,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ y: { beginAtZero: true }, x: { grid: { display: false } } }),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Section 6: Am I Wasting Time?
  // ══════════════════════════════════════════════════════════════════════

  function buildFitVsOutcome() {
    var ctx = getCtx("chart-fit-vs-outcome");
    if (!ctx || !data.fitScoreVsOutcome.length) return;
    var statusColors = {
      "applied": "#64748b", "researching": "#00b0ff",
      "interviewing": "#ffab00", "offer": "#00e676",
      "rejected": "#ff4081", "withdrawn": "#94a3b8",
      "not_started": "#334155",
    };
    var statusY = { "rejected": 1, "applied": 2, "researching": 3, "interviewing": 4, "offer": 5 };
    var datasets = {};
    data.fitScoreVsOutcome.forEach(function (d) {
      if (!datasets[d.status]) {
        datasets[d.status] = { label: d.status.charAt(0).toUpperCase() + d.status.slice(1), data: [], backgroundColor: statusColors[d.status] || "#64748b", pointRadius: 6 };
      }
      datasets[d.status].data.push({ x: d.score, y: statusY[d.status] || 2, title: d.title, company: d.company });
    });
    charts.fitOutcome = new Chart(ctx, {
      type: "scatter",
      data: { datasets: Object.values(datasets) },
      options: {
        responsive: true,
        plugins: {
          legend: { position: "top", labels: { color: themeColors().text } },
          tooltip: Object.assign({}, baseTooltip(), {
            callbacks: {
              label: function (item) {
                var d = item.raw;
                return [d.company + " — " + d.title, "Score: " + d.x];
              },
            },
          }),
        },
        scales: {
          x: { title: { display: true, text: "Fit Score", color: themeColors().text }, grid: { color: themeColors().grid }, ticks: { color: themeColors().text } },
          y: { title: { display: true, text: "Outcome", color: themeColors().text }, grid: { color: themeColors().grid },
            ticks: { color: themeColors().text, stepSize: 1, callback: function (v) { return ["", "Rejected", "Applied", "Researching", "Interviewing", "Offer"][v] || ""; } },
            min: 0.5, max: 5.5,
          },
        },
      },
    });
  }

  function buildRejectionByCat() {
    var ctx = getCtx("chart-rejection-by-cat");
    if (!ctx || !data.rejectionByCategory.length) return;
    charts.rejCat = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.rejectionByCategory.map(function (d) { return d.category; }),
        datasets: [
          { label: "Applied", data: data.rejectionByCategory.map(function (d) { return d.applied; }), backgroundColor: "rgba(14, 165, 233, 0.4)", borderColor: "#00b0ff", borderWidth: 1, borderRadius: 3 },
          { label: "Rejected", data: data.rejectionByCategory.map(function (d) { return d.rejected; }), backgroundColor: "#ff4081", borderRadius: 3 },
        ],
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: {
          legend: { position: "top" },
          tooltip: Object.assign({}, baseTooltip(), {
            callbacks: { afterBody: function (items) { var i = items[0].dataIndex; return "Rejection rate: " + data.rejectionByCategory[i].rate + "%"; } },
          }),
        },
        scales: baseScales({ x: { beginAtZero: true }, y: { grid: { display: false } } }),
      },
    });
  }

  function buildYoeMismatch() {
    var ctx = getCtx("chart-yoe-mismatch");
    if (!ctx) return;
    if (!data.yoeMismatch.some(function (y) { return y.applied > 0; })) return;
    charts.yoe = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.yoeMismatch.map(function (y) { return y.label; }),
        datasets: [
          { label: "Applied", data: data.yoeMismatch.map(function (y) { return y.applied; }), backgroundColor: "#00b0ff", borderRadius: 4 },
          { label: "Got Interview", data: data.yoeMismatch.map(function (y) { return y.interviewed; }), backgroundColor: "#00e676", borderRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: "top" }, tooltip: baseTooltip() },
        scales: baseScales({ y: { beginAtZero: true, ticks: { stepSize: 1 } }, x: { grid: { display: false } } }),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Section 7: What Should I Do Today? (hot companies chart)
  // ══════════════════════════════════════════════════════════════════════

  function buildHotCompanies() {
    var ctx = getCtx("chart-hot-companies");
    if (!ctx || !data.hotCompanies.length) return;
    charts.hot = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.hotCompanies.map(function (c) { return c.company; }),
        datasets: [{
          label: "New Roles (7d)",
          data: data.hotCompanies.map(function (c) { return c.newRoles; }),
          backgroundColor: data.hotCompanies.map(function (_, i) { return VIBRANT[i % VIBRANT.length]; }),
          borderRadius: 6, barThickness: 28,
        }],
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false } } }),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Section 8: Pipeline Mechanics
  // ══════════════════════════════════════════════════════════════════════

  function buildResponseRate() {
    var ctx = getCtx("chart-response-rate");
    if (!ctx || !data.responseRate.length) return;
    var colors = { "Responded": "#00e676", "No Response": "#ff4081" };
    charts.response = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: data.responseRate.map(function (d) { return d.label; }),
        datasets: [{
          data: data.responseRate.map(function (d) { return d.count; }),
          backgroundColor: data.responseRate.map(function (d) { return colors[d.label] || "#64748b"; }),
          borderWidth: 3, borderColor: isDark() ? "#1e293b" : "#ffffff",
        }],
      },
      options: {
        responsive: true, cutout: "60%",
        plugins: { legend: { position: "bottom", labels: { padding: 16, color: themeColors().text } }, tooltip: baseTooltip() },
      },
    });
  }

  function buildDaysPerStage() {
    var ctx = getCtx("chart-days-per-stage");
    if (!ctx || !data.avgDaysPerStage.length) return;
    charts.daysStage = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.avgDaysPerStage.map(function (d) { return d.stage; }),
        datasets: [{
          data: data.avgDaysPerStage.map(function (d) { return d.avgDays; }),
          backgroundColor: ["#7c4dff", "#00b0ff", "#00e676", "#ff4081"],
          borderRadius: 6, barThickness: 36,
        }],
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, baseTooltip(), {
            callbacks: { label: function (item) { return item.raw + " days average"; } },
          }),
        },
        scales: baseScales({ x: { beginAtZero: true, title: { display: true, text: "Days", color: themeColors().text } }, y: { grid: { display: false } } }),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Section 9: Competition
  // ══════════════════════════════════════════════════════════════════════

  function buildLifespan() {
    var ctx = getCtx("chart-lifespan");
    if (!ctx) return;
    if (!data.listingLifespanBuckets.some(function (b) { return b.count > 0; })) return;
    var colors = ["#00e676", "#06b6d4", "#00b0ff", "#ffab00", "#ff6d00", "#ff4081", "#ef4444"];
    charts.lifespan = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.listingLifespanBuckets.map(function (b) { return b.label; }),
        datasets: [{
          data: data.listingLifespanBuckets.map(function (b) { return b.count; }),
          backgroundColor: colors, borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ y: { beginAtZero: true }, x: { grid: { display: false } } }),
      },
    });
  }

  function buildSalary() {
    var ctx = getCtx("chart-salary");
    if (!ctx) return;
    if (!data.salaryBuckets.some(function (b) { return b.count > 0; })) return;
    var grad = makeGradient(ctx, "rgba(16, 185, 129, 0.4)", "rgba(16, 185, 129, 0.05)");
    charts.salary = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.salaryBuckets.map(function (b) { return b.label; }),
        datasets: [{
          data: data.salaryBuckets.map(function (b) { return b.count; }),
          backgroundColor: "#00e676", borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ y: { beginAtZero: true }, x: { grid: { display: false } } }),
      },
    });
  }

  function buildReposted() {
    var ctx = getCtx("chart-reposted");
    if (!ctx || !data.repostedList.length) return;
    charts.repost = new Chart(ctx, {
      type: "bar",
      data: {
        labels: data.repostedList.map(function (r) { return r.company + " — " + truncate(r.title, 30); }),
        datasets: [{
          label: "Times Reposted",
          data: data.repostedList.map(function (r) { return r.times; }),
          backgroundColor: "#ff6d00", borderRadius: 6, barThickness: 24,
        }],
      },
      options: {
        indexAxis: "y", responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ x: { beginAtZero: true, ticks: { stepSize: 1 } }, y: { grid: { display: false } } }),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Section 10: Am I Getting Better?
  // ══════════════════════════════════════════════════════════════════════

  function buildFitTrend() {
    var ctx = getCtx("chart-fit-trend");
    if (!ctx || !data.weeklyFitScoreTrend.length) return;
    var grad = makeGradient(ctx, "rgba(13, 148, 136, 0.25)", "rgba(13, 148, 136, 0.02)");
    charts.fitTrend = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.weeklyFitScoreTrend.map(function (d) { return fmtWeek(d.week); }),
        datasets: [{
          label: "Avg Fit Score",
          data: data.weeklyFitScoreTrend.map(function (d) { return d.avgScore; }),
          fill: true, backgroundColor: grad,
          borderColor: "#00d4ff", borderWidth: 2.5, tension: 0.4,
          pointRadius: 5, pointBackgroundColor: "#00d4ff", pointBorderColor: "#fff", pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: Object.assign({}, baseTooltip(), {
            callbacks: { afterLabel: function (item) { var d = data.weeklyFitScoreTrend[item.dataIndex]; return d.count + " jobs scored"; } },
          }),
        },
        scales: baseScales({ y: { suggestedMin: 0, title: { display: true, text: "Fit Score", color: themeColors().text } }, x: { grid: { display: false } } }),
      },
    });
  }

  function buildQualityTrend() {
    var ctx = getCtx("chart-quality-trend");
    if (!ctx || !data.applicationQualityTrend.length) return;
    var grad = makeGradient(ctx, "rgba(14, 165, 233, 0.25)", "rgba(14, 165, 233, 0.02)");
    charts.qualTrend = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.applicationQualityTrend.map(function (d) { return fmtWeek(d.week); }),
        datasets: [{
          label: "Avg Tier",
          data: data.applicationQualityTrend.map(function (d) { return d.avgTier; }),
          fill: true, backgroundColor: grad,
          borderColor: "#00b0ff", borderWidth: 2.5, tension: 0.4,
          pointRadius: 5, pointBackgroundColor: "#00b0ff", pointBorderColor: "#fff", pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({
          y: { reverse: true, suggestedMin: 1, suggestedMax: 3, title: { display: true, text: "Tier (1=best)", color: themeColors().text } },
          x: { grid: { display: false } },
        }),
      },
    });
  }

  function buildGapTrend() {
    var ctx = getCtx("chart-gap-trend");
    if (!ctx || !data.weeklyGapTrend.length) return;
    var grad = makeGradient(ctx, "rgba(132, 204, 22, 0.25)", "rgba(132, 204, 22, 0.02)");
    charts.gapTrend = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.weeklyGapTrend.map(function (d) { return fmtWeek(d.week); }),
        datasets: [{
          label: "Avg Skill Gaps",
          data: data.weeklyGapTrend.map(function (d) { return d.avgGaps; }),
          fill: true, backgroundColor: grad,
          borderColor: "#76ff03", borderWidth: 2.5, tension: 0.4,
          pointRadius: 5, pointBackgroundColor: "#76ff03", pointBorderColor: "#fff", pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({
          y: { suggestedMin: 0, title: { display: true, text: "Avg Gaps (lower = better)", color: themeColors().text } },
          x: { grid: { display: false } },
        }),
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Section 11: Trends
  // ══════════════════════════════════════════════════════════════════════

  function buildNewPerWeek() {
    var ctx = getCtx("chart-new-per-week");
    if (!ctx || !data.newJobsPerWeek.length) return;
    var grad = makeGradient(ctx, "rgba(16, 185, 129, 0.25)", "rgba(16, 185, 129, 0.02)");
    charts.newWeek = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.newJobsPerWeek.map(function (d) { return fmtWeek(d.week); }),
        datasets: [{
          label: "New Listings",
          data: data.newJobsPerWeek.map(function (d) { return d.count; }),
          fill: true, backgroundColor: grad,
          borderColor: "#00e676", borderWidth: 2.5, tension: 0.4,
          pointRadius: 4, pointBackgroundColor: "#00e676", pointBorderColor: "#fff", pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({ y: { beginAtZero: true }, x: { grid: { display: false } } }),
      },
    });
  }

  function buildVelocity() {
    var ctx = getCtx("chart-velocity");
    if (!ctx || !data.marketVelocity.length) return;
    var grad = makeGradient(ctx, "rgba(245, 158, 11, 0.2)", "rgba(245, 158, 11, 0.02)");
    charts.velocity = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.marketVelocity.map(function (d) { return fmtWeek(d.week); }),
        datasets: [{
          label: "New / Deactivated",
          data: data.marketVelocity.map(function (d) { return d.ratio; }),
          fill: true, backgroundColor: grad,
          borderColor: "#ffab00", borderWidth: 2.5, tension: 0.4,
          pointRadius: 4, pointBackgroundColor: "#ffab00", pointBorderColor: "#fff", pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false }, tooltip: baseTooltip() },
        scales: baseScales({
          y: { suggestedMin: 0, suggestedMax: 3, ticks: { callback: function (v) { return v === 1 ? "1.0 (stable)" : v; } } },
          x: { grid: { display: false } },
        }),
      },
    });
  }

  // ── Build everything ───────────────────────────────────────────────────

  buildAllCharts();

  // ── Date range filter ──────────────────────────────────────────────────

  document.getElementById("apply-filter").addEventListener("click", function () {
    var from = document.getElementById("from-date").value;
    var to = document.getElementById("to-date").value;
    var params = new URLSearchParams(window.location.search);
    if (from) params.set("from", from); else params.delete("from");
    if (to) params.set("to", to); else params.delete("to");
    window.location.search = params.toString();
  });

  document.getElementById("clear-filter").addEventListener("click", function () {
    var params = new URLSearchParams();
    params.set("token", data.token);
    window.location.search = params.toString();
  });

})();
