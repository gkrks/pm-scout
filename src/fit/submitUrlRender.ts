/**
 * Server-rendered HTML for the "Check Fit for Any Job" URL submission page.
 * Styled to match the dashboard/tracker dark header aesthetic.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderSubmitUrlPage(token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Check Fit — Submit Job URL</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #080c1a;
      color: #f1f5f9;
      line-height: 1.6;
      min-height: 100vh;
    }

    .header {
      background: #050816;
      padding: 20px 24px;
      display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
      border-bottom: 2px solid #00d4ff;
    }
    .header h1 {
      font-size: 1.25rem; font-weight: 800; color: #f1f5f9;
      letter-spacing: -0.02em;
    }
    .header h1 span { color: #33e0ff; }
    .header-right {
      margin-left: auto; display: flex; align-items: center; gap: 12px;
    }
    .header-nav-link {
      color: #a0aec0; text-decoration: none; font-size: 0.82rem; padding: 5px 14px;
      border: 1px solid #334155; border-radius: 6px; transition: all 0.2s;
    }
    .header-nav-link:hover { color: #00d4ff; border-color: #00d4ff; }

    .main {
      display: flex; justify-content: center; align-items: center;
      min-height: calc(100vh - 70px); padding: 40px 20px;
    }

    .card {
      background: #111827;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 40px;
      max-width: 560px;
      width: 100%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4), 0 0 1px rgba(0,212,255,0.05);
    }

    .card h2 {
      font-size: 1.3rem; font-weight: 700; margin-bottom: 8px;
    }
    .card p.subtitle {
      color: #a0aec0; font-size: 0.88rem; margin-bottom: 24px;
    }

    .form-group { margin-bottom: 20px; }
    .form-group label {
      display: block; font-size: 0.82rem; font-weight: 600;
      color: #a0aec0; margin-bottom: 6px;
    }

    .url-input {
      width: 100%; padding: 12px 14px;
      background: #0a0e27; color: #f1f5f9;
      border: 1px solid #334155; border-radius: 8px;
      font-size: 0.92rem; outline: none; transition: border-color 0.2s;
    }
    .url-input:focus { border-color: #00d4ff; }
    .url-input::placeholder { color: #4a5568; }

    .submit-btn {
      width: 100%; padding: 12px;
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #fff; border: none; border-radius: 8px;
      font-size: 0.95rem; font-weight: 600; cursor: pointer;
      transition: opacity 0.2s, transform 0.1s;
    }
    .submit-btn:hover { opacity: 0.9; }
    .submit-btn:active { transform: scale(0.98); }
    .submit-btn:disabled {
      opacity: 0.5; cursor: not-allowed; transform: none;
    }

    .status-msg {
      margin-top: 16px; padding: 10px 14px; border-radius: 8px;
      font-size: 0.85rem; display: none;
    }
    .status-msg.loading {
      display: block; background: #1e293b; color: #33e0ff;
      border: 1px solid #334155;
    }
    .status-msg.error {
      display: block; background: #1c1017; color: #ff4081;
      border: 1px solid #5c1030;
    }
    .status-msg.success {
      display: block; background: #0c1f17; color: #00e676;
      border: 1px solid #0a5c30;
    }

    .spinner {
      display: inline-block; width: 14px; height: 14px;
      border: 2px solid #334155; border-top-color: #00d4ff;
      border-radius: 50%; animation: spin 0.6s linear infinite;
      vertical-align: middle; margin-right: 8px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

  <div class="header">
    <h1><span>PM Scout</span> Check Fit</h1>
    <div class="header-right">
      <a href="/dashboard?token=${esc(token)}" class="header-nav-link">Dashboard</a>
      <a href="/tracker?token=${esc(token)}" class="header-nav-link">Tracker</a>
    </div>
  </div>

  <div class="main">
    <div class="card">
      <h2>Check Fit for Any Job</h2>
      <p class="subtitle">Paste a job posting URL to score your resume bullets against the qualifications and generate a tailored resume.</p>

      <form id="url-form">
        <div class="form-group">
          <label for="job-url">Job Posting URL</label>
          <input
            type="url"
            id="job-url"
            class="url-input"
            placeholder="https://boards.greenhouse.io/company/jobs/12345"
            required
          />
        </div>
        <button type="submit" class="submit-btn" id="submit-btn">
          Analyze Job Posting
        </button>
      </form>

      <div class="status-msg" id="status-msg"></div>
    </div>
  </div>

  <script>
    (function() {
      var form = document.getElementById("url-form");
      var input = document.getElementById("job-url");
      var btn = document.getElementById("submit-btn");
      var statusEl = document.getElementById("status-msg");

      function setStatus(type, msg) {
        statusEl.className = "status-msg " + type;
        statusEl.innerHTML = msg;
      }

      form.addEventListener("submit", function(e) {
        e.preventDefault();
        var url = input.value.trim();
        if (!url) return;

        btn.disabled = true;
        setStatus("loading", '<span class="spinner"></span>Scraping page and extracting qualifications...');

        fetch("/fit/submit-url?token=${esc(token)}", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url })
        })
        .then(function(resp) {
          return resp.json().then(function(data) {
            return { ok: resp.ok, status: resp.status, data: data };
          });
        })
        .then(function(result) {
          if (result.ok && result.data.redirectUrl) {
            var label = result.data.existing ? "Job already exists — redirecting..." : "Done! Redirecting to Check Fit...";
            setStatus("success", label);
            setTimeout(function() {
              window.location.href = result.data.redirectUrl;
            }, 500);
          } else {
            setStatus("error", result.data.error || "Something went wrong");
            btn.disabled = false;
          }
        })
        .catch(function(err) {
          setStatus("error", "Network error: " + err.message);
          btn.disabled = false;
        });
      });
    })();
  </script>

</body>
</html>`;
}
