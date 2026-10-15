const state = {
  jobs: [],
  filtered: [],
  currentPage: 1,
  pageSize: 10,
  selectedSectors: [],
  view: "map",
  selectedMapLocation: null,
  selectedLocations: [],
  updatedAt: null,
  map: null,
  markerLayer: null,
  adminToken: null,
  crawlPoll: null,
  lastFocused: null,
};

const $ = (selector) => document.querySelector(selector);
const jobList = $("#jobList");
const filters = {
  search: $("#searchInput"),
  company: $("#companyFilter"),
  location: $("#locationSearch"),
  domain: $("#domainFilter"),
  experience: $("#experienceFilter"),
  sort: $("#sortSelect"),
};

const cityCoordinates = {
  ahmedabad: [23.0225, 72.5714], bengaluru: [12.9716, 77.5946], bangalore: [12.9716, 77.5946],
  bhopal: [23.2599, 77.4126], bhubaneswar: [20.2961, 85.8245], chandigarh: [30.7333, 76.7794],
  chennai: [13.0827, 80.2707], coimbatore: [11.0168, 76.9558], delhi: [28.6139, 77.209],
  gurugram: [28.4595, 77.0266], gurgaon: [28.4595, 77.0266], guwahati: [26.1445, 91.7362],
  hyderabad: [17.385, 78.4867], indore: [22.7196, 75.8577], jaipur: [26.9124, 75.7873],
  kochi: [9.9312, 76.2673], kolkata: [22.5726, 88.3639], lucknow: [26.8467, 80.9462],
  mumbai: [19.076, 72.8777], mysuru: [12.2958, 76.6394], mysore: [12.2958, 76.6394],
  nagpur: [21.1458, 79.0882], noida: [28.5355, 77.391], patna: [25.5941, 85.1376],
  pune: [18.5204, 73.8567], surat: [21.1702, 72.8311], thiruvananthapuram: [8.5241, 76.9366],
  vadodara: [22.3072, 73.1812], visakhapatnam: [17.6868, 83.2185], remote: [22.5937, 78.9629],
};

const stateCoordinates = {
  assam: [26.2, 92.9], bihar: [25.9, 85.6], gujarat: [22.3, 71.2], haryana: [29.1, 76.1],
  karnataka: [15.3, 75.7], kerala: [10.1, 76.3], maharashtra: [19.7, 75.7],
  odisha: [20.9, 85.1], rajasthan: [27.0, 74.2], "tamil nadu": [11.1, 78.7],
  telangana: [18.1, 79.0], "uttar pradesh": [27.1, 80.9], "west bengal": [23.0, 87.9],
};

const logoColors = ["#d9f277", "#f3b48b", "#a9d6ee", "#dfc9ed", "#f0d78f", "#b8dfc3"];
const sectors = [
  { id: "engineering", label: "Engineering & technology", icon: "⌘", domains: ["software-it", "data-ai"], terms: /engineer|engineering|developer|software|data|devops|cloud|quality assurance|technical|technology|sre|infrastructure/i },
  { id: "healthcare", label: "Healthcare & pharmacy", icon: "+", domains: ["healthcare", "pharmacy", "pharma", "medical", "biotech"], terms: /pharmacy|pharmacist|pharma|healthcare|medical|clinical|biotech|nursing|doctor|hospital|life sciences/i },
  { id: "operations", label: "Operations & supply chain", icon: "↗", domains: ["operations"], terms: /operations|logistics|supply chain|delivery|warehouse|fleet|procurement/i },
  { id: "business", label: "Business & sales", icon: "◈", domains: ["sales-business"], terms: /sales|business development|account|banking|partnership|consultant|commercial/i },
  { id: "product", label: "Product & design", icon: "◇", domains: ["product", "design"], terms: /product|designer|design|ux|user experience|ui /i },
  { id: "marketing", label: "Marketing & communications", icon: "✳", domains: ["marketing", "communications"], terms: /marketing|campaign|brand|content|communications|growth/i },
  { id: "people", label: "People & HR", icon: "◎", domains: ["human-resources", "hr"], terms: /human resources|\bhr\b|talent|recruit|people operations/i },
  { id: "finance", label: "Finance & accounting", icon: "₹", domains: ["finance", "accounting"], terms: /finance|accounting|accountant|audit|treasury|taxation|financial analyst/i },
];
const icons = {
  location: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12m-5-5 5 5-5 5"/></svg>',
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch { return "#"; }
}

