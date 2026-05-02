# Custom Playwright Adapter

Use `ats: "custom-playwright"` for companies with a bespoke careers site that
doesn't use Greenhouse, Lever, Ashby, Amazon, Google, or Meta.

---

## When to use it

- Custom React / Vue careers pages with no public API
- Workday / iCIMS / SmartRecruiters instances that don't expose a stable JSON API
- Any career page where you can identify CSS selectors for the job list

**Prefer a proper adapter** if the ATS has a stable public API (e.g. Workday has
documented endpoints). Use `custom-playwright` as a Plan B only.

---

## Config schema

Add the company to `config/targets.json` with `ats: "custom-playwright"` and a
`selectors` object:

```json
{
  "name": "ExampleCo",
  "ats": "custom-playwright",
  "slug": null,
  "careersUrl": "https://examplecompany.com/careers?team=product",
  "roles": ["Product Manager"],
  "enabled": true,
  "selectors": {
    "jobCard":         "[data-testid='job-listing']",
    "title":           "h3.job-title",
    "location":        ".job-location",
    "applyUrl":        "a.apply-link",
    "postedDate":      "time[datetime]",
    "postedDateAttr":  "datetime",
    "scrollToLoad":    true,
    "waitForSelector": "[data-testid='job-listing']",
    "timeoutMs":       20000
  }
}
```

### Selector fields

| Field | Required | Description |
|---|---|---|
| `jobCard` | ✅ | CSS selector matching one element per job listing |
| `title` | ✅ | Sub-selector (relative to `jobCard`) for the job title text |
| `location` | — | Sub-selector for location text; omit if not in the DOM |
| `applyUrl` | ✅ | Sub-selector for the application link `<a>` element |
| `postedDate` | — | Sub-selector for the posted-date element |
| `postedDateAttr` | — | Attribute to read the date from (e.g. `"datetime"` for `<time datetime="...">`) |
| `scrollToLoad` | — | `true` → scroll 3× with 1 500 ms pauses to trigger lazy loading |
| `waitForSelector` | — | CSS selector to wait for before extracting cards (defaults to `jobCard`) |
| `timeoutMs` | — | Navigation + wait timeout in ms (default: 20 000) |

---

## How the adapter works

1. Playwright loads `careersUrl` with a shared Chromium context (serialised via
   the existing `withPlaywright` queue — only one browser at a time).
2. If `scrollToLoad` is `true`, the page is scrolled to the bottom 3 times with
   1 500 ms waits between scrolls.
3. The adapter waits for `waitForSelector` (or `jobCard` if not set).
4. Each matching `jobCard` is extracted:
   - **title** — `textContent` of the sub-selector
   - **location** — `textContent` of the sub-selector (empty string if absent)
   - **applyUrl** — `href` of the `<a>` sub-selector; if relative, prepended
     with the `careersUrl` origin
   - **postedDate** — if `postedDateAttr` is set, reads that attribute value;
     otherwise uses `textContent` of the `postedDate` sub-selector
5. Standard filters are then applied (title inclusion/exclusion, experience cap,
   US location, date cutoff).
6. `postedDateSource` is set to `"dom"` when a date is found, `"unknown"` otherwise.

---

## Debugging selectors

Open the careers page in Chrome DevTools and run in the console:

```js
// Check jobCard matches
document.querySelectorAll("[data-testid='job-listing']").length

// Check title within first card
document.querySelector("[data-testid='job-listing'] h3.job-title")?.textContent
```

If the page uses shadow DOM or iframes, `custom-playwright` won't work — you'll
need a dedicated adapter instead.

---

## Failure behaviour

If the adapter throws (timeout, selector not found, etc.):

- The error is logged with the company name and reason.
- The run continues — this company is counted in `errors` but doesn't block others.
- The error appears in the scan status and (if configured) in the digest footer.
- On the next hourly run the company is retried automatically.
