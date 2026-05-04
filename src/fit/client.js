/**
 * Client-side vanilla JS for the Check Fit page.
 * Handles: scoring, candidate selection, inline edit, custom bullets,
 * cap-check via /select, generate flow, download buttons.
 */

(function () {
  "use strict";

  var DATA = window.__FIT_DATA__;
  var jobId = DATA.jobId;
  var token = DATA.token;
  var totalQuals = DATA.totalQuals;

  // State: qualId -> { bulletId, text, isCustom, isEdited }
  var selections = {};
  var scoreData = null;

  // --------------------------------------------------------------------------
  //  API helpers
  // --------------------------------------------------------------------------

  function api(method, path, body) {
    var url = "/fit/" + jobId + path + "?token=" + encodeURIComponent(token);
    var opts = {
      method: method,
      headers: { "Content-Type": "application/json", "X-Fit-Token": token },
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
      return r.json();
    });
  }

  // --------------------------------------------------------------------------
  //  Score button
  // --------------------------------------------------------------------------

  var scoreBtn = document.getElementById("score-btn");
  var generateBtn = document.getElementById("generate-btn");
  var footerStatus = document.getElementById("footer-status");

  scoreBtn.addEventListener("click", function () {
    scoreBtn.disabled = true;
    scoreBtn.textContent = "Scoring...";
    footerStatus.textContent = "Running bullet selection pipeline...";

    // Show spinners in all candidate containers
    var containers = document.querySelectorAll(".candidates-container");
    for (var i = 0; i < containers.length; i++) {
      containers[i].innerHTML =
        '<div class="loading-spinner"><span class="spinner-icon"></span>Scoring...</div>';
    }

    api("POST", "/score", { force_refresh: false })
      .then(function (data) {
        scoreData = data;
        renderAllCandidates(data);
        scoreBtn.style.display = "none";
        generateBtn.style.display = "";
        updateFooterStatus();
      })
      .catch(function (err) {
        alert("Scoring failed: " + err.message);
        scoreBtn.disabled = false;
        scoreBtn.textContent = "Score Candidates";
        footerStatus.textContent = "Scoring failed. Try again.";
      });
  });

  // --------------------------------------------------------------------------
  //  Render candidates
  // --------------------------------------------------------------------------

  function renderAllCandidates(data) {
    var selectedBulletIds = {};
    data.final_selection.selected_bullets.forEach(function (sb) {
      sb.covers_qualifications.forEach(function (qid) {
        selectedBulletIds[qid] = sb.bullet_id;
      });
    });

    data.ranked_candidates.forEach(function (qc) {
      var qid = qc.qualification.id;
      var container = document.getElementById("candidates-" + qid);
      if (!container) return;

      var recommendedId = selectedBulletIds[qid] || null;
      var html = "";

      qc.candidates.forEach(function (cand, idx) {
        var isRecommended = cand.bullet_id === recommendedId;
        var scoreClass =
          cand.match_score >= 70 ? "score-high" :
          cand.match_score >= 40 ? "score-mid" : "score-low";

        html += '<div class="candidate' + (isRecommended ? " active" : "") +
          '" data-qual-id="' + esc(qid) +
          '" data-bullet-id="' + esc(cand.bullet_id) + '">';

        html += '<div class="candidate-header">';
        html += '<span class="candidate-source">from: ' + esc(cand.source_label) + '</span>';
        html += '<div class="candidate-scores">';
        if (isRecommended) {
          html += '<span class="badge badge-recommended">Recommended</span>';
        }
        html += '<span class="score-badge ' + scoreClass + '">' +
          cand.match_score.toFixed(1) + '</span>';
        html += '<span style="font-size:0.75rem;color:#6b7280;">conf ' +
          cand.confidence.toFixed(2) + '</span>';
        html += '</div></div>';

        html += '<div class="candidate-text">' + esc(cand.text) + '</div>';
        html += '<div class="candidate-rationale">' + esc(cand.rationale) + '</div>';

        html += '<button class="edit-btn" data-qual-id="' + esc(qid) +
          '" data-bullet-id="' + esc(cand.bullet_id) + '">Edit</button>';

        html += '<button class="sub-scores-toggle">Show sub-scores</button>';
        html += '<div class="sub-scores-detail">';
        html += renderSubScores(cand.sub_scores);
        html += '</div>';

        html += '</div>';

        // Auto-select recommended
        if (isRecommended) {
          selections[qid] = {
            bulletId: cand.bullet_id,
            text: cand.text,
            isCustom: false,
            isEdited: false,
          };
        }
      });

      // Check if recommended is not in top 3 (cap-forced)
      if (recommendedId && !qc.candidates.some(function (c) {
        return c.bullet_id === recommendedId;
      })) {
        // Find the bullet in scored data
        html += '<div class="candidate active" data-qual-id="' + esc(qid) +
          '" data-bullet-id="' + esc(recommendedId) + '">';
        html += '<div class="candidate-header">';
        html += '<span class="candidate-source">Cap-forced selection</span>';
        html += '<div class="candidate-scores">';
        html += '<span class="badge badge-cap-forced">Recommended (cap-forced)</span>';
        html += '</div></div>';
        html += '<div class="candidate-text">[Bullet ID: ' + esc(recommendedId) + ']</div>';
        html += '</div>';

        selections[qid] = {
          bulletId: recommendedId,
          text: "",
          isCustom: false,
          isEdited: false,
        };
      }

      container.innerHTML = html;
    });

    // Bind events
    bindCandidateClicks();
    bindEditButtons();
    bindSubScoreToggles();
    bindWriteOwnButtons();
    updateFooterStatus();
  }

  function renderSubScores(sub) {
    var dims = [
      { key: "keyword", label: "Keyword" },
      { key: "semantic", label: "Semantic" },
      { key: "evidence", label: "Evidence" },
      { key: "quantification", label: "Quantification" },
      { key: "seniority", label: "Seniority" },
      { key: "recency", label: "Recency" },
    ];
    var html = "";
    dims.forEach(function (d) {
      var val = sub[d.key] || 0;
      html += '<div class="sub-score-bar">';
      html += '<span class="sub-score-label">' + d.label + '</span>';
      html += '<div class="sub-score-track"><div class="sub-score-fill" style="width:' +
        val + '%"></div></div>';
      html += '<span class="sub-score-value">' + val.toFixed(0) + '</span>';
      html += '</div>';
    });
    return html;
  }

  // --------------------------------------------------------------------------
  //  Event handlers
  // --------------------------------------------------------------------------

  function bindCandidateClicks() {
    document.querySelectorAll(".candidate").forEach(function (el) {
      el.addEventListener("click", function (e) {
        if (e.target.closest(".edit-btn, .sub-scores-toggle, .edit-textarea")) return;

        var qid = el.dataset.qualId;
        var bid = el.dataset.bulletId;
        var textEl = el.querySelector(".candidate-text");

        // Deselect siblings
        var siblings = el.parentElement.querySelectorAll(".candidate");
        siblings.forEach(function (s) { s.classList.remove("active"); });
        el.classList.add("active");

        selections[qid] = {
          bulletId: bid,
          text: textEl ? textEl.textContent : "",
          isCustom: false,
          isEdited: false,
        };

        el.closest(".qual-card").classList.add("selected");
        updateFooterStatus();
        checkCaps();
      });
    });
  }

  function bindEditButtons() {
    document.querySelectorAll(".edit-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var candidate = btn.closest(".candidate");
        var textEl = candidate.querySelector(".candidate-text");
        var existing = candidate.querySelector(".edit-textarea");
        if (existing) {
          existing.remove();
          return;
        }

        var ta = document.createElement("textarea");
        ta.className = "edit-textarea";
        ta.value = textEl.textContent;
        ta.maxLength = 155;
        textEl.after(ta);
        ta.focus();

        ta.addEventListener("blur", function () {
          var newText = ta.value.trim();
          if (newText && newText !== textEl.textContent) {
            textEl.textContent = newText;
            var qid = btn.dataset.qualId;
            if (selections[qid] && selections[qid].bulletId === btn.dataset.bulletId) {
              selections[qid].text = newText;
              selections[qid].isEdited = true;
            }
          }
          ta.remove();
        });
      });
    });
  }

  function bindSubScoreToggles() {
    document.querySelectorAll(".sub-scores-toggle").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var detail = btn.nextElementSibling;
        detail.classList.toggle("open");
        btn.textContent = detail.classList.contains("open") ? "Hide sub-scores" : "Show sub-scores";
      });
    });
  }

  function bindWriteOwnButtons() {
    document.querySelectorAll(".write-own-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var qid = btn.dataset.qualId;
        var section = document.getElementById("custom-" + qid);
        section.style.display = section.style.display === "none" ? "block" : "none";
      });
    });

    document.querySelectorAll(".use-custom-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var qid = btn.dataset.qualId;
        var section = document.getElementById("custom-" + qid);
        var ta = section.querySelector(".custom-textarea");
        var text = ta.value.trim();
        if (!text) return;

        // Deselect any existing candidate
        var container = document.getElementById("candidates-" + qid);
        container.querySelectorAll(".candidate").forEach(function (c) {
          c.classList.remove("active");
        });

        selections[qid] = {
          bulletId: text,
          text: text,
          isCustom: true,
          isEdited: false,
        };

        btn.closest(".qual-card").classList.add("selected");
        section.style.display = "none";
        updateFooterStatus();
        checkCaps();
      });
    });
  }

  // --------------------------------------------------------------------------
  //  Cap check
  // --------------------------------------------------------------------------

  function checkCaps() {
    var sels = Object.keys(selections).map(function (qid) {
      var s = selections[qid];
      return {
        qualification_id: qid,
        bullet_id_or_text: s.bulletId,
        is_custom: s.isCustom,
      };
    });

    if (sels.length === 0) return;

    api("POST", "/select", { selections: sels })
      .then(function (data) {
        var warningsEl = document.getElementById("cap-warnings");
        var listEl = document.getElementById("cap-warnings-list");

        if (data.warnings && data.warnings.length > 0) {
          listEl.innerHTML = data.warnings.map(function (w) {
            return "<li>" + esc(w) + "</li>";
          }).join("");
          warningsEl.classList.add("visible");
        } else {
          warningsEl.classList.remove("visible");
        }
      })
      .catch(function () { /* silent */ });
  }

  // --------------------------------------------------------------------------
  //  Footer status + Generate
  // --------------------------------------------------------------------------

  function updateFooterStatus() {
    var selected = Object.keys(selections).length;
    footerStatus.textContent = selected + " / " + totalQuals + " qualifications selected";
    generateBtn.disabled = selected < totalQuals;
  }

  generateBtn.addEventListener("click", function () {
    generateBtn.disabled = true;
    generateBtn.textContent = "Generating...";
    footerStatus.innerHTML = '<span class="spinner-icon"></span>Building your resume...';

    var sels = Object.keys(selections).map(function (qid) {
      var s = selections[qid];
      return {
        qualification_id: qid,
        bullet_id_or_text: s.isCustom || s.isEdited ? s.text : s.bulletId,
        is_custom: s.isCustom || s.isEdited,
      };
    });

    api("POST", "/generate", { selections: sels })
      .then(function (data) {
        if (data.status === "not_implemented") {
          footerStatus.textContent = "Resume generation coming in Phase 3";
          generateBtn.textContent = "Generate Resume";
          generateBtn.disabled = false;
          return;
        }

        generateBtn.style.display = "none";

        var pdfBtn = document.getElementById("download-pdf");
        var docxBtn = document.getElementById("download-docx");
        pdfBtn.href = "/fit/" + jobId + "/download/pdf?token=" + encodeURIComponent(token);
        docxBtn.href = "/fit/" + jobId + "/download/docx?token=" + encodeURIComponent(token);
        pdfBtn.style.display = "";
        docxBtn.style.display = "";

        footerStatus.textContent = "Resume ready!";
      })
      .catch(function (err) {
        footerStatus.textContent = "Generation failed: " + err.message;
        generateBtn.disabled = false;
        generateBtn.textContent = "Generate Resume";
      });
  });

  // --------------------------------------------------------------------------
  //  Helpers
  // --------------------------------------------------------------------------

  function esc(s) {
    var el = document.createElement("span");
    el.textContent = s;
    return el.innerHTML;
  }
})();