function labelize(value) {
  if (!value) return "Not specified";
  return String(value).replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function initials(company) {
  return String(company || "Job").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function colorFor(company) {
  const sum = [...String(company || "")].reduce((total, char) => total + char.charCodeAt(0), 0);
  return logoColors[sum % logoColors.length];
}

function locationLabel(job) {
  return job.full_location_text || [job.city, job.state, job.country].filter(Boolean).join(", ") || "Location not listed";
}

function locationKey(job) {
  const rawValue = job.city || job.state || (job.workplace_type === "remote" ? "Remote" : job.full_location_text) || "Other India";
  const firstValue = Array.isArray(rawValue) ? rawValue.find((value) => String(value || "").trim()) : rawValue;
  let place = String(firstValue || "Other India")
    .replace(/^\([^)]*\)\s*/, "")
    .replace(/^hybrid\s*[-:]\s*/i, "")
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/^(bengaluru|bangalore)$/i.test(place)) return "Bengaluru";
  return place || "Other India";
}

function experienceLabel(job) {
  if (job.fresher_eligible && (job.max_experience ?? 0) <= 1) return "Fresher friendly";
  if (job.min_experience == null && job.max_experience == null) return "Experience not listed";
  if (job.min_experience != null && job.max_experience != null) return `${job.min_experience}–${job.max_experience} yrs`;
  if (job.min_experience != null) return `${job.min_experience}+ yrs`;
  return `Up to ${job.max_experience} yrs`;
}

function salaryLabel(job) {
  if (!job.salary_disclosed && job.salary_min == null && job.salary_max == null) return null;
  const format = (amount) => amount == null ? null : `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(amount)}`;
  const minimum = format(job.salary_min);
  const maximum = format(job.salary_max);
  if (minimum && maximum) return `${minimum}–${maximum}${job.salary_period === "yearly" ? " / yr" : ""}`;
  return `${minimum || maximum}${job.salary_period === "yearly" ? " / yr" : ""}`;
}

function postedLabel(dateString) {
  if (!dateString) return "Recently added";
  const date = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(date.valueOf())) return "Recently added";
  const days = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 86400000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function populateSelect(select, values) {
  const current = select.value;
  const placeholder = select.options[0].outerHTML;
  select.innerHTML = placeholder + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(labelize(value))}</option>`).join("");
  select.value = current;
}

function renderLocationOptions() {
  const query = filters.location.value.trim().toLocaleLowerCase();
  const values = uniqueValues(locationKey).filter((value) => !query || value.toLocaleLowerCase().includes(query));
  const options = $("#locationOptions");
  options.innerHTML = values.length ? values.map((value) => `<label class="location-option"><input type="checkbox" value="${escapeHtml(value)}" ${state.selectedLocations.includes(value) ? "checked" : ""}><span>${escapeHtml(value)}</span></label>`).join("") : '<p class="location-no-results">No matching listed locations. Typing still filters matching job locations.</p>';
  const trigger = $("#locationTrigger");
  trigger.innerHTML = state.selectedLocations.length
    ? `${state.selectedLocations.length} location${state.selectedLocations.length === 1 ? "" : "s"} <span aria-hidden="true">⌄</span>`
    : "All locations <span aria-hidden=\"true\">⌄</span>";
}

function uniqueValues(keyFn) {
  return [...new Set(state.jobs.map(keyFn).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function matchesSector(job, sector) {
  const domain = String(job.domain || "").toLocaleLowerCase();
  const searchable = [job.title, job.domain, job.subdomain, ...(job.skills || [])].filter(Boolean).join(" ");
  return sector.domains.includes(domain) || sector.terms.test(searchable);
}

function renderSectorChoices() {
  const choices = [{ id: "all", label: "All sectors", icon: "✦" }, ...sectors, { id: "other", label: "Other sectors", icon: "＋" }];
  $("#sectorChoices").innerHTML = choices.map((sector) => {
    const count = sector.id === "all" ? state.jobs.length
      : sector.id === "other" ? state.jobs.filter((job) => !sectors.some((known) => matchesSector(job, known))).length
        : state.jobs.filter((job) => matchesSector(job, sector)).length;
    const selected = sector.id === "all" ? state.selectedSectors.length === 0 : state.selectedSectors.includes(sector.id);
    return `<button class="sector-card${selected ? " selected" : ""}" type="button" data-sector="${sector.id}" aria-pressed="${selected}"><span class="sector-icon" aria-hidden="true">${escapeHtml(sector.icon)}</span><span class="sector-name">${escapeHtml(sector.label)}</span><span class="sector-count">${count.toLocaleString("en-IN")} roles</span></button>`;
  }).join("");
  $("#sectorSelectionCount").textContent = state.selectedSectors.length
    ? `${state.selectedSectors.length} sector${state.selectedSectors.length === 1 ? "" : "s"} selected`
    : "All sectors";
}

function renderSkeletons() {
  jobList.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
}

async function loadJobs() {
  renderSkeletons();
  try {
    const response = await fetch("/api/jobs", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Could not load the jobs feed");
    const payload = await response.json();
    state.jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    state.updatedAt = payload.updated_at;
    populateSelect(filters.company, uniqueValues((job) => job.company_name));
    renderLocationOptions();
    populateSelect(filters.domain, uniqueValues((job) => job.domain));
    updateStats();
    renderSectorChoices();
    applyFilters();
  } catch (error) {
    jobList.innerHTML = `<div class="empty-state"><strong>We couldn't load the roles.</strong><span>${escapeHtml(error.message)}</span><button class="button button-primary" onclick="location.reload()">Try again</button></div>`;
    $("#headerCount").textContent = "Jobs feed unavailable";
  }
}

