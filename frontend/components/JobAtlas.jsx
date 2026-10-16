"use client";

import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  BriefcaseBusiness,
  Building2,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Database,
  ExternalLink,
  Filter,
  Globe2,
  KeyRound,
  Layers3,
  List,
  LoaderCircle,
  LockKeyhole,
  Map,
  MapPin,
  Menu,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Logo } from "./Logo";

const JobsMap = dynamic(() => import("./JobsMap"), {
  ssr: false,
  loading: () => <div className="map-loading"><LoaderCircle className="spin" size={22} />Preparing the map</div>,
});

const emptyFilters = {
  company: "",
  location: [],
  domain: "",
  employmentType: "",
  workplaceType: "",
  fresher: false,
};

function formatLabel(value) {
  if (!value) return "Not specified";
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relativeDate(value) {
  if (!value) return "Recently added";
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(value));
}

function companyTone(company = "") {
  const tones = ["plum", "mint", "amber", "blue", "coral"];
  return tones[[...company].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % tones.length];
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Something went wrong.");
  return payload;
}

function FilterSelect({ icon: Icon, label, value, options, onChange }) {
  return (
    <label className="filter-control">
      <span><Icon size={15} />{label}</span>
      <div className="select-wrap">
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">All {label.toLowerCase()}</option>
          {options.map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}
        </select>
        <ChevronDown size={15} />
      </div>
    </label>
  );
}

function LocationFilter({ options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = options.filter((option) => option.toLowerCase().includes(query.toLowerCase()));

  function toggle(option) {
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option]);
  }

  return (
    <div className="filter-control location-filter">
      <span><MapPin size={15} />Location</span>
      <button className="multi-select-trigger" onClick={() => setOpen(!open)}>
        <span>{value.length ? `${value.length} selected` : "All locations"}</span><ChevronDown size={15} />
      </button>
      {open && (
        <div className="multi-select-menu">
          <div className="mini-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search locations" autoFocus /></div>
          <div className="multi-options">
            {matches.map((option) => <button key={option} onClick={() => toggle(option)}><i className={value.includes(option) ? "checked" : ""}>{value.includes(option) && <Check size={11} />}</i><span>{option}</span></button>)}
          </div>
        </div>
      )}
    </div>
  );
}

function JobCard({ job, active, saved, onOpen, onSave }) {
  return (
    <article className={`job-card ${active ? "active" : ""}`} onClick={onOpen} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onOpen()}>
      <div className={`company-avatar ${companyTone(job.companyName)}`}>{job.companyName.slice(0, 2).toUpperCase()}</div>
      <div className="job-card-main">
        <div className="job-card-topline">
          <span>{job.companyName}</span>
          <button className="icon-button subtle" onClick={(event) => { event.stopPropagation(); onSave(); }} aria-label={saved ? "Remove saved job" : "Save job"}>
            {saved ? <BookmarkCheck size={18} /> : <Bookmark size={18} />}
          </button>
        </div>
        <h3>{job.title}</h3>
        <div className="job-meta">
          <span><MapPin size={14} />{job.city || job.fullLocationText}</span>
          <span><BriefcaseBusiness size={14} />{formatLabel(job.employmentType || job.workplaceType)}</span>
        </div>
        <p>{job.summary || job.description}</p>
        <div className="job-card-footer">
          <div className="tag-row">
            {(job.skills || []).slice(0, 2).map((skill) => <span className="tag" key={skill}>{skill}</span>)}
            {!job.skills?.length && job.domain && <span className="tag">{formatLabel(job.domain)}</span>}
          </div>
          <span className="posted"><Clock3 size={13} />{relativeDate(job.datePosted)}</span>
        </div>
      </div>
    </article>
  );
}

