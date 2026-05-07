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
  var customSkills = [];  // tracks skills added via the UI button
  var skillEdits = {};    // index -> edited list string (per skill subsection)
  var skillDeletions = []; // original indices of deleted skill sub-sections
  var newSkillSections = []; // {name, list} objects for new skill sub-sections
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

  // Apply button handler
  var applyBtn = document.getElementById("apply-btn");
  if (applyBtn) {
    applyBtn.addEventListener("click", function () {
      var appliedBy = selectedEmail || "unknown";
      applyBtn.disabled = true;
      applyBtn.textContent = "Applying...";

      api("POST", "/apply", { applied_by: appliedBy })
        .then(function (data) {
          var banner = document.getElementById("apply-banner");
          if (data.already_applied) {
            banner.style.background = "#fef3c7";
            banner.style.borderColor = "#f59e0b";
            banner.style.color = "#92400e";
            banner.innerHTML = '<span style="font-weight:700;">Already Applied</span> by ' + esc(data.applied_by) + ' on ' + esc(data.applied_date);
          } else {
            banner.style.background = "#d1fae5";
            banner.style.borderColor = "#22c55e";
            banner.style.color = "#065f46";
            banner.innerHTML = '<span style="font-weight:700;">Applied</span> by ' + esc(data.applied_by) + ' on ' + esc(data.applied_date);
          }
        })
        .catch(function (err) {
          applyBtn.textContent = "Mark as Applied";
          applyBtn.disabled = false;
          alert("Failed: " + err.message);
        });
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
      html += '<span class="summary-char-display" style="font-size:0.72rem;color:#9ca3af;">' + c.chars + ' chars</span>';
      html += '</div></div>';
      html += '<div class="summary-text">' + esc(c.text) + '</div>';
      if (c.reasoning) {
        html += '<div style="font-size:0.72rem;color:#9ca3af;margin-top:4px;font-style:italic;">' + esc(c.reasoning) + '</div>';
      }
      html += '<button class="summary-edit-btn" data-index="' + c.index + '">Edit</button>';
      html += '<div class="summary-edit-area" data-index="' + c.index + '" style="display:none;">';
      html += '<textarea class="summary-edit-textarea">' + esc(c.text) + '</textarea>';
      html += '<div class="summary-edit-actions">';
      html += '<button class="btn btn-sm" style="background:#6366f1;color:#fff;" data-action="save" data-index="' + c.index + '">Save</button>';
      html += '<button class="btn btn-sm" style="background:#e5e7eb;color:#374151;" data-action="cancel" data-index="' + c.index + '">Cancel</button>';
      html += '<span class="summary-char-count"></span>';
      html += '</div></div>';
      html += '</div>';
    });

    box.innerHTML = html;

    // Bind selection clicks
    box.querySelectorAll(".summary-candidate").forEach(function (el) {
      el.addEventListener("click", function (e) {
        // Don't select when clicking edit controls
        if (e.target.closest(".summary-edit-btn") || e.target.closest(".summary-edit-area")) return;
        box.querySelectorAll(".summary-candidate").forEach(function (s) { s.classList.remove("active"); });
        el.classList.add("active");
        selectedSummary = el.querySelector(".summary-text").textContent;
      });
    });

    // Bind edit buttons
    box.querySelectorAll(".summary-edit-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = btn.dataset.index;
        var area = btn.parentElement.querySelector('.summary-edit-area[data-index="' + idx + '"]');
        var ta = area.querySelector(".summary-edit-textarea");
        // Reset textarea to current displayed text
        ta.value = btn.parentElement.querySelector(".summary-text").textContent;
        area.style.display = area.style.display === "none" ? "block" : "none";
        if (area.style.display === "block") {
          ta.focus();
          updateCharCount(ta, area.querySelector(".summary-char-count"));
        }
      });
    });

    // Bind textarea char count updates
    box.querySelectorAll(".summary-edit-textarea").forEach(function (ta) {
      ta.addEventListener("input", function () {
        var countEl = ta.closest(".summary-edit-area").querySelector(".summary-char-count");
        updateCharCount(ta, countEl);
      });
    });

    // Bind save/cancel
    box.querySelectorAll(".summary-edit-actions button").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = btn.dataset.index;
        var candidate = btn.closest(".summary-candidate");
        var area = candidate.querySelector('.summary-edit-area[data-index="' + idx + '"]');
        var ta = area.querySelector(".summary-edit-textarea");

        if (btn.dataset.action === "save") {
          var newText = ta.value.trim();
          if (newText) {
            candidate.querySelector(".summary-text").textContent = newText;
            candidate.querySelector(".summary-char-display").textContent = newText.length + " chars";
            // Update selectedSummary if this candidate is active
            if (candidate.classList.contains("active")) {
              selectedSummary = newText;
            }
          }
        }
        area.style.display = "none";
      });
    });
  }

  function updateCharCount(ta, countEl) {
    var len = ta.value.length;
    var color = len > 340 ? "#dc2626" : "#9ca3af";
    countEl.textContent = len + "/340 chars";
    countEl.style.color = color;
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
    html += '<div id="skill-lines-container">';
    lines.forEach(function (line, idx) {
      html += buildSkillLineHtml(idx, line.name, line.list, line.jdEvidence, false);
    });
    html += '</div>';

    if (gapFilled.length > 0) {
      html += '<div style="margin-top:10px;font-size:0.75rem;color:#059669;">JD gaps filled: ' + gapFilled.map(esc).join(", ") + '</div>';
    }
    if (gapRemaining.length > 0) {
      html += '<div style="font-size:0.75rem;color:#d97706;">JD terms not covered: ' + gapRemaining.slice(0, 8).map(esc).join(", ");
      if (gapRemaining.length > 8) html += ' +' + (gapRemaining.length - 8) + ' more';
      html += '</div>';
    }

    // Add custom skill + add section buttons
    html += '<div style="margin-top:10px;display:flex;gap:12px;flex-wrap:wrap;">';
    html += '<button class="btn-link" id="add-skill-btn">+ Add custom skill</button>';
    html += '<button class="btn-link" id="add-skill-section-btn">+ Add skill section</button>';
    html += '</div>';
    // Custom skill area
    html += '<div id="custom-skill-area" style="display:none;margin-top:6px;">';
    html += '<input type="text" id="custom-skill-input" placeholder="Type a skill (e.g. Docker, Agile)" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:4px;font-size:0.82rem;width:250px;">';
    html += ' <button class="btn btn-sm" style="background:#6366f1;color:#fff;" id="custom-skill-add">Add</button>';
    html += '</div>';
    // New section area
    html += '<div id="new-skill-section-area" style="display:none;margin-top:6px;">';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
    html += '<input type="text" id="new-section-name" placeholder="Section name (e.g. Cloud Platforms)" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:4px;font-size:0.82rem;width:200px;">';
    html += '<input type="text" id="new-section-list" placeholder="Skills (e.g. AWS, GCP, Azure)" style="padding:6px 10px;border:1px solid #e5e7eb;border-radius:4px;font-size:0.82rem;width:300px;">';
    html += '<button class="btn btn-sm" style="background:#6366f1;color:#fff;" id="new-section-add">Add Section</button>';
    html += '</div></div>';

    box.innerHTML = html;
    bindSkillEvents(box);
  }

  function buildSkillLineHtml(idx, name, list, jdEvidence, isNew) {
    var dataAttr = isNew ? 'data-new-idx="' + idx + '"' : 'data-skill-idx="' + idx + '"';
    var html = '<div class="skill-line" ' + dataAttr + '>';
    html += '<div style="display:flex;align-items:baseline;justify-content:space-between;">';
    html += '<div><span class="skill-line-name">' + esc(name) + ': </span>';
    html += '<span class="skill-line-list">' + esc(list) + '</span></div>';
    html += '<div style="display:flex;gap:4px;">';
    html += '<button class="skill-edit-btn" ' + dataAttr + '>Edit</button>';
    html += '<button class="skill-delete-btn" ' + dataAttr + ' title="Delete section">&times;</button>';
    html += '</div></div>';
    // Edit area
    var editId = isNew ? 'skill-edit-new-' + idx : 'skill-edit-' + idx;
    html += '<div class="skill-edit-area" id="' + editId + '" style="display:none;">';
    html += '<input type="text" class="skill-edit-input" value="' + esc(list) + '">';
    html += '<div class="skill-edit-actions">';
    html += '<button class="btn btn-sm" style="background:#6366f1;color:#fff;" data-action="save" ' + dataAttr + '>Save</button>';
    html += '<button class="btn btn-sm" style="background:#e5e7eb;color:#374151;" data-action="cancel" ' + dataAttr + '>Cancel</button>';
    html += '</div></div>';
    if (jdEvidence && jdEvidence.length > 0) {
      html += '<div style="font-size:0.7rem;color:#6366f1;margin-top:2px;">JD asks for: ' + jdEvidence.map(esc).join(", ") + '</div>';
    }
    html += '</div>';
    return html;
  }

  function bindSkillEvents(box) {
    // Edit buttons
    box.querySelectorAll(".skill-edit-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = btn.dataset.skillIdx || btn.dataset.newIdx;
        var isNew = !!btn.dataset.newIdx;
        var editId = isNew ? "skill-edit-new-" + idx : "skill-edit-" + idx;
        var area = document.getElementById(editId);
        area.style.display = area.style.display === "none" ? "block" : "none";
      });
    });

    // Save/cancel in edit areas
    box.querySelectorAll(".skill-edit-actions button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = btn.dataset.skillIdx || btn.dataset.newIdx;
        var isNew = !!btn.dataset.newIdx;
        var editId = isNew ? "skill-edit-new-" + idx : "skill-edit-" + idx;
        var area = document.getElementById(editId);
        var lineEl = isNew
          ? box.querySelector('.skill-line[data-new-idx="' + idx + '"]')
          : box.querySelector('.skill-line[data-skill-idx="' + idx + '"]');
        if (btn.dataset.action === "save") {
          var input = area.querySelector(".skill-edit-input");
          var newList = input.value.trim();
          if (newList) {
            lineEl.querySelector(".skill-line-list").textContent = newList;
            if (isNew) {
              // Update the newSkillSections entry
              var ni = parseInt(idx, 10);
              if (newSkillSections[ni]) newSkillSections[ni].list = newList;
            } else {
              skillEdits[idx] = newList;
            }
          }
        }
        area.style.display = "none";
      });
    });

    // Delete buttons
    box.querySelectorAll(".skill-delete-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var isNew = !!btn.dataset.newIdx;
        var idx = parseInt(btn.dataset.skillIdx || btn.dataset.newIdx, 10);
        var lineEl = isNew
          ? box.querySelector('.skill-line[data-new-idx="' + idx + '"]')
          : box.querySelector('.skill-line[data-skill-idx="' + idx + '"]');
        if (lineEl) lineEl.remove();
        if (isNew) {
          // Mark new section as deleted (set to null, filter on generate)
          newSkillSections[idx] = null;
        } else {
          skillDeletions.push(idx);
        }
      });
    });

    // Add custom skill
    var addSkillBtn = document.getElementById("add-skill-btn");
    if (addSkillBtn) {
      addSkillBtn.addEventListener("click", function () {
        var area = document.getElementById("custom-skill-area");
        area.style.display = area.style.display === "none" ? "block" : "none";
      });
    }
    var customSkillAdd = document.getElementById("custom-skill-add");
    if (customSkillAdd) {
      customSkillAdd.addEventListener("click", function () {
        var input = document.getElementById("custom-skill-input");
        var skill = input.value.trim();
        if (!skill) return;
        customSkills.push(skill);
        var lastLine = box.querySelectorAll(".skill-line");
        if (lastLine.length > 0) {
          var listEl = lastLine[lastLine.length - 1].querySelector(".skill-line-list");
          listEl.textContent += ", " + skill;
        }
        input.value = "";
      });
    }

    // Add skill section
    var addSectionBtn = document.getElementById("add-skill-section-btn");
    if (addSectionBtn) {
      addSectionBtn.addEventListener("click", function () {
        var area = document.getElementById("new-skill-section-area");
        area.style.display = area.style.display === "none" ? "block" : "none";
      });
    }
    var newSectionAdd = document.getElementById("new-section-add");
    if (newSectionAdd) {
      newSectionAdd.addEventListener("click", function () {
        var nameInput = document.getElementById("new-section-name");
        var listInput = document.getElementById("new-section-list");
        var name = nameInput.value.trim();
        var list = listInput.value.trim();
        if (!name || !list) return;

        var newIdx = newSkillSections.length;
        newSkillSections.push({ name: name, list: list });

        // Append to DOM
        var container = document.getElementById("skill-lines-container");
        var div = document.createElement("div");
        div.innerHTML = buildSkillLineHtml(newIdx, name, list, null, true);
        var newLine = div.firstElementChild;
        container.appendChild(newLine);

        // Re-bind events for the new line
        bindSkillEvents(box);

        nameInput.value = "";
        listInput.value = "";
      });
    }
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
    document.getElementById("preview-btn").disabled = false;
    document.getElementById("gen-pdf-btn").disabled = false;
    document.getElementById("gen-docx-btn").disabled = false;
    document.getElementById("gen-cover-btn").disabled = false;
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
    document.getElementById("preview-btn").addEventListener("click", function () { previewResume(); });
    document.getElementById("gen-pdf-btn").addEventListener("click", function () { generateAndDownload("pdf"); });
    document.getElementById("gen-docx-btn").addEventListener("click", function () { generateAndDownload("docx"); });
    document.getElementById("gen-cover-btn").addEventListener("click", function () { generateCoverLetter(); });
  }

  function buildGeneratePayload() {
    var sels = Object.keys(selections).map(function (qid) {
      var s = selections[qid];
      return { qualification_id: qid, bullet_id_or_text: s.isCustom || s.isEdited ? s.text : s.bulletId, is_custom: s.isCustom || s.isEdited };
    });
    // Filter out null entries from deleted new sections
    var validNewSections = newSkillSections.filter(function (s) { return s !== null; });
    return {
      selections: sels,
      summaryHints: selectedSummary || "",
      email: selectedEmail,
      customSkills: customSkills,
      skillEdits: skillEdits,
      skillDeletions: skillDeletions,
      newSkillSections: validNewSections,
    };
  }

  function generateAndDownload(format) {
    var btn = document.getElementById("gen-" + format + "-btn");
    btn.disabled = true;
    btn.textContent = "Generating...";

    api("POST", "/generate", buildGeneratePayload())
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

  function previewResume() {
    var btn = document.getElementById("preview-btn");
    btn.disabled = true;
    btn.textContent = "Generating...";

    api("POST", "/generate", buildGeneratePayload())
      .then(function (data) {
        if (data.error) throw new Error(data.error);
        var iframe = document.getElementById("preview-iframe");
        iframe.src = "/fit/" + jobId + "/preview/pdf?token=" + encodeURIComponent(token) + "&t=" + Date.now();
        document.getElementById("preview-modal").classList.add("open");
        btn.textContent = "Preview";
        btn.disabled = false;
      })
      .catch(function (err) {
        btn.textContent = "Preview";
        btn.disabled = false;
        document.getElementById("footer-status").textContent = "Preview failed: " + err.message;
      });
  }
  // --------------------------------------------------------------------------
  //  Outreach generation (unified system)
  // --------------------------------------------------------------------------
  var outreachModeSelect = document.getElementById("outreach-mode");
  var personIntelSection = document.getElementById("person-intel-section");
  if (outreachModeSelect) {
    outreachModeSelect.addEventListener("change", function () {
      var isLinkedIn = outreachModeSelect.value !== "cover_letter";
      personIntelSection.style.display = isLinkedIn ? "block" : "none";
    });
  }

  var outreachGenBtn = document.getElementById("outreach-generate-btn");
  if (outreachGenBtn) {
    outreachGenBtn.addEventListener("click", function () {
      var mode = document.getElementById("outreach-mode").value;
      var personIntelText = document.getElementById("person-intel-text");
      var personIntelName = document.getElementById("person-intel-name");
      var personIntelTitle = document.getElementById("person-intel-title");

      var body = { mode: mode, email: selectedEmail };
      if (mode !== "cover_letter" && personIntelText && personIntelText.value.trim()) {
        body.personIntel = {
          text: personIntelText.value.trim(),
          name: personIntelName ? personIntelName.value.trim() : undefined,
          title: personIntelTitle ? personIntelTitle.value.trim() : undefined,
        };
      }

      outreachGenBtn.disabled = true;
      outreachGenBtn.textContent = "Finding hook + writing...";
      document.getElementById("outreach-skip").style.display = "none";
      document.getElementById("outreach-result").style.display = "none";

      api("POST", "/outreach", body)
        .then(function (data) {
          if (data.skip) {
            var skipEl = document.getElementById("outreach-skip");
            skipEl.innerHTML = "No specific hook found \u2014 " + esc(data.reason) + ". Consider applying without a cover letter, or refresh company intel.";
            skipEl.style.display = "block";
          } else {
            document.getElementById("outreach-hook").innerHTML =
              "<strong>Hook (score: " + data.hook.specificity_score + "/10):</strong> " + esc(data.hook.bridge_text);
            document.getElementById("outreach-text").value = data.text;
            document.getElementById("outreach-meta").textContent = data.wordCount + " words | mode: " + data.mode;

            var dlBtn = document.getElementById("outreach-download");
            if (data.mode === "cover_letter") {
              dlBtn.style.display = "inline-block";
            } else {
              dlBtn.style.display = "none";
            }

            document.getElementById("outreach-result").style.display = "block";
          }
          outreachGenBtn.textContent = "Generate Outreach";
          outreachGenBtn.disabled = false;
        })
        .catch(function (err) {
          outreachGenBtn.textContent = "Generate Outreach";
          outreachGenBtn.disabled = false;
          alert("Outreach failed: " + err.message);
        });
    });
  }

  // Refresh company intel
  window.refreshCompanyIntel = function () {
    var btn = document.getElementById("refresh-intel-btn");
    var status = document.getElementById("refresh-intel-status");
    btn.disabled = true;
    status.textContent = "Refreshing...";

    api("POST", "/intel/refresh", {})
      .then(function (data) {
        if (data.skipped) {
          status.textContent = "Skipped: " + data.skipReason;
        } else {
          status.textContent = "Done! " + (data.chunksWritten || 0) + " chunks added from " + (data.rssPostsAdded || 0) + " posts.";
        }
        btn.disabled = false;
      })
      .catch(function (err) {
        status.textContent = "Failed: " + err.message;
        btn.disabled = false;
      });
  };

  // Download outreach as DOCX (sends edited text to server)
  window.downloadOutreachDocx = function () {
    var text = document.getElementById("outreach-text").value;
    var btn = document.getElementById("outreach-download");
    btn.disabled = true;
    btn.textContent = "Building DOCX...";

    api("POST", "/outreach/download", { text: text })
      .then(function (data) {
        // Server returns a download URL
        if (data.downloadUrl) {
          var a = document.createElement("a");
          a.href = data.downloadUrl;
          a.download = "";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        btn.disabled = false;
        btn.textContent = "Download DOCX";
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "Download DOCX";
        alert("Download failed: " + err.message);
      });
  };

  // --------------------------------------------------------------------------
  //  Cover letter generation (legacy)
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