function updateStats() {
  const companies = new Set(state.jobs.map((job) => job.company_name).filter(Boolean));
  const cities = new Set(state.jobs.map(locationKey).filter(Boolean));
  $("#statJobs").textContent = state.jobs.length.toLocaleString("en-IN");
  $("#statCompanies").textContent = companies.size.toLocaleString("en-IN");
  $("#statCities").textContent = cities.size.toLocaleString("en-IN");
  $("#headerCount").textContent = `${state.jobs.length} live roles`;
  $("#lastUpdated").textContent = state.updatedAt
    ? `updated ${new Date(state.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
    : "awaiting first crawl";
}

function matchesExperience(job, filter) {
  if (!filter) return true;
  const min = Number(job.min_experience ?? 0);
  const max = Number(job.max_experience ?? min);
  if (filter === "fresher") return Boolean(job.fresher_eligible) || min === 0;
  if (filter === "0-2") return min <= 2;
  if (filter === "3-5") return max >= 3 && min <= 5;
  if (filter === "6+") return max >= 6;
  return true;
}

function applyFilters(resetVisible = true) {
  const query = filters.search.value.trim().toLocaleLowerCase();
  const company = filters.company.value;
  const location = filters.location.value.trim().toLocaleLowerCase();
  const domain = filters.domain.value;
  const experience = filters.experience.value;
  if (resetVisible) state.currentPage = 1;

  state.filtered = state.jobs.filter((job) => {
    const haystack = [job.title, job.company_name, job.summary, job.description, job.domain, job.subdomain, ...(job.skills || [])].filter(Boolean).join(" ").toLocaleLowerCase();
    const sectorMatches = !state.selectedSectors.length || state.selectedSectors.some((id) => {
      if (id === "other") return !sectors.some((sector) => matchesSector(job, sector));
      const sector = sectors.find((item) => item.id === id);
      return sector && matchesSector(job, sector);
    });
    return sectorMatches
      && (!query || haystack.includes(query))
      && (!company || job.company_name === company)
      && (!state.selectedLocations.length || state.selectedLocations.includes(locationKey(job)))
      && (!location || locationKey(job).toLocaleLowerCase().includes(location))
      && (!domain || job.domain === domain)
      && matchesExperience(job, experience);
  });

  state.filtered.sort((a, b) => {
    if (filters.sort.value === "company") return String(a.company_name).localeCompare(String(b.company_name)) || String(a.title).localeCompare(String(b.title));
    if (filters.sort.value === "experience") return Number(a.min_experience ?? 999) - Number(b.min_experience ?? 999);
    return String(b.date_posted || "").localeCompare(String(a.date_posted || ""));
  });
  renderJobs();
  updateMap();
  $("#clearFilters").hidden = !state.selectedSectors.length && !state.selectedLocations.length && ![query, company, location, domain, experience].some(Boolean);
}

function jobCard(job, index) {
  const skills = (job.skills || []).slice(0, 3);
  const salary = salaryLabel(job);
  return `
    <article class="job-card" tabindex="0" role="button" data-job-index="${index}" aria-label="View ${escapeHtml(job.title)} at ${escapeHtml(job.company_name)}">
      <div class="company-logo" style="--logo-bg:${colorFor(job.company_name)}">${escapeHtml(initials(job.company_name))}</div>
      <div class="job-main">
        <div class="job-company"><span>${escapeHtml(job.company_name)}</span>${job.workplace_type ? `<span>· ${escapeHtml(labelize(job.workplace_type))}</span>` : ""}</div>
        <h3>${escapeHtml(job.title)}</h3>
        <div class="job-meta">
          <span>${icons.location}${escapeHtml(locationLabel(job))}</span>
          <span>${icons.briefcase}${escapeHtml(experienceLabel(job))}</span>
          ${salary ? `<span>${escapeHtml(salary)}</span>` : ""}
        </div>
        ${skills.length ? `<div class="job-skills">${skills.map((skill) => `<span>${escapeHtml(skill)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="card-side"><span class="posted-date">${escapeHtml(postedLabel(job.date_posted))}</span><span class="card-arrow">${icons.arrow}</span></div>
    </article>`;
}

function renderJobs() {
  $("#resultCount").textContent = state.filtered.length.toLocaleString("en-IN");
  const pageCount = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  state.currentPage = Math.min(state.currentPage, pageCount);
  const start = (state.currentPage - 1) * state.pageSize;
  if (!state.filtered.length) {
    jobList.innerHTML = '<div class="empty-state"><strong>No roles match yet.</strong><span>Try another sector or widen your filters. New roles appear as companies publish and crawl openings.</span><button class="button button-primary" id="emptyClear">Clear all filters</button></div>';
    $("#emptyClear").addEventListener("click", clearFilters);
  } else {
    jobList.innerHTML = state.filtered.slice(start, start + state.pageSize).map((job, index) => jobCard(job, start + index)).join("");
  }
  const pagination = $("#pagination");
  pagination.hidden = state.filtered.length <= state.pageSize;
  pagination.innerHTML = Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1;
    return `<button class="page-button${page === state.currentPage ? " active" : ""}" type="button" data-page="${page}" aria-label="Page ${page}"${page === state.currentPage ? ' aria-current="page"' : ""}>${page}</button>`;
  }).join("");
}

function renderMapResults(location) {
  const title = $("#mapResultsTitle");
  const hint = $("#mapResultsHint");
  const list = $("#mapResultsList");
  const jobs = location ? state.filtered.filter((job) => locationKey(job) === location) : [];
  title.textContent = location || "Choose a map marker";
  hint.textContent = location ? `${jobs.length} matching opening${jobs.length === 1 ? "" : "s"} in this location` : "Click a numbered marker to see matching openings here.";
  list.innerHTML = jobs.map((job) => jobCard(job, state.filtered.indexOf(job))).join("")
    || (location ? '<div class="map-results-empty">No matching jobs at this location.</div>' : "");
}

function setResultsView(view) {
  state.view = view;
  $("#explorerGrid").dataset.view = view;
  document.querySelectorAll("[data-results-view]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.resultsView === view));
  });
  if (view === "map") {
    requestAnimationFrame(() => state.map?.invalidateSize());
  }
}

function enterExplorer(view) {
  $("#landing").hidden = true;
  $("#explorer").hidden = false;
  setResultsView(view);
  if (!state.map) initMap();
  else requestAnimationFrame(() => state.map.invalidateSize());
  updateMap();
  $("#explorer").scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearFilters() {
  filters.search.value = "";
  filters.company.value = "";
  filters.location.value = "";
  state.selectedLocations = [];
  renderLocationOptions();
  filters.domain.value = "";
  filters.experience.value = "";
  state.selectedSectors = [];
  renderSectorChoices();
  applyFilters();
}

function findCoordinates(job) {
  const city = String(job.city || "").toLocaleLowerCase().trim();
  const stateName = String(job.state || "").toLocaleLowerCase().trim();
  if (cityCoordinates[city]) return cityCoordinates[city];
  const fuzzyCity = Object.keys(cityCoordinates).find((key) => city.includes(key) || key.includes(city));
  if (fuzzyCity && city) return cityCoordinates[fuzzyCity];
  if (stateCoordinates[stateName]) return stateCoordinates[stateName];
  if (job.workplace_type === "remote") return cityCoordinates.remote;
  return null;
}

function initMap() {
  if (!window.L) {
    $("#mapUnavailable").hidden = false;
    return;
  }
  state.map = L.map("map", { zoomControl: true, scrollWheelZoom: false, minZoom: 4 }).setView([22.9, 78.9], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(state.map);
  state.markerLayer = L.layerGroup().addTo(state.map);
  $("#resetMapButton").addEventListener("click", () => state.map.setView([22.9, 78.9], 5));
  updateMap();
}

function updateMap() {
  const groups = new Map();
  state.filtered.forEach((job) => {
    const coords = findCoordinates(job);
    if (!coords) return;
    const key = locationKey(job);
    if (!groups.has(key)) groups.set(key, { coords, jobs: [] });
    groups.get(key).jobs.push(job);
  });
  $("#mapLocations").textContent = groups.size;
  if (state.selectedMapLocation && !groups.has(state.selectedMapLocation)) state.selectedMapLocation = null;
  renderMapResults(state.selectedMapLocation);
  if (!state.map || !state.markerLayer) return;
  state.markerLayer.clearLayers();
  groups.forEach(({ coords, jobs }, place) => {
    const icon = L.divIcon({
      className: "job-marker",
      html: `<div class="marker-pin"><span>${jobs.length}</span></div>`,
      iconSize: [42, 42], iconAnchor: [21, 40], popupAnchor: [0, -37],
    });
    const marker = L.marker(coords, { icon }).addTo(state.markerLayer);
    marker.bindPopup(`<div class="map-popup"><strong>${escapeHtml(place)}</strong><span>${jobs.length} role${jobs.length === 1 ? "" : "s"} · click to filter</span></div>`);
    marker.on("click", () => {
      state.selectedMapLocation = place;
      renderMapResults(place);
      marker.openPopup();
      if (window.innerWidth < 980) $("#mapResultsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function listSection(title, items) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<section class="drawer-section"><h3>${escapeHtml(title)}</h3><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`;
}

function openDrawer(job) {
  state.lastFocused = document.activeElement;
  const salary = salaryLabel(job);
  $("#drawerContent").innerHTML = `
    <div class="drawer-company-row"><div class="company-logo" style="--logo-bg:${colorFor(job.company_name)}">${escapeHtml(initials(job.company_name))}</div><div><strong>${escapeHtml(job.company_name)}</strong><span>${escapeHtml(labelize(job.domain || "Open position"))}</span></div></div>
    <h2 id="drawerTitle">${escapeHtml(job.title)}</h2>
    <div class="drawer-meta"><span>${escapeHtml(locationLabel(job))}</span><span>${escapeHtml(experienceLabel(job))}</span>${job.workplace_type ? `<span>${escapeHtml(labelize(job.workplace_type))}</span>` : ""}${salary ? `<span>${escapeHtml(salary)}</span>` : ""}</div>
    <a class="button button-primary drawer-apply" href="${escapeHtml(safeUrl(job.application_url))}" target="_blank" rel="noopener noreferrer"><span>Apply on company site</span><span aria-hidden="true">↗</span></a>
    <section class="drawer-section"><h3>About the role</h3><p>${escapeHtml(job.description || job.summary || "See the source listing for full details.")}</p></section>
    ${listSection("What you'll do", job.responsibilities)}
    ${listSection("Required qualifications", job.required_qualifications)}
    ${listSection("Preferred qualifications", job.preferred_qualifications)}
    ${(job.skills || []).length ? `<section class="drawer-section"><h3>Skills</h3><div class="drawer-skills">${job.skills.map((skill) => `<span>${escapeHtml(skill)}</span>`).join("")}</div></section>` : ""}
    <a class="source-link" href="${escapeHtml(safeUrl(job.source_url))}" target="_blank" rel="noopener noreferrer">View original career source ↗</a>`;
  $("#detailScrim").hidden = false;
  requestAnimationFrame(() => $("#detailScrim").classList.add("visible"));
  $("#jobDrawer").classList.add("open");
  $("#jobDrawer").setAttribute("aria-hidden", "false");
  document.body.classList.add("drawer-open");
  $("#closeDrawer").focus();
}

function closeDrawer() {
  $("#jobDrawer").classList.remove("open");
  $("#jobDrawer").setAttribute("aria-hidden", "true");
  $("#detailScrim").classList.remove("visible");
  document.body.classList.remove("drawer-open");
  setTimeout(() => { $("#detailScrim").hidden = true; }, 220);
  state.lastFocused?.focus();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function adminFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.adminToken}`, ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) {
    state.adminToken = null;
    showLoginView();
  }
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function showLoginView() {
  $("#loginView").hidden = false;
  $("#adminView").hidden = true;
  $("#passwordInput").value = "";
  setTimeout(() => $("#passwordInput").focus(), 30);
}

async function showAdminView() {
  $("#loginView").hidden = true;
  $("#adminView").hidden = false;
  await Promise.all([loadSources(), refreshCrawlStatus()]);
}

async function loadSources() {
  try {
    const payload = await adminFetch("/api/admin/sources");
    $("#sourceCount").textContent = payload.sources.length;
    $("#sourceList").innerHTML = payload.sources.map((source) => `<div class="source-item"><strong>${escapeHtml(source.company)}</strong><span>Active</span><a href="${escapeHtml(safeUrl(source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.url)}</a></div>`).join("") || '<p>No sources configured yet.</p>';
  } catch (error) { $("#sourceError").textContent = error.message; }
}