function JobDetail({ job, saved, onSave, onClose }) {
  if (!job) {
    return (
      <div className="detail-empty">
        <span><Layers3 size={24} /></span>
        <h3>Select a role to inspect</h3>
        <p>Everything you need to decide, in one calm view.</p>
      </div>
    );
  }

  const experience = job.minExperience == null && job.maxExperience == null
    ? "Not specified"
    : `${job.minExperience ?? 0}${job.maxExperience != null ? `–${job.maxExperience}` : "+"} years`;

  return (
    <div className="detail-inner">
      <button className="mobile-back" onClick={onClose}><ArrowLeft size={17} />Back to roles</button>
      <div className="detail-head">
        <div className={`company-avatar large ${companyTone(job.companyName)}`}>{job.companyName.slice(0, 2).toUpperCase()}</div>
        <div className="detail-actions">
          <button className={`save-button ${saved ? "saved" : ""}`} onClick={onSave}>
            {saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}{saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
      <span className="detail-company">{job.companyName}</span>
      <h2>{job.title}</h2>
      <div className="detail-location"><MapPin size={16} />{job.fullLocationText}</div>
      <div className="detail-facts">
        <div><span>Experience</span><strong>{experience}</strong></div>
        <div><span>Work type</span><strong>{formatLabel(job.employmentType || job.workplaceType)}</strong></div>
        <div><span>Posted</span><strong>{relativeDate(job.datePosted)}</strong></div>
      </div>
      <a className="primary-button apply-button" href={job.applicationUrl} target="_blank" rel="noreferrer">
        Apply on company site <ExternalLink size={17} />
      </a>
      <section className="detail-section">
        <div className="section-kicker"><span />About the role</div>
        <p>{job.description}</p>
      </section>
      {!!job.skills?.length && (
        <section className="detail-section">
          <div className="section-kicker"><span />Skills that matter</div>
          <div className="skills-grid">{job.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
        </section>
      )}
      {!!job.responsibilities?.length && (
        <section className="detail-section">
          <div className="section-kicker"><span />What you’ll do</div>
          <ul>{job.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      )}
      <div className="source-note"><Globe2 size={15} />Verified from the company’s career source</div>
    </div>
  );
}

function AdminPanel({ open, onClose }) {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState([]);
  const [run, setRun] = useState(null);
  const [form, setForm] = useState({ company: "", url: "" });

  useEffect(() => {
    setToken(sessionStorage.getItem("jobatlas-admin-token") || "");
  }, []);

  const authorizedFetch = useCallback(async (url, options = {}) => {
    return fetchJson(url, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [sourceData, runData] = await Promise.all([
        authorizedFetch("/api/admin/sources"),
        authorizedFetch("/api/admin/crawl"),
      ]);
      setSources(sourceData.sources);
      setRun(runData.run);
      setError("");
    } catch (requestError) {
      if (requestError.message.includes("expired")) {
        sessionStorage.removeItem("jobatlas-admin-token");
        setToken("");
      }
      setError(requestError.message);
    }
  }, [authorizedFetch, token]);

  useEffect(() => { if (open) refresh(); }, [open, refresh]);
  useEffect(() => {
    if (run?.state !== "running") return undefined;
    const interval = setInterval(refresh, 2500);
    return () => clearInterval(interval);
  }, [refresh, run?.state]);

  async function login(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await fetchJson("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      sessionStorage.setItem("jobatlas-admin-token", data.token);
      setToken(data.token);
      setPassword("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function addSource(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await authorizedFetch("/api/admin/sources", { method: "POST", body: JSON.stringify(form) });
      setForm({ company: "", url: "" });
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function startCrawl() {
    setLoading(true);
    setError("");
    try {
      const data = await authorizedFetch("/api/admin/crawl", { method: "POST" });
      setRun(data.run);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`drawer-layer ${open ? "open" : ""}`} aria-hidden={!open}>
      <button className="drawer-scrim" onClick={onClose} aria-label="Close admin panel" />
      <aside className="admin-drawer">
        <div className="drawer-head">
          <div><span className="eyebrow">Operations</span><h2>Admin console</h2></div>
          <button className="icon-button" onClick={onClose}><X size={20} /></button>
        </div>
        {!token ? (
          <form className="login-panel" onSubmit={login}>
            <span className="admin-icon"><LockKeyhole size={23} /></span>
            <h3>Protected workspace</h3>
            <p>Sign in to manage sources and refresh the job index.</p>
            <label><span>Admin password</span><div className="field-with-icon"><KeyRound size={16} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter password" required /></div></label>
            {error && <div className="form-error"><CircleAlert size={15} />{error}</div>}
            <button className="primary-button" disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : null}Unlock console</button>
          </form>
        ) : (
          <div className="admin-content">
            {error && <div className="form-error"><CircleAlert size={15} />{error}</div>}
            <section className="crawl-card">
              <div className="crawl-card-top"><div><span className="eyebrow">Crawler status</span><h3>{formatLabel(run?.state || "Ready")}</h3></div><span className={`status-dot ${run?.state || "idle"}`} /></div>
              <p>{run?.state === "running" ? "Discovering and normalizing live career listings." : run?.finishedAt ? `Last finished ${relativeDate(run.finishedAt)} · ${run.importedJobs || 0} records synced.` : "Start a refresh when you’re ready."}</p>
              <button className="primary-button" onClick={startCrawl} disabled={loading || run?.state === "running"}>
                {run?.state === "running" ? <><LoaderCircle className="spin" size={17} />Crawling now</> : <><Play size={17} fill="currentColor" />Start new crawl</>}
              </button>
              {!!run?.logs?.length && <pre className="crawl-log">{run.logs.slice(-8).join("\n")}</pre>}
            </section>
            <section className="source-section">
              <div className="admin-section-title"><div><span className="eyebrow">Coverage</span><h3>Career sources</h3></div><span>{sources.length}</span></div>
              <form className="source-form" onSubmit={addSource}>
                <input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Company name" required />
                <input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://company.com/careers" required />
                <button className="secondary-button" disabled={loading}><Plus size={17} />Add source</button>
              </form>
              <div className="source-list">
                {sources.map((source) => <div className="source-row" key={source.id}><span className={`company-avatar tiny ${companyTone(source.company)}`}>{source.company.slice(0, 2).toUpperCase()}</span><div><strong>{source.company}</strong><small>{new URL(source.url).hostname}</small></div><Check size={16} /></div>)}
              </div>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

export function JobAtlas() {
  const [jobs, setJobs] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [filterOptions, setFilterOptions] = useState({ companies: [], locations: [], domains: [], employmentTypes: [], workplaceTypes: [] });
  const [stats, setStats] = useState({ totalJobs: 0, companies: 0, cities: 0, recentJobs: 0 });
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [saved, setSaved] = useState(new Set());
  const [view, setView] = useState("explore");
  const [resultView, setResultView] = useState("list");
  const [currentPage, setCurrentPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    try { setSaved(new Set(JSON.parse(localStorage.getItem("jobatlas-saved") || "[]"))); } catch { /* Ignore malformed local data. */ }
    Promise.all([fetchJson("/api/filters"), fetchJson("/api/stats")])
      .then(([options, summary]) => { setFilterOptions(options); setStats(summary); })
      .catch(() => {});
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: "200" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    Object.entries(filters).forEach(([key, value]) => {
      if (Array.isArray(value) && value.length) params.set(key, value.join(","));
      else if (value) params.set(key, String(value));
    });
    try {
      const data = await fetchJson(`/api/jobs?${params}`);
      setJobs(data.jobs);
      setSelectedJob((current) => data.jobs.find((job) => job.id === current?.id) || data.jobs[0] || null);
    } catch (requestError) {
      setError(requestError.message);
      setJobs([]);
      setSelectedJob(null);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, filters]);

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, filters, view]);

  const visibleJobs = useMemo(() => view === "saved" ? jobs.filter((job) => saved.has(job.id)) : jobs, [jobs, saved, view]);
  const pageCount = Math.max(1, Math.ceil(visibleJobs.length / 10));
  const paginatedJobs = visibleJobs.slice((currentPage - 1) * 10, currentPage * 10);
  const pageNumbers = Array.from({ length: pageCount }, (_, index) => index + 1);
  const activeFilterCount = Object.values(filters).filter((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;

  function toggleSaved(id) {
    setSaved((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("jobatlas-saved", JSON.stringify([...next]));
      return next;
    });
  }

  return (
    <main>
      <header className="topbar">
        <Logo />
        <nav className="desktop-nav" aria-label="Primary navigation">
          <button className={view === "explore" ? "active" : ""} onClick={() => setView("explore")}>Explore roles</button>
          <button className={view === "saved" ? "active" : ""} onClick={() => setView("saved")}>Saved <span>{saved.size}</span></button>
        </nav>
        <div className="header-actions">
          <span className="live-indicator"><i />Index online</span>
          <button className="admin-button" onClick={() => setAdminOpen(true)}><Settings2 size={16} /><span>Admin</span></button>
          <button className="mobile-menu" onClick={() => setFiltersOpen(true)}><Menu size={20} /></button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><Sparkles size={14} />Curated from company career pages</span>
          <h1>Find work that<br /><em>moves you forward.</em></h1>
          <p>One focused place to explore high-intent roles, compare the details, and make your next move with confidence.</p>
        </div>
        <div className="hero-side">
          <div className="metric-feature"><span>{stats.totalJobs}</span><p>live opportunities,<br />cleaned and ready.</p></div>
          <div className="hero-orbit"><span>{stats.companies}</span><small>companies</small></div>
        </div>
        <div className="search-shell">
          <div className="search-field">
            <Search size={21} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by role, skill, or company" aria-label="Search jobs" />
            {search && <button className="clear-search" onClick={() => setSearch("")} aria-label="Clear search"><X size={16} /></button>}
          </div>
          <button className="search-button">Search roles <ArrowRight size={17} /></button>
        </div>
      </section>

      <section className="workspace">
        <aside className={`filters-panel ${filtersOpen ? "mobile-open" : ""}`}>
          <div className="mobile-filter-head"><Logo compact /><strong>Filters</strong><button className="icon-button" onClick={() => setFiltersOpen(false)}><X size={19} /></button></div>
          <div className="filters-head"><div><Filter size={16} />Filters</div>{activeFilterCount > 0 && <button onClick={() => setFilters(emptyFilters)}>Clear all</button>}</div>
          <FilterSelect icon={Building2} label="Company" value={filters.company} options={filterOptions.companies} onChange={(company) => setFilters({ ...filters, company })} />
          <LocationFilter options={filterOptions.locations} value={filters.location} onChange={(location) => setFilters({ ...filters, location })} />
          <FilterSelect icon={Layers3} label="Function" value={filters.domain} options={filterOptions.domains} onChange={(domain) => setFilters({ ...filters, domain })} />
          <FilterSelect icon={BriefcaseBusiness} label="Job type" value={filters.employmentType} options={filterOptions.employmentTypes} onChange={(employmentType) => setFilters({ ...filters, employmentType })} />
          <FilterSelect icon={Globe2} label="Work style" value={filters.workplaceType} options={filterOptions.workplaceTypes} onChange={(workplaceType) => setFilters({ ...filters, workplaceType })} />
          <label className="check-filter"><button className={filters.fresher ? "checked" : ""} onClick={() => setFilters({ ...filters, fresher: !filters.fresher })}>{filters.fresher && <Check size={13} />}</button><span><strong>Early career</strong><small>0 years experience</small></span></label>
          <div className="index-card"><div><Database size={17} /><span>Source-first data</span></div><p>Every role links directly to its original career page.</p></div>
          <button className="mobile-apply" onClick={() => setFiltersOpen(false)}>Show {jobs.length} roles</button>
        </aside>

        <section className="results-panel">
          <div className="results-toolbar">
            <div><span className="eyebrow">{view === "saved" ? "Your shortlist" : "Opportunities"}</span><h2>{view === "saved" ? `${visibleJobs.length} saved roles` : `${jobs.length} roles for you`}</h2></div>
            <div className="toolbar-actions">
              <div className="view-toggle" aria-label="Results view">
                <button className={resultView === "list" ? "active" : ""} onClick={() => setResultView("list")} aria-label="List view"><List size={15} /></button>
                <button className={resultView === "map" ? "active" : ""} onClick={() => setResultView("map")} aria-label="Map view"><Map size={15} /></button>
              </div>
              <button className="filter-mobile-button" onClick={() => setFiltersOpen(true)}><Filter size={16} />Filters{activeFilterCount > 0 && <span>{activeFilterCount}</span>}</button>
              <button className="refresh-button" onClick={loadJobs}><RefreshCw size={15} />Refresh</button>
            </div>
          </div>
          <div className="result-scroll">
            {loading ? (
              <div className="loading-list">{[1, 2, 3].map((item) => <div className="job-skeleton" key={item}><span /><div><i /><i /><i /></div></div>)}</div>
            ) : error ? (
              <div className="empty-state"><span><CircleAlert size={22} /></span><h3>We couldn’t reach the job index</h3><p>{error}</p><button className="secondary-button" onClick={loadJobs}>Try again</button></div>
            ) : !visibleJobs.length ? (
              <div className="empty-state"><span><Search size={22} /></span><h3>{view === "saved" ? "Your shortlist is empty" : "No exact matches yet"}</h3><p>{view === "saved" ? "Save promising roles and they’ll wait here for you." : "Try clearing a filter or using a broader search."}</p>{view === "saved" ? <button className="secondary-button" onClick={() => setView("explore")}>Explore roles</button> : <button className="secondary-button" onClick={() => { setFilters(emptyFilters); setSearch(""); }}>Reset search</button>}</div>
            ) : resultView === "map" ? (
              <JobsMap jobs={visibleJobs} selectedId={selectedJob?.id} onSelect={(job) => { setSelectedJob(job); setDetailOpen(true); }} />
            ) : (
              <>
                {paginatedJobs.map((job) => <JobCard key={job.id} job={job} active={selectedJob?.id === job.id} saved={saved.has(job.id)} onOpen={() => { setSelectedJob(job); setDetailOpen(true); }} onSave={() => toggleSaved(job.id)} />)}
                {pageCount > 1 && <nav className="pagination" aria-label="Job result pages"><button disabled={currentPage === 1} onClick={() => setCurrentPage((page) => page - 1)}><ArrowLeft size={14} /></button>{pageNumbers.map((page) => <button className={page === currentPage ? "active" : ""} key={page} onClick={() => setCurrentPage(page)}>{page}</button>)}<button disabled={currentPage === pageCount} onClick={() => setCurrentPage((page) => page + 1)}><ArrowRight size={14} /></button></nav>}
              </>
            )}
          </div>
        </section>

        <aside className={`detail-panel ${detailOpen ? "mobile-visible" : ""}`}>
          <JobDetail job={selectedJob} saved={saved.has(selectedJob?.id)} onSave={() => selectedJob && toggleSaved(selectedJob.id)} onClose={() => setDetailOpen(false)} />
        </aside>
      </section>

      <footer><Logo /><p>Career intelligence, minus the noise.</p><span>Built for focused job seekers.</span></footer>
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />
    </main>
  );
}
