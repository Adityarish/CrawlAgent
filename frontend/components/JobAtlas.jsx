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
  FileSpreadsheet,
  Filter,
  Globe2,
  KeyRound,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Map,
  MapPin,
  Menu,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  SkipForward,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Logo } from "./Logo";
import { groupJobsByLocation } from "../lib/jobLocations";

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

const emptyMapFilters = {
  company: "",
  domain: "",
  employmentType: "",
  workplaceType: "",
  fresher: false,
};

function formatLabel(value) {
  if (!value) return "Not specified";
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function uniqueValues(items, field) {
  return [...new Set(items.map((item) => item[field]).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
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
  const [companySearch, setCompanySearch] = useState("");
  const [workingCompany, setWorkingCompany] = useState("");
  const [run, setRun] = useState(null);
  const [form, setForm] = useState({ company: "", url: "" });
  const [uploadReport, setUploadReport] = useState(null);

  const companyGroups = useMemo(() => {
    const groups = new globalThis.Map();
    sources.forEach((source) => {
      const key = source.company.trim().replace(/\s+/g, " ").toLocaleLowerCase();
      if (!groups.has(key)) groups.set(key, { key, company: source.company.trim(), sources: [] });
      groups.get(key).sources.push(source);
    });
    return [...groups.values()].map((group) => ({
      ...group,
      paused: group.sources.every((source) => source.active === false),
    }));
  }, [sources]);

  const visibleCompanyGroups = useMemo(() => {
    const query = companySearch.trim().toLocaleLowerCase();
    return companyGroups.filter((group) => !query || group.company.toLocaleLowerCase().includes(query));
  }, [companyGroups, companySearch]);

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

  async function uploadSources(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLoading(true);
    setError("");
    setUploadReport(null);
    try {
      if (file.size > 2_800_000) throw new Error("Choose a file smaller than 2.8 MB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const chunkSize = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
      }
      const data = btoa(binary);
      const report = await authorizedFetch("/api/admin/sources/upload", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, data }),
      });
      setUploadReport(report);
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

  async function skipCurrentSource() {
    setLoading(true);
    setError("");
    try {
      const data = await authorizedFetch("/api/admin/crawl/skip", { method: "POST" });
      setRun(data.run);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }

  async function recrawlCompany(company) {
    setWorkingCompany(company);
    setError("");
    try {
      const data = await authorizedFetch("/api/admin/crawl/company", {
        method: "POST",
        body: JSON.stringify({ company }),
      });
      setRun(data.run);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorkingCompany("");
    }
  }

  async function setCompanyPaused(company, paused) {
    setWorkingCompany(company);
    setError("");
    try {
      await authorizedFetch("/api/admin/companies/pause", {
        method: "POST",
        body: JSON.stringify({ company, paused }),
      });
      await refresh();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorkingCompany("");
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
              {run?.state === "running" && (
                <button className="skip-button" onClick={skipCurrentSource} disabled={loading}>
                  <SkipForward size={16} />Skip current company
                </button>
              )}
              {!!run?.logs?.length && <pre className="crawl-log">{run.logs.slice(-8).join("\n")}</pre>}
            </section>
            <section className="source-section">
              <div className="admin-section-title"><div><span className="eyebrow">Coverage</span><h3>Career sources</h3></div><span>{companyGroups.length}</span></div>
              <form className="source-form" onSubmit={addSource}>
                <input value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} placeholder="Company name" required />
                <input type="url" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://company.com/careers" required />
                <button className="secondary-button" disabled={loading}><Plus size={17} />Add source</button>
              </form>
              <div className="source-upload" aria-labelledby="source-upload-title">
                <div className="upload-copy"><FileSpreadsheet size={19} /><div><strong id="source-upload-title">Import CSV or Excel</strong><small>Upload Company and Link columns in one batch</small></div></div>
                <label className={`primary-button upload-button ${loading ? "disabled" : ""}`} htmlFor="source-file-upload">
                  <Upload size={16} />{loading ? "Importing…" : "Upload file"}
                  <input id="source-file-upload" type="file" accept=".csv,.xls,.xlsx,.xlsm,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={uploadSources} disabled={loading} />
                </label>
                <small className="upload-hint">First worksheet · up to 2.8 MB</small>
                {uploadReport && <div className="upload-report"><Check size={15} /><span>Added {uploadReport.added} of {uploadReport.totalRows} sources to MongoDB and the crawler list.{uploadReport.skipped.length > 0 && <small>{uploadReport.skipped.length} skipped: {uploadReport.skipped.slice(0, 3).map((item) => `row ${item.row}: ${item.reason}`).join("; ")}{uploadReport.skipped.length > 3 ? "; …" : ""}</small>}</span></div>}
              </div>
              <label className="company-search"><Search size={15} /><input value={companySearch} onChange={(event) => setCompanySearch(event.target.value)} placeholder="Search companies" aria-label="Search companies" /></label>
              <div className="source-list">
                {visibleCompanyGroups.map((group) => <div className="source-row" key={group.key}>
                  <span className={`company-avatar tiny ${companyTone(group.company)}`}>{group.company.slice(0, 2).toUpperCase()}</span>
                  <div className="company-copy"><strong>{group.company}</strong><small>{group.paused ? "Paused" : "Active"} · {group.sources.length} {group.sources.length === 1 ? "source" : "sources"}</small></div>
                  <div className="company-actions">
                    <button className="company-action recrawl" onClick={() => recrawlCompany(group.company)} disabled={loading || !!workingCompany || run?.state === "running"} title={`Recrawl ${group.company}`} aria-label={`Recrawl ${group.company}`}>
                      {workingCompany === group.company ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}<span>Recrawl</span>
                    </button>
                    <button className={`company-action ${group.paused ? "resume" : "pause"}`} onClick={() => setCompanyPaused(group.company, !group.paused)} disabled={loading || !!workingCompany} title={`${group.paused ? "Resume" : "Pause"} ${group.company}`} aria-label={`${group.paused ? "Resume" : "Pause"} ${group.company}`}>
                      {group.paused ? <Play size={13} /> : <Pause size={13} />}<span>{group.paused ? "Resume" : "Pause"}</span>
                    </button>
                  </div>
                </div>)}
                {!visibleCompanyGroups.length && <p className="source-empty">No companies match that search.</p>}
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
  const [crawlActive, setCrawlActive] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedJob, setSelectedJob] = useState(null);
  const [saved, setSaved] = useState(new Set());
  const [view, setView] = useState("explore");
  const [currentPage, setCurrentPage] = useState(1);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [mapJobs, setMapJobs] = useState([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState("");
  const [mapSearch, setMapSearch] = useState("");
  const [selectedMapLocation, setSelectedMapLocation] = useState("");
  const [mapFilters, setMapFilters] = useState(emptyMapFilters);

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

  const loadJobs = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    if (!quiet) setError("");
    const params = new URLSearchParams({ limit: "200" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    Object.entries(filters).forEach(([key, value]) => {
      if (Array.isArray(value) && value.length) params.set(key, value.join(","));
      else if (value) params.set(key, String(value));
    });
    try {
      const allJobs = [];
      let page = 1;
      let pages = 1;
      do {
        params.set("page", String(page));
        const data = await fetchJson(`/api/jobs?${params}`);
        allJobs.push(...data.jobs);
        pages = data.pages;
        page += 1;
      } while (page <= pages);
      setJobs(allJobs);
      setSelectedJob((current) => allJobs.find((job) => job.id === current?.id) || allJobs[0] || null);
    } catch (requestError) {
      if (!quiet) {
        setError(requestError.message);
        setJobs([]);
        setSelectedJob(null);
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [debouncedSearch, filters]);

  useEffect(() => { loadJobs(); }, [loadJobs]);
  useEffect(() => { setCurrentPage(1); }, [debouncedSearch, filters, view]);

  const loadMapJobs = useCallback(async (quiet = false) => {
    if (!quiet) setMapLoading(true);
    if (!quiet) setMapError("");
    try {
      const allJobs = [];
      let page = 1;
      let pages = 1;
      do {
        const data = await fetchJson(`/api/jobs?limit=200&page=${page}`);
        allJobs.push(...data.jobs);
        pages = data.pages;
        page += 1;
      } while (page <= pages);
      setMapJobs(allJobs);
    } catch (requestError) {
      if (!quiet) {
        setMapError(requestError.message);
        setMapJobs([]);
      }
    } finally {
      setMapLoaded(true);
      if (!quiet) setMapLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "map" && !mapLoaded) loadMapJobs();
  }, [loadMapJobs, mapLoaded, view]);

  useEffect(() => {
    let stopped = false;
    const refreshWhileCrawling = async () => {
      try {
        const status = await fetchJson("/api/crawl/status");
        if (stopped) return;
        const active = status.state === "running";
        setCrawlActive(active);
        if (!active) return;
        const [options, summary] = await Promise.all([
          fetchJson("/api/filters"),
          fetchJson("/api/stats"),
          loadJobs(true),
          view === "map" && mapLoaded ? loadMapJobs(true) : Promise.resolve(),
        ]);
        if (!stopped) {
          setFilterOptions(options);
          setStats(summary);
        }
      } catch {
        // Keep the last good feed visible if a background refresh briefly fails.
      }
    };
    refreshWhileCrawling();
    const interval = setInterval(refreshWhileCrawling, crawlActive ? 4000 : 2500);
    return () => { stopped = true; clearInterval(interval); };
  }, [crawlActive, loadJobs, loadMapJobs, mapLoaded, view]);

  const visibleJobs = useMemo(() => view === "saved" ? jobs.filter((job) => saved.has(job.id)) : jobs, [jobs, saved, view]);
  const pageCount = Math.max(1, Math.ceil(visibleJobs.length / 10));
  const paginatedJobs = visibleJobs.slice((currentPage - 1) * 10, currentPage * 10);
  const activeFilterCount = Object.values(filters).filter((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;
  const searchedMapJobs = useMemo(() => {
    const query = mapSearch.trim().toLowerCase();
    if (!query) return mapJobs;
    return mapJobs.filter((job) => [job.title, job.companyName, job.city, job.fullLocationText, ...(job.skills || [])]
      .some((value) => String(value || "").toLowerCase().includes(query)));
  }, [mapJobs, mapSearch]);
  const mapGroups = useMemo(() => groupJobsByLocation(searchedMapJobs), [searchedMapJobs]);
  const mappedMapJobCount = useMemo(() => new Set(mapGroups.flatMap((group) => group.jobs.map((job) => job.id))).size, [mapGroups]);
  const unmappedMapJobCount = searchedMapJobs.length - mappedMapJobCount;
  const selectedMapGroup = mapGroups.find((group) => group.key === selectedMapLocation) || null;
  const mapFilterOptions = useMemo(() => {
    const locationJobs = selectedMapGroup?.jobs || [];
    return {
      companies: uniqueValues(locationJobs, "companyName"),
      domains: uniqueValues(locationJobs, "domain"),
      employmentTypes: uniqueValues(locationJobs, "employmentType"),
      workplaceTypes: uniqueValues(locationJobs, "workplaceType"),
    };
  }, [selectedMapGroup]);
  const filteredMapJobs = useMemo(() => (selectedMapGroup?.jobs || []).filter((job) => (
    (!mapFilters.company || job.companyName === mapFilters.company)
    && (!mapFilters.domain || job.domain === mapFilters.domain)
    && (!mapFilters.employmentType || job.employmentType === mapFilters.employmentType)
    && (!mapFilters.workplaceType || job.workplaceType === mapFilters.workplaceType)
    && (!mapFilters.fresher || job.fresherEligible === true || job.minExperience === 0)
  )), [mapFilters, selectedMapGroup]);
  const activeMapFilterCount = Object.values(mapFilters).filter(Boolean).length;

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
          <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}><Map size={14} />Map view</button>
          <button className={view === "saved" ? "active" : ""} onClick={() => setView("saved")}>Saved <span>{saved.size}</span></button>
        </nav>
        <div className="header-actions">
          <span className="live-indicator"><i />Index online</span>
          <button className="admin-button" onClick={() => setAdminOpen(true)}><Settings2 size={16} /><span>Admin</span></button>
          {view !== "map" && <button className="mobile-menu" onClick={() => setFiltersOpen(true)}><Menu size={20} /></button>}
        </div>
      </header>

      <nav className="mobile-nav-tabs" aria-label="Mobile navigation">
        <button className={view === "explore" ? "active" : ""} onClick={() => setView("explore")}>Explore</button>
        <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}><Map size={14} />Map view</button>
        <button className={view === "saved" ? "active" : ""} onClick={() => setView("saved")}>Saved <span>{saved.size}</span></button>
      </nav>

      {view === "map" ? (
        <section className="map-page" aria-label="Job map">
          <div className="map-page-toolbar">
            <div className="map-page-heading">
              <span className="eyebrow"><MapPin size={13} />Location explorer</span>
              <h1>Find your next role on the map</h1>
              <p>{mappedMapJobCount} mapped roles across {mapGroups.length} districts{unmappedMapJobCount > 0 ? ` · ${unmappedMapJobCount} awaiting a district match` : ""}</p>
            </div>
            <div className="map-page-actions">
              <label className="map-search-field">
                <Search size={17} />
                <input value={mapSearch} onChange={(event) => { setMapSearch(event.target.value); setSelectedMapLocation(""); }} placeholder="Search roles or companies" />
                {mapSearch && <button onClick={() => setMapSearch("")} aria-label="Clear map search"><X size={15} /></button>}
              </label>
              <button className="map-refresh-button" onClick={loadMapJobs} disabled={mapLoading} aria-label="Refresh map jobs"><RefreshCw className={mapLoading ? "spin" : ""} size={17} /></button>
            </div>
          </div>

          <div className="map-stage">
            {mapLoading && !mapJobs.length ? (
              <div className="map-page-state"><LoaderCircle className="spin" size={24} /><span>Loading every opportunity</span></div>
            ) : mapError ? (
              <div className="map-page-state error"><CircleAlert size={24} /><strong>We couldn’t load the map</strong><span>{mapError}</span><button className="secondary-button" onClick={loadMapJobs}>Try again</button></div>
            ) : !searchedMapJobs.length ? (
              <div className="map-page-state"><Search size={24} /><strong>No map matches</strong><span>Try a broader role, skill, or company.</span><button className="secondary-button" onClick={() => setMapSearch("")}>Clear search</button></div>
            ) : !mapGroups.length ? (
              <div className="map-page-state"><MapPin size={24} /><strong>No district matches yet</strong><span>These roles do not contain a district found in District.csv.</span></div>
            ) : (
              <JobsMap
                jobs={searchedMapJobs}
                selectedLocation={selectedMapLocation}
                onSelectGroup={(group) => { setSelectedMapLocation(group.key); setMapFilters(emptyMapFilters); }}
                full
              />
            )}

            <aside className={`map-jobs-drawer ${selectedMapGroup ? "open" : ""}`} aria-hidden={!selectedMapGroup}>
              <div className="map-drawer-head">
                <div><span className="eyebrow">Available in</span><h2>{selectedMapGroup?.label}</h2><p>{filteredMapJobs.length}{activeMapFilterCount ? ` of ${selectedMapGroup?.jobs.length || 0}` : ""} {filteredMapJobs.length === 1 ? "opportunity" : "opportunities"}</p></div>
                <button className="icon-button" onClick={() => { setSelectedMapLocation(""); setMapFilters(emptyMapFilters); }} aria-label="Close location jobs"><X size={19} /></button>
              </div>
              <div className="map-drawer-filters">
                <div className="map-filter-title">
                  <span><Filter size={14} />Filter this location{activeMapFilterCount > 0 && <b>{activeMapFilterCount}</b>}</span>
                  {activeMapFilterCount > 0 && <button onClick={() => setMapFilters(emptyMapFilters)}>Clear</button>}
                </div>
                <div className="map-filter-grid">
                  <label><span>Company</span><select value={mapFilters.company} onChange={(event) => setMapFilters({ ...mapFilters, company: event.target.value })}><option value="">All companies</option>{mapFilterOptions.companies.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                  <label><span>Function</span><select value={mapFilters.domain} onChange={(event) => setMapFilters({ ...mapFilters, domain: event.target.value })}><option value="">All functions</option>{mapFilterOptions.domains.map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}</select></label>
                  <label><span>Job type</span><select value={mapFilters.employmentType} onChange={(event) => setMapFilters({ ...mapFilters, employmentType: event.target.value })}><option value="">All job types</option>{mapFilterOptions.employmentTypes.map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}</select></label>
                  <label><span>Work style</span><select value={mapFilters.workplaceType} onChange={(event) => setMapFilters({ ...mapFilters, workplaceType: event.target.value })}><option value="">All work styles</option>{mapFilterOptions.workplaceTypes.map((option) => <option key={option} value={option}>{formatLabel(option)}</option>)}</select></label>
                </div>
                <label className="map-fresher-filter"><input type="checkbox" checked={mapFilters.fresher} onChange={(event) => setMapFilters({ ...mapFilters, fresher: event.target.checked })} /><span><Check size={11} /></span>Early-career roles</label>
              </div>
              <div className="map-drawer-list">
                {filteredMapJobs.map((job) => (
                  <article className="map-job-card" key={job.id}>
                    <div className={`company-avatar ${companyTone(job.companyName)}`}>{job.companyName.slice(0, 2).toUpperCase()}</div>
                    <div className="map-job-copy">
                      <div className="map-job-company"><span>{job.companyName}</span><button onClick={() => toggleSaved(job.id)} aria-label={saved.has(job.id) ? "Remove saved job" : "Save job"}>{saved.has(job.id) ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}</button></div>
                      <h3>{job.title}</h3>
                      <p><MapPin size={13} />{job.fullLocationText || job.city}</p>
                      <div><span>{formatLabel(job.domain || job.workplaceType)}</span><span>{relativeDate(job.datePosted)}</span></div>
                      <a href={job.applicationUrl} target="_blank" rel="noreferrer">View role <ArrowRight size={14} /></a>
                    </div>
                  </article>
                ))}
                {selectedMapGroup && !filteredMapJobs.length && <div className="map-filter-empty"><Search size={20} /><strong>No roles match</strong><span>Clear a filter to see more jobs in this location.</span><button onClick={() => setMapFilters(emptyMapFilters)}>Clear filters</button></div>}
              </div>
            </aside>
          </div>
        </section>
      ) : (
        <>

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
      </section>

      <div className="search-rail">
        <div className="search-shell">
          <div className="search-field">
            <Search size={21} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by role, skill, or company" aria-label="Search jobs" />
            {search && <button className="clear-search" onClick={() => setSearch("")} aria-label="Clear search"><X size={16} /></button>}
          </div>
          <button className="search-button">Search roles <ArrowRight size={17} /></button>
        </div>
      </div>

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
            ) : (
              <>
                {paginatedJobs.map((job) => <JobCard key={job.id} job={job} active={selectedJob?.id === job.id} saved={saved.has(job.id)} onOpen={() => { setSelectedJob(job); setDetailOpen(true); }} onSave={() => toggleSaved(job.id)} />)}
                {pageCount > 1 && <nav className="pagination" aria-label="Job result pages"><button className="pagination-step" aria-label="Previous page" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => page - 1)}>&lt;&lt;</button><span className="pagination-count" aria-live="polite">{currentPage} of {pageCount}</span><button className="pagination-step" aria-label="Next page" disabled={currentPage === pageCount} onClick={() => setCurrentPage((page) => page + 1)}>&gt;&gt;</button></nav>}
              </>
            )}
          </div>
        </section>

        <aside className={`detail-panel ${detailOpen ? "mobile-visible" : ""}`}>
          <JobDetail job={selectedJob} saved={saved.has(selectedJob?.id)} onSave={() => selectedJob && toggleSaved(selectedJob.id)} onClose={() => setDetailOpen(false)} />
        </aside>
      </section>

      <footer><Logo /><p>Career intelligence, minus the noise.</p><span>Built for focused job seekers.</span></footer>
        </>
      )}
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />
    </main>
  );
}