async function refreshCrawlStatus() {
  if (!state.adminToken) return;
  try {
    const status = await adminFetch("/api/admin/crawl");
    const labels = { idle: "Crawler is idle", running: "Crawl in progress…", succeeded: "Last crawl completed", failed: "Last crawl failed" };
    $("#crawlStatusText").textContent = labels[status.state] || status.state;
    $("#runCrawlerButton").disabled = status.state === "running";
    $("#runCrawlerButton").textContent = status.state === "running" ? "Running…" : "Run crawler";
    const logs = Array.isArray(status.logs) ? status.logs : [];
    $("#crawlLogs").hidden = !logs.length;
    $("#crawlLogs").textContent = logs.join("\n");
    $("#crawlLogs").scrollTop = $("#crawlLogs").scrollHeight;
    clearTimeout(state.crawlPoll);
    if (status.state === "running") state.crawlPoll = setTimeout(refreshCrawlStatus, 2500);
    if (status.state === "succeeded") loadJobs();
  } catch (error) { $("#crawlStatusText").textContent = error.message; }
}

function bindEvents() {
  Object.values(filters).filter((element) => element !== filters.location).forEach((element) => element.addEventListener(element === filters.search ? "input" : "change", () => applyFilters()));
  filters.location.addEventListener("input", () => { renderLocationOptions(); applyFilters(); });
  $("#locationTrigger").addEventListener("click", () => {
    const menu = $("#locationMenu");
    const opening = menu.hidden;
    menu.hidden = !opening;
    $("#locationTrigger").setAttribute("aria-expanded", String(opening));
    if (opening) filters.location.focus();
  });
  $("#locationOptions").addEventListener("change", (event) => {
    const checkbox = event.target.closest('input[type="checkbox"]');
    if (!checkbox) return;
    state.selectedLocations = checkbox.checked
      ? [...state.selectedLocations, checkbox.value]
      : state.selectedLocations.filter((value) => value !== checkbox.value);
    renderLocationOptions();
    applyFilters();
  });
  document.addEventListener("click", (event) => {
    const filter = $("#locationFilter");
    if (filter.contains(event.target)) return;
    $("#locationMenu").hidden = true;
    $("#locationTrigger").setAttribute("aria-expanded", "false");
  });
  $("#clearFilters").addEventListener("click", clearFilters);
  $("#pagination").addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (!button) return;
    state.currentPage = Number(button.dataset.page);
    renderJobs();
  });
  $("#sectorChoices").addEventListener("click", (event) => {
    const button = event.target.closest("[data-sector]");
    if (!button) return;
    const id = button.dataset.sector;
    if (id === "all") state.selectedSectors = [];
    else state.selectedSectors = state.selectedSectors.includes(id)
      ? state.selectedSectors.filter((selected) => selected !== id)
      : [...state.selectedSectors, id];
    renderSectorChoices();
  });
  document.querySelectorAll("[data-enter-view]").forEach((button) => {
    button.addEventListener("click", () => {
      applyFilters();
      enterExplorer(button.dataset.enterView);
    });
  });
  document.querySelectorAll("[data-results-view]").forEach((button) => {
    button.addEventListener("click", () => setResultsView(button.dataset.resultsView));
  });
  $("#changeSectors").addEventListener("click", () => {
    $("#explorer").hidden = true;
    $("#landing").hidden = false;
    renderSectorChoices();
    $("#landing").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  jobList.addEventListener("click", (event) => {
    const card = event.target.closest(".job-card");
    if (card) openDrawer(state.filtered[Number(card.dataset.jobIndex)]);
  });
  $("#mapResultsList").addEventListener("click", (event) => {
    const card = event.target.closest(".job-card");
    if (card) openDrawer(state.filtered[Number(card.dataset.jobIndex)]);
  });
  $("#mapResultsList").addEventListener("keydown", (event) => {
    const card = event.target.closest(".job-card");
    if (card && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      openDrawer(state.filtered[Number(card.dataset.jobIndex)]);
    }
  });
  jobList.addEventListener("keydown", (event) => {
    const card = event.target.closest(".job-card");
    if (card && ["Enter", " "].includes(event.key)) { event.preventDefault(); openDrawer(state.filtered[Number(card.dataset.jobIndex)]); }
  });
  $("#closeDrawer").addEventListener("click", closeDrawer);
  $("#detailScrim").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") { event.preventDefault(); filters.search.focus(); }
    if (event.key === "Escape" && $("#jobDrawer").classList.contains("open")) closeDrawer();
  });

  $("#adminButton").addEventListener("click", () => { $("#adminDialog").showModal(); state.adminToken ? showAdminView() : showLoginView(); });
  $("#closeAdmin").addEventListener("click", () => $("#adminDialog").close());
  $("#togglePassword").addEventListener("click", () => {
    const input = $("#passwordInput");
    input.type = input.type === "password" ? "text" : "password";
    $("#togglePassword").textContent = input.type === "password" ? "Show" : "Hide";
  });
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#loginError").textContent = "";
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const response = await fetch("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: $("#passwordInput").value }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not sign in");
      state.adminToken = payload.token;
      await showAdminView();
    } catch (error) { $("#loginError").textContent = error.message; }
    finally { button.disabled = false; }
  });
  $("#logoutButton").addEventListener("click", () => { state.adminToken = null; clearTimeout(state.crawlPoll); showLoginView(); });
  $("#sourceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#sourceError").textContent = "";
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      await adminFetch("/api/admin/sources", { method: "POST", body: JSON.stringify({ company: $("#companyInput").value, url: $("#urlInput").value }) });
      event.currentTarget.reset();
      await loadSources();
      showToast("Career source added");
    } catch (error) { $("#sourceError").textContent = error.message; }
    finally { button.disabled = false; }
  });
  $("#runCrawlerButton").addEventListener("click", async () => {
    try {
      await adminFetch("/api/admin/crawl", { method: "POST", body: "{}" });
      showToast("Crawler started");
      refreshCrawlStatus();
    } catch (error) { showToast(error.message); }
  });
}

bindEvents();
loadJobs();
