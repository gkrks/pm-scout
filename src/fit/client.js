/**
 * Client-side JS for the Check Fit page.
 * Auto-scores on page load. Dynamic fit score. Edit per qualification.
 */
(function () {
  "use strict";

  var DATA = window.__FIT_DATA__;
  var jobId = DATA.jobId;
  var token = DATA.token;
  var totalQuals = DATA.totalQuals;
  var requiredCount = DATA.requiredCount;
  var preferredCount = DATA.preferredCount;

  // State
  var selections = {};       // qid -> {bulletId, text, score, isCustom, isEdited}
  var preResolvedIds = {};   // qid -> true (pre-resolved, always counts as met)
  var selectedSummary = null;
  var selectedEmail = DATA.emails && DATA.emails[0] || "";
  var scoreData = null;

  // Email selector behavior
  var emailSelect = document.getElementById("email-select");
  var emailCustom = document.getElementById("email-custom-input");
  if (emailSelect) {
    emailSelect.addEventListener("change", function () {
      if (emailSelect.value === "__custom__") {
        emailCustom.style.display = "inline-block";
        emailCustom.focus();
      } else {
        emailCustom.style.display = "none";
        selectedEmail = emailSelect.value;
      }
    });
    emailCustom.addEventListener("input", function () {
      selectedEmail = emailCustom.value.trim();
    });
  }

  function api(method, path, body) {
    var url = "/fit/" + jobId + path + "?token=" + encodeURIComponent(token);
    var opts = { method: method, headers: { "Content-Type": "application/json", "X-Fit-Token": token } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
      return r.json();
    });
  }

  function esc(s) { var el = document.createElement("span"); el.textContent = s; return el.innerHTML; }

  // --------------------------------------------------------------------------
  //  Auto-score on page load
  // --------------------------------------------------------------------------
  api("POST", "/score", { force_refresh: false })
    .then(function (data) {
      scoreData = data;
      renderPreResolved(data);
      renderCandidates(data);
      renderSummary(data);
      renderSkills(data);
      recalcStrength();
      enableButtons();
    })
    .catch(function (err) {
      document.getElementById("footer-status").textContent = "Scoring failed: " + err.message;
      document.getElementById("summary-box").innerHTML = '<div style="color:#dc2626;">Failed. Reload to retry.</div>';
      document.getElementById("skills-box").innerHTML = "";
    });

  // --------------------------------------------------------------------------
  //  Pre-resolved qualifications
  // --------------------------------------------------------------------------
  function renderPreResolved(data) {
    (data.pre_resolved || []).forEach(function (pr) {
      var container = document.getElementById("candidates-" + pr.qualification_id);
      if (!container) return;

      var met = pr.met;
      container.innerHTML =
        '<div class="pre-resolved' + (met ? '' : ' not-met') + '">' +
        '<div class="pre-resolved-status">' + (met ? 'MET' : 'NOT MET') + '</div>' +
        '<div class="pre-resolved-evidence">' + esc(pr.evidence || "No evidence") + '</div>' +
        '<div class="pre-resolved-meta">' + esc(pr.category.replace(/_/g, " ")) + ' | conf ' + (pr.confidence * 100).toFixed(0) + '%</div>' +
        '</div>';

      preResolvedIds[pr.qualification_id] = true;
      selections[pr.qualification_id] = { bulletId: "__pre_resolved__", text: pr.evidence || "", score: met ? 100 : 0, isCustom: false, isEdited: false };
      container.closest(".qual-row").classList.add("selected");
    });
  }

  // --------------------------------------------------------------------------
  //  Bullet candidates + one Edit button per qualification
  // --------------------------------------------------------------------------
  function renderCandidates(data) {
    var selectedBulletIds = {};
    data.final_selection.selected_bullets.forEach(function (sb) {
      sb.covers_qualifications.forEach(function (qid) { selectedBulletIds[qid] = sb.bullet_id; });
    });

    data.ranked_candidates.forEach(function (qc) {
      var qid = qc.qualification.id;
      var container = document.getElementById("candidates-" + qid);
      if (!container) return;

      var recommendedId = selectedBulletIds[qid] || null;
      var html = "";

      qc.candidates.forEach(function (cand) {
        var isRec = cand.bullet_id === recommendedId;
        var cls = cand.match_score >= 70 ? "score-high" : cand.match_score >= 40 ? "score-mid" : "score-low";

        html += '<div class="candidate' + (isRec ? " active" : "") + '" data-qual-id="' + esc(qid) + '" data-bullet-id="' + esc(cand.bullet_id) + '" data-score="' + cand.match_score + '">';
        html += '<div class="candidate-header"><span class="candidate-source">' + esc(cand.source_label) + '</span><div>';
        if (isRec) html += '<span class="badge-recommended">Recommended</span> ';
        html += '<span class="score-badge ' + cls + '">' + cand.match_score.toFixed(0) + '</span></div></div>';
        html += '<div class="candidate-text">' + esc(cand.text) + '</div>';
        html += '</div>';

        if (isRec) {
          selections[qid] = { bulletId: cand.bullet_id, text: cand.text, score: cand.match_score, isCustom: false, isEdited: false };
        }
      });

      // One edit button per qualification (below all candidates)
      html += '<div class="qual-edit-row">';
      html += '<button class="btn-link write-own-btn" data-qual-id="' + esc(qid) + '">+ Write custom bullet</button>';
      html += '<div class="custom-edit-area" id="custom-' + esc(qid) + '" style="display:none;">';
      html += '<textarea class="edit-textarea" placeholder="Write your own bullet (max 155 chars)" maxlength="155"></textarea>';
      html += '<button class="btn btn-sm" style="margin-top:4px;background:#6366f1;color:#fff;" data-qual-id="' + esc(qid) + '">Use this</button>';
      html += '</div></div>';

      container.innerHTML = html;
      if (selections[qid]) container.closest(".qual-row").classList.add("selected");
    });

    bindCandidateClicks();
    bindWriteOwn();
  }

  function bindCandidateClicks() {
    document.querySelectorAll(".candidate").forEach(function (el) {
      el.addEventListener("click", function () {
        var qid = el.dataset.qualId;
        el.parentElement.querySelectorAll(".candidate").forEach(function (s) { s.classList.remove("active"); });
        el.classList.add("active");
        selections[qid] = {
          bulletId: el.dataset.bulletId,
          text: el.querySelector(".candidate-text").textContent,
          score: parseFloat(el.dataset.score) || 0,
          isCustom: false, isEdited: false,
        };
        el.closest(".qual-row").classList.add("selected");
        recalcStrength();
      });
    });
  }

  function bindWriteOwn() {
    document.querySelectorAll(".write-own-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var qid = btn.dataset.qualId;
        var area = document.getElementById("custom-" + qid);
        area.style.display = area.style.display === "none" ? "block" : "none";
      });
    });
    document.querySelectorAll(".custom-edit-area .btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var qid = btn.dataset.qualId;
        var area = document.getElementById("custom-" + qid);
        var ta = area.querySelector("textarea");
        var text = ta.value.trim();
        if (!text) return;

        // Deselect existing candidates
        var container = document.getElementById("candidates-" + qid);
        container.querySelectorAll(".candidate").forEach(function (c) { c.classList.remove("active"); });

        selections[qid] = { bulletId: text, text: text, score: 50, isCustom: true, isEdited: false };
        container.closest(".qual-row").classList.add("selected");
        area.style.display = "none";
        recalcStrength();
      });
    });
  }

  // --------------------------------------------------------------------------
  //  Summary candidates (3 options, selectable)
  // --------------------------------------------------------------------------
  function renderSummary(data) {
    var box = document.getElementById("summary-box");
    var candidates = data.summary_candidates || [];
    var recommended = data.summary_recommended || 1;

    if (candidates.length === 0) {
      box.innerHTML = '<div style="color:#9ca3af;font-style:italic;">No summary candidates generated.</div>';
      return;
    }

    var html = '';
    candidates.forEach(function (c) {
      var isRec = c.index === recommended;
      if (isRec) selectedSummary = c.text;

      html += '<div class="summary-candidate' + (isRec ? ' active' : '') + '" data-index="' + c.index + '">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
      html += '<span style="font-size:0.72rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.3px;">Option ' + c.index + ' — ' + esc(c.angle) + '</span>';
      html += '<div>';
      if (isRec) html += '<span class="badge-recommended">Recommended</span> ';
      html += '<span style="font-size:0.72rem;color:#9ca3af;">' + c.chars + ' chars</span>';
      html += '</div></div>';
      html += '<div class="summary-text">' + esc(c.text) + '</div>';
      if (c.reasoning) {
        html += '<div style="font-size:0.72rem;color:#9ca3af;margin-top:4px;font-style:italic;">' + esc(c.reasoning) + '</div>';
      }
      html += '</div>';
    });

    box.innerHTML = html;

    box.querySelectorAll(".summary-candidate").forEach(function (el) {
      el.addEventListener("click", function () {
        box.querySelectorAll(".summary-candidate").forEach(function (s) { s.classList.remove("active"); });
        el.classList.add("active");
        selectedSummary = el.querySelector(".summary-text").textContent;
      });
    });
  }

  // --------------------------------------------------------------------------
  //  Skills with JD proof
  // --------------------------------------------------------------------------
  function renderSkills(data) {
    var box = document.getElementById("skills-box");
    var lines = data.optimized_skills || [];
    var gapFilled = data.skills_gap_filled || [];
    var gapRemaining = data.skills_gap_remaining || [];

    if (lines.length === 0) {
      box.innerHTML = '<div style="color:#9ca3af;">No skills computed.</div>';
      return;
    }

    var html = '';
    lines.forEach(function (line) {
      html += '<div class="skill-line"><span class="skill-line-name">' + esc(line.name) + ': </span>';
      html += '<span class="skill-line-list">' + esc(line.list) + '</span>';
      if (line.jdEvidence && line.jdEvidence.length > 0) {
        html += '<div style="font-size:0.7rem;color:#6366f1;margin-top:2px;">JD asks for: ' + line.jdEvidence.map(esc).join(", ") + '</div>';
      }
      html += '</div>';
    });

    if (gapFilled.length > 0) {
      html += '<div style="margin-top:10px;font-size:0.75rem;color:#059669;">JD gaps filled: ' + gapFilled.map(esc).join(", ") + '</div>';
    }
    if (gapRemaining.length > 0) {
      html += '<div style="font-size:0.75rem;color:#d97706;">JD terms not covered: ' + gapRemaining.slice(0, 8).map(esc).join(", ");
      if (gapRemaining.length > 8) html += ' +' + (gapRemaining.length - 8) + ' more';
      html += '</div>';
    }

    // Add custom skill button
    html += '<div style="margin-top:10px;">';
    html += '<button class="btn-link" id="add-skill-btn">+ Add custom skill</button>';
    html += '<div id="custom-skill-area" style="display:none;margin-top:6px;">';
    html += '<input type="text" id="custom-skill-input" placeholder="Type a skill (e.g. Docker, Agile)" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:4px;font-size:0.82rem;width:250px;">';
    html += ' <button class="btn btn-sm" style="background:#6366f1;color:#fff;" id="custom-skill-add">Add</button>';
    html += '</div></div>';

    box.innerHTML = html;

    // Bind add skill
    document.getElementById("add-skill-btn").addEventListener("click", function () {
      var area = document.getElementById("custom-skill-area");
      area.style.display = area.style.display === "none" ? "block" : "none";
    });
    document.getElementById("custom-skill-add").addEventListener("click", function () {
      var input = document.getElementById("custom-skill-input");
      var skill = input.value.trim();
      if (!skill) return;
      // Append to the last skill line
      var lastLine = box.querySelectorAll(".skill-line");
      if (lastLine.length > 0) {
        var listEl = lastLine[lastLine.length - 1].querySelector(".skill-line-list");
        listEl.textContent += ", " + skill;
      }
      input.value = "";
    });
  }

  // --------------------------------------------------------------------------
  //  Dynamic strength score (recalculates on every selection change)
  // --------------------------------------------------------------------------
  function recalcStrength() {
    var basicMet = 0, prefMet = 0, totalScore = 0, scoreCount = 0;

    for (var qid in selections) {
      var sel = selections[qid];
      var isBasic = qid.startsWith("q_basic");
      var isPreferred = qid.startsWith("q_preferred");
      var met = preResolvedIds[qid] ? sel.score >= 50 : sel.score >= 50;

      if (isBasic && (preResolvedIds[qid] ? true : met)) basicMet++;
      if (isPreferred && met) prefMet++;
      if (!preResolvedIds[qid]) { totalScore += sel.score; scoreCount++; }
    }

    var basicPct = requiredCount > 0 ? Math.round((basicMet / requiredCount) * 100) : 0;
    var prefPct = preferredCount > 0 ? Math.round((prefMet / preferredCount) * 100) : 0;
    var avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;
    var skillScore = (scoreData && scoreData.optimized_skills && scoreData.optimized_skills.length > 0) ? 75 : 0;
    var overall = Math.round(0.4 * basicPct + 0.25 * prefPct + 0.2 * avgScore + 0.15 * skillScore);

    // Update badge
    var numberEl = document.getElementById("strength-number");
    numberEl.textContent = overall;
    numberEl.className = "strength-number " + (overall >= 70 ? "strength-green" : overall >= 45 ? "strength-yellow" : "strength-red");
    document.getElementById("strength-trigger").style.display = "block";

    // Update modal breakdown
    document.getElementById("strength-breakdown").innerHTML =
      buildScoreRow("Overall Fit", overall) +
      buildScoreRow("Required (" + basicMet + "/" + requiredCount + ")", basicPct) +
      buildScoreRow("Preferred (" + prefMet + "/" + preferredCount + ")", prefPct) +
      buildScoreRow("Avg Match Score", avgScore) +
      buildScoreRow("Skills Coverage", skillScore);

    // Update footer
    var selected = Object.keys(selections).length;
    document.getElementById("footer-status").textContent = selected + "/" + totalQuals + " matched | Fit: " + overall;
    document.getElementById("gen-pdf-btn").disabled = selected < totalQuals;
    document.getElementById("gen-docx-btn").disabled = selected < totalQuals;
    document.getElementById("gen-cover-btn").disabled = selected < totalQuals;
  }

  function buildScoreRow(label, value) {
    var color = value >= 70 ? "#059669" : value >= 45 ? "#d97706" : "#dc2626";
    return '<div class="score-row"><span class="score-row-label">' + esc(label) + '</span>' +
      '<div class="score-bar-track"><div class="score-bar-fill" style="width:' + value + '%;background:' + color + ';"></div></div>' +
      '<span class="score-row-value" style="color:' + color + ';">' + value + '</span></div>';
  }

  // --------------------------------------------------------------------------
  //  Generate buttons
  // --------------------------------------------------------------------------
  function enableButtons() {
    document.getElementById("gen-pdf-btn").addEventListener("click", function () { generateAndDownload("pdf"); });
    document.getElementById("gen-docx-btn").addEventListener("click", function () { generateAndDownload("docx"); });
    document.getElementById("gen-cover-btn").addEventListener("click", function () { generateCoverLetter(); });
  }

  function generateAndDownload(format) {
    var btn = document.getElementById("gen-" + format + "-btn");
    btn.disabled = true;
    btn.textContent = "Generating...";

    var sels = Object.keys(selections).map(function (qid) {
      var s = selections[qid];
      return { qualification_id: qid, bullet_id_or_text: s.isCustom || s.isEdited ? s.text : s.bulletId, is_custom: s.isCustom || s.isEdited };
    });

    api("POST", "/generate", { selections: sels, summaryHints: selectedSummary || "", email: selectedEmail })
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        window.location.href = "/fit/" + jobId + "/download/" + format + "?token=" + encodeURIComponent(token);
        btn.textContent = format === "pdf" ? "Generate PDF" : "Generate DOCX";
        btn.disabled = false;
      })
      .catch(function (err) {
        btn.textContent = format === "pdf" ? "Generate PDF" : "Generate DOCX";
        btn.disabled = false;
        document.getElementById("footer-status").textContent = "Failed: " + err.message;
      });
  }
  // --------------------------------------------------------------------------
  //  Cover letter generation
  // --------------------------------------------------------------------------
  function generateCoverLetter() {
    var btn = document.getElementById("gen-cover-btn");
    btn.disabled = true;
    btn.textContent = "Writing...";

    // Collect selected bullet texts
    var bulletTexts = [];
    for (var qid in selections) {
      var s = selections[qid];
      if (s.text && s.bulletId !== "__pre_resolved__") {
        bulletTexts.push(s.text);
      }
    }

    api("POST", "/cover-letter", { bulletTexts: bulletTexts, email: selectedEmail })
      .then(function (data) {
        if (data.error) throw new Error(data.error);

        var contentEl = document.getElementById("cover-letter-content");
        contentEl.textContent = data.letter;

        var metaEl = document.getElementById("cover-letter-meta");
        var metaHtml = '';
        if (data.wordCount) metaHtml += '<div>Word count: ' + data.wordCount + '</div>';
        if (data.priorities && data.priorities.length > 0) {
          metaHtml += '<div>Priorities targeted: ' + data.priorities.map(esc).join(", ") + '</div>';
        }
        if (data.alternativeHook) {
          metaHtml += '<div style="margin-top:8px;"><strong>Alternative opening:</strong><br>' + esc(data.alternativeHook) + '</div>';
        }
        metaEl.innerHTML = metaHtml;

        // Show download DOCX button if available
        if (data.docxPath) {
          var dlBtn = document.createElement("a");
          dlBtn.href = "/fit/" + jobId + "/download/cover-letter?token=" + encodeURIComponent(token);
          dlBtn.className = "btn";
          dlBtn.style.cssText = "background:#2563eb;color:#fff;margin-left:8px;text-decoration:none;";
          dlBtn.textContent = "Download DOCX";
          dlBtn.download = "";
          var modalBtns = document.querySelector("#cover-letter-modal .modal div:last-child");
          if (modalBtns && !modalBtns.querySelector("a")) modalBtns.appendChild(dlBtn);
        }

        document.getElementById("cover-letter-modal").classList.add("open");
        btn.textContent = "Cover Letter";
        btn.disabled = false;
      })
      .catch(function (err) {
        btn.textContent = "Cover Letter";
        btn.disabled = false;
        alert("Cover letter failed: " + err.message);
      });
  }
})();
