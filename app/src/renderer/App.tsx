import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleHelp,
  FileCode2,
  FolderOpen,
  FolderTree,
  Image,
  LayoutDashboard,
  Lightbulb,
  Music2,
  Package,
  Puzzle,
  RefreshCw,
  Save,
  ScanLine,
  Search,
  ShieldCheck,
  Trash2,
  Type,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import type {
  FileCollection,
  FileGroupKey,
  ProjectScanReport,
  StudioSnapshot,
  TruthItem,
  TruthKind,
} from "../shared/contracts";

type Area = "studio" | "project" | "builds";

const NAVIGATION: Array<{ id: Area; label: string; icon: LucideIcon }> = [
  { id: "studio", label: "Studio", icon: LayoutDashboard },
  { id: "project", label: "Project", icon: FolderTree },
  { id: "builds", label: "Builds", icon: Package },
];

const GROUP_LABELS: Record<FileGroupKey, { label: string; icon: LucideIcon }> = {
  scenes: { label: "Scenes", icon: Boxes },
  scripts: { label: "GDScript", icon: FileCode2 },
  images: { label: "Images & textures", icon: Image },
  audio: { label: "Audio", icon: Music2 },
  fonts: { label: "Fonts", icon: Type },
  resources: { label: "Resources & shaders", icon: Puzzle },
  models: { label: "3D assets", icon: Boxes },
  video: { label: "Video", icon: Image },
  translations: { label: "Translations", icon: Type },
  documents: { label: "Documents", icon: FileCode2 },
  otherRecognised: { label: "Other recognised", icon: Puzzle },
};

const TRUTH_META: Record<TruthKind, { label: string; icon: LucideIcon; description: string }> = {
  confirmed: { label: "Confirmed fact", icon: CheckCircle2, description: "Directly parsed or observed." },
  warning: { label: "Warning", icon: AlertTriangle, description: "A factual condition that deserves attention." },
  heuristic: { label: "Heuristic", icon: Lightbulb, description: "Useful interpretation, not established truth." },
  limitation: { label: "Limitation", icon: CircleHelp, description: "Something this read-only scan cannot establish." },
};

export function App(): JSX.Element {
  const [area, setArea] = useState<Area>("studio");
  const [snapshot, setSnapshot] = useState<StudioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trustDialogOpen, setTrustDialogOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [objective, setObjective] = useState("");
  const workspaceRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void window.studio.getSnapshot().then((result) => {
      if (result.ok) {
        applySnapshot(result.value);
        if (result.value.selectedProject && !result.value.selectedProject.trusted) setTrustDialogOpen(true);
      } else setError(result.error.message);
      setLoading(false);
    });
  }, []);

  function applySnapshot(value: StudioSnapshot): void {
    setSnapshot(value);
    setBrief(value.selectedProject?.gameBrief ?? "");
    setObjective(value.selectedProject?.currentObjective ?? "");
  }

  async function chooseProject(): Promise<void> {
    setBusy("Opening folder picker…");
    setError(null);
    const result = await window.studio.chooseProject();
    if (!result.ok) setError(result.error.message);
    else if (result.value) {
      applySnapshot(result.value);
      setTrustDialogOpen(Boolean(result.value.selectedProject && !result.value.selectedProject.trusted));
      setArea("studio");
    }
    setBusy(null);
  }

  async function trustProject(): Promise<void> {
    setBusy("Scanning trusted project…");
    setError(null);
    const pending = window.studio.trustSelectedProject();
    setTrustDialogOpen(false);
    const result = await pending;
    if (result.ok) applySnapshot(result.value);
    else setError(result.error.message);
    setBusy(null);
  }

  async function removeTrust(): Promise<void> {
    setBusy("Removing stored trust…");
    const result = await window.studio.removeSelectedProjectTrust();
    if (result.ok) {
      applySnapshot(result.value);
      setTrustDialogOpen(false);
    } else setError(result.error.message);
    setBusy(null);
  }

  async function rescan(): Promise<void> {
    setBusy("Scanning project files…");
    setError(null);
    const result = await window.studio.rescanSelectedProject();
    if (result.ok) applySnapshot(result.value);
    else setError(result.error.message);
    setBusy(null);
  }

  async function cancelScan(): Promise<void> {
    const result = await window.studio.cancelScan();
    if (result.ok) applySnapshot(result.value);
    else setError(result.error.message);
  }

  async function saveNotes(): Promise<void> {
    setBusy("Saving to application data…");
    setError(null);
    const result = await window.studio.saveNotes({ gameBrief: brief, currentObjective: objective });
    if (result.ok) applySnapshot(result.value);
    else setError(result.error.message);
    setBusy(null);
  }

  const project = snapshot?.selectedProject ?? null;

  function navigate(nextArea: Area): void {
    setArea(nextArea);
    requestAnimationFrame(() => workspaceRef.current?.scrollTo({ top: 0, behavior: "auto" }));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><ScanLine size={22} /></div>
          <div><span className="brand-kicker">AI Game Studio</span><strong>Project Cockpit</strong></div>
        </div>
        <nav className="nav-list">
          {NAVIGATION.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${area === id ? "active" : ""}`} aria-current={area === id ? "page" : undefined} onClick={() => navigate(id)}>
              <Icon size={19} aria-hidden="true" /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={18} aria-hidden="true" />
          <div><strong>Read-only milestone</strong><span>No project code is executed or modified.</span></div>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <div className="project-identity">
            <span className="eyebrow">Selected project</span>
            <strong>{project?.name ?? "No project selected"}</strong>
            <span className="path-text" title={project?.path}>{project?.path ?? "Choose a trusted Godot project to begin."}</span>
          </div>
          <div className="topbar-actions">
            {project?.trusted && (
              <button className="button secondary" onClick={() => void rescan()} disabled={Boolean(busy)} data-testid="rescan-button">
                <RefreshCw size={17} aria-hidden="true" /> Rescan
              </button>
            )}
            <button className="button primary" onClick={() => void chooseProject()} disabled={Boolean(busy)} data-testid="choose-project-button">
              <FolderOpen size={17} aria-hidden="true" /> Choose project
            </button>
          </div>
        </header>

        {error && <div className="error-banner" role="alert"><AlertTriangle size={18} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError(null)}><X size={17} /></button></div>}
        {busy && <div className="busy-banner" role="status"><span className="spinner" aria-hidden="true" /><span>{busy}</span>{busy.includes("Scanning") && <button className="text-button" onClick={() => void cancelScan()}>Cancel scan</button>}</div>}

        <section ref={workspaceRef} className="workspace" aria-busy={Boolean(busy)}>
          {loading ? <LoadingState /> : !project ? <WelcomeState onChoose={() => void chooseProject()} /> : (
            <>
              {!project.trusted && <UntrustedBanner onReview={() => setTrustDialogOpen(true)} />}
              {area === "studio" && <StudioArea snapshot={snapshot!} brief={brief} objective={objective} onBrief={setBrief} onObjective={setObjective} onSave={() => void saveNotes()} onRemoveTrust={() => void removeTrust()} busy={Boolean(busy)} />}
              {area === "project" && <ProjectArea project={project} />}
              {area === "builds" && <BuildsArea />}
            </>
          )}
        </section>
      </main>

      {trustDialogOpen && project && <TrustDialog projectName={project.name} projectPath={project.path} onTrust={() => void trustProject()} onCancel={() => setTrustDialogOpen(false)} />}
    </div>
  );
}

function StudioArea({ snapshot, brief, objective, onBrief, onObjective, onSave, onRemoveTrust, busy }: {
  snapshot: StudioSnapshot;
  brief: string;
  objective: string;
  onBrief(value: string): void;
  onObjective(value: string): void;
  onSave(): void;
  onRemoveTrust(): void;
  busy: boolean;
}): JSX.Element {
  const project = snapshot.selectedProject!;
  const scan = project.scan;
  const warningCount = scan?.truth.filter((item) => item.kind === "warning").length ?? 0;
  const confirmedCount = scan?.truth.filter((item) => item.kind === "confirmed").length ?? 0;
  return (
    <div className="page" data-testid="studio-page">
      <PageHeading eyebrow="Studio" title="Understand the project before changing it" description="A concise owner view built only from application data and conservative, read-only file inspection." />
      <div className="metric-grid">
        <MetricCard label="Trust state" value={project.trusted ? "Trusted by owner" : "Not trusted"} detail={project.trustedAt ? `Recorded ${formatDate(project.trustedAt)}` : "Scanning is paused"} tone={project.trusted ? "good" : "warn"} />
        <MetricCard label="Scan state" value={formatStatus(project.scanState)} detail={scan ? `${scan.totals.files.toLocaleString()} files observed` : "No scan report yet"} />
        <MetricCard label="Findings" value={`${warningCount} warnings`} detail={`${confirmedCount} confirmed facts`} tone={warningCount > 0 ? "warn" : "good"} />
        <MetricCard label="Latest build" value="No builds recorded" detail="Milestone 1 never infers or creates builds" />
      </div>
      <div className="studio-grid">
        <section className="panel notes-panel">
          <div className="panel-heading"><div><span className="eyebrow">Owner memory</span><h2>Game brief and current objective</h2></div><span className="storage-pill">Stored outside project</span></div>
          <label className="field"><span>Game brief</span><textarea value={brief} onChange={(event) => onBrief(event.target.value)} placeholder="Describe the player promise, core loop and intended experience." rows={6} /></label>
          <label className="field"><span>Current objective</span><textarea value={objective} onChange={(event) => onObjective(event.target.value)} placeholder="State the next bounded outcome you want to pursue." rows={4} /></label>
          <div className="form-actions"><button className="button primary" onClick={onSave} disabled={busy || !project.trusted} data-testid="save-notes-button"><Save size={17} /> Save owner notes</button>{!project.trusted && <span>Trust the project before saving notes.</span>}</div>
        </section>
        <aside className="panel status-panel">
          <span className="eyebrow">Scanner boundary</span><h2>What this view means</h2>
          <div className="boundary-list">
            <Boundary icon={CheckCircle2} title="It can establish" text="Files, configured paths, selected settings, enabled plugins and directly visible capability markers." />
            <Boundary icon={CircleHelp} title="It cannot establish" text="Runtime behavior, dynamic relationships, successful imports, gameplay validity, performance or creative quality." />
          </div>
          <div className="main-scene-card"><span>Configured main scene</span><strong>{scan?.configuredMainScene ?? "Not established"}</strong><small>{scan?.configuredMainSceneExists === true ? "Path found in inventory" : scan?.configuredMainSceneExists === false ? "Configured path appears missing" : "No supported setting was parsed"}</small></div>
          {project.trusted && <button className="button danger-quiet" onClick={onRemoveTrust} disabled={busy}><Trash2 size={17} /> Remove stored trust</button>}
        </aside>
      </div>
    </div>
  );
}

function ProjectArea({ project }: { project: NonNullable<StudioSnapshot["selectedProject"]> }): JSX.Element {
  const [query, setQuery] = useState("");
  const scan = project.scan;
  if (!project.trusted) return <LockedProjectState />;
  if (!scan) return <EmptyScanState state={project.scanState} />;
  return (
    <div className="page" data-testid="project-page">
      <PageHeading eyebrow="Project" title="Observed project inventory" description="Paths and settings are reported as observed. Warnings and limitations stay separate from confirmed facts." />
      <TruthLegend />
      <div className="project-summary-grid">
        <SummaryLine label="Configured main scene" value={scan.configuredMainScene ?? "Not configured in supported settings"} status={scan.configuredMainSceneExists === false ? "warning" : "confirmed"} />
        <SummaryLine label="Autoloads" value={`${scan.autoloads.length} configured`} status={scan.autoloads.some((item) => !item.exists) ? "warning" : "confirmed"} />
        <SummaryLine label="Input actions" value={`${scan.inputActions.length} directly parsed`} status="confirmed" />
        <SummaryLine label="Scan coverage" value={`${scan.totals.files.toLocaleString()} files · ${formatBytes(scan.totals.bytes)}`} status={scan.status === "complete" ? "confirmed" : "warning"} />
      </div>

      <section className="panel finding-panel">
        <div className="panel-heading"><div><span className="eyebrow">Truth-labelled findings</span><h2>Facts, warnings and limits</h2></div><TruthCounts truth={scan.truth} /></div>
        <div className="truth-feed">{scan.truth.map((item) => <TruthRow key={item.id} item={item} />)}</div>
      </section>

      <div className="detail-grid">
        <DetailList title="Autoloads" empty="No autoload assignments were parsed." items={scan.autoloads.map((item) => ({ primary: item.name, secondary: `${item.singleton ? "Singleton · " : ""}${item.path}`, warning: !item.exists }))} />
        <DetailList title="Input actions" empty="No input actions were parsed." items={scan.inputActions.map((name) => ({ primary: name, secondary: "Configured action" }))} />
        <SettingsCard title="Display settings" items={scan.displaySettings} />
        <SettingsCard title="Rendering settings" items={scan.renderingSettings} />
      </div>

      <section className="panel capability-panel">
        <div className="panel-heading"><div><span className="eyebrow">Active capabilities</span><h2>Plugins, native content and executable markers</h2></div></div>
        <div className="capability-columns">
          <PathList title="Enabled editor plugins" paths={scan.enabledPlugins} empty="None directly configured" warning />
          <PathList title="GDExtension declarations" paths={scan.gdExtensions.items.map((item) => item.path)} empty="None observed" warning />
          <PathList title="Native libraries" paths={scan.nativeLibraries.items.map((item) => item.path)} empty="None observed" warning />
          <PathList title="Executables and commands" paths={scan.executables.items.map((item) => item.path)} empty="None observed" warning />
        </div>
        {scan.activeContent.length > 0 && <div className="active-list">{scan.activeContent.slice(0, 100).map((item, index) => <div key={`${item.path}-${item.capability}-${index}`}><AlertTriangle size={16} /><span><strong>{item.capability}</strong><small>{item.path} · {item.evidence}</small></span></div>)}</div>}
      </section>

      <section className="panel inventory-panel">
        <div className="panel-heading inventory-heading"><div><span className="eyebrow">File inventory</span><h2>Scenes, scripts and assets</h2></div><label className="search-field"><Search size={17} /><span className="sr-only">Filter observed files</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter paths" /></label></div>
        <div className="group-grid">{(Object.keys(scan.groups) as FileGroupKey[]).map((group) => <FileGroupCard key={group} group={group} collection={scan.groups[group]} query={query} />)}</div>
      </section>

      <div className="detail-grid issue-grid">
        <PathList title="Missing local references" paths={scan.missingReferences.map((item) => `${item.sourcePath} → ${item.referencedPath}`)} empty="No directly quoted missing res:// references observed" warning />
        <PathList title="Unreadable or malformed" paths={[...scan.unreadableFiles, ...scan.projectGodot.diagnostics]} empty="No read failures or supported-format diagnostics" warning />
        <PathList title="Large files" paths={scan.largeFiles.items.map((item) => `${item.path} · ${formatBytes(item.bytes)}`)} empty="No files above the configured threshold" warning />
        <PathList title="Unsupported files" paths={scan.unsupportedFiles.items.map((item) => item.path)} empty="No unsupported extensions observed" />
        <PathList title="Reparse points" paths={scan.reparsePoints} empty="No symlinks or junctions observed" warning />
      </div>
    </div>
  );
}

function BuildsArea(): JSX.Element {
  return (
    <div className="page" data-testid="builds-page">
      <PageHeading eyebrow="Builds" title="Review-build history" description="Only application-owned build records can appear here. Project files, Git history and timestamps are never treated as builds." />
      <section className="empty-builds panel">
        <div className="empty-icon"><Package size={30} /></div><span className="eyebrow">Truthful empty state</span><h2>No builds recorded</h2>
        <p>Milestone 1 does not run Godot, import the project, export files, launch executables or infer a build from anything already present.</p>
        <div className="build-rule-grid"><Boundary icon={CheckCircle2} title="What is known" text="The application-owned build journal is empty." /><Boundary icon={CircleHelp} title="What is not claimed" text="Existing executables, exports or project metadata are not proof of a review build." /></div>
      </section>
    </div>
  );
}

function TrustDialog({ projectName, projectPath, onTrust, onCancel }: { projectName: string; projectPath: string; onTrust(): void; onCancel(): void }): JSX.Element {
  const trustButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    trustButton.current?.focus();
    const listener = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="trust-dialog" role="alertdialog" aria-modal="true" aria-labelledby="trust-title" aria-describedby="trust-description" data-testid="trust-dialog">
        <div className="trust-icon"><ShieldCheck size={28} /></div><span className="eyebrow">First-open confirmation</span><h2 id="trust-title">Trust “{projectName}”?</h2>
        <p id="trust-description">Open only a project that you created or trust. This milestone scans project files but does not execute the game or modify the project.</p>
        <div className="dialog-path">{projectPath}</div>
        <div className="truth-note"><AlertTriangle size={17} /><span>Trusting the project does not mean every file is safe or valid. Capability warnings remain visible.</span></div>
        <div className="dialog-actions"><button className="button secondary" onClick={onCancel} data-testid="cancel-trust-button">Cancel</button><button ref={trustButton} className="button primary" onClick={onTrust} data-testid="trust-project-button"><ShieldCheck size={17} /> Trust and scan</button></div>
      </section>
    </div>
  );
}

function WelcomeState({ onChoose }: { onChoose(): void }): JSX.Element {
  return <div className="welcome-state"><div className="welcome-mark"><FolderTree size={34} /></div><span className="eyebrow">Read-only project cockpit</span><h1>See what is really in a Godot project.</h1><p>Choose a project root containing project.godot. The app will ask for trust before it performs a conservative file scan.</p><button className="button primary large" onClick={onChoose}><FolderOpen size={19} /> Choose a Godot project</button><div className="welcome-boundaries"><span>No Godot execution</span><span>No Codex</span><span>No project writes</span></div></div>;
}

function LoadingState(): JSX.Element { return <div className="loading-state"><span className="spinner large" /><strong>Opening the project cockpit</strong><span>Loading application-owned state…</span></div>; }
function UntrustedBanner({ onReview }: { onReview(): void }): JSX.Element { return <div className="untrusted-banner"><AlertTriangle size={19} /><div><strong>Scanning is paused</strong><span>This project has not been trusted by the owner.</span></div><button className="button secondary" onClick={onReview}>Review trust</button></div>; }
function LockedProjectState(): JSX.Element { return <div className="center-state"><ShieldCheck size={32} /><h2>Trust required before scanning</h2><p>The project folder was selected, but no project contents have been scanned.</p></div>; }
function EmptyScanState({ state }: { state: string }): JSX.Element { return <div className="center-state"><ScanLine size={32} /><h2>No completed scan report</h2><p>Current scan state: {formatStatus(state)}.</p></div>; }

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }): JSX.Element { return <header className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></header>; }
function MetricCard({ label, value, detail, tone = "neutral" }: { label: string; value: string; detail: string; tone?: "neutral" | "good" | "warn" }): JSX.Element { return <article className={`metric-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>; }
function Boundary({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }): JSX.Element { return <div className="boundary"><Icon size={19} /><div><strong>{title}</strong><span>{text}</span></div></div>; }
function SummaryLine({ label, value, status }: { label: string; value: string; status: "confirmed" | "warning" }): JSX.Element { const Icon = status === "confirmed" ? CheckCircle2 : AlertTriangle; return <div className={`summary-line ${status}`}><Icon size={18} /><span><small>{label}</small><strong>{value}</strong></span></div>; }

function TruthLegend(): JSX.Element { return <section className="truth-legend" aria-label="Scanner truth categories">{(Object.keys(TRUTH_META) as TruthKind[]).map((kind) => { const meta = TRUTH_META[kind]; const Icon = meta.icon; return <div key={kind} className={`truth-legend-item ${kind}`}><Icon size={17} /><span><strong>{meta.label}</strong><small>{meta.description}</small></span></div>; })}</section>; }
function TruthCounts({ truth }: { truth: TruthItem[] }): JSX.Element { return <div className="truth-counts">{(["confirmed", "warning", "heuristic", "limitation"] as TruthKind[]).map((kind) => <span key={kind} className={kind}>{truth.filter((item) => item.kind === kind).length} {TRUTH_META[kind].label.toLowerCase()}{truth.filter((item) => item.kind === kind).length === 1 ? "" : "s"}</span>)}</div>; }
function TruthRow({ item }: { item: TruthItem }): JSX.Element { const meta = TRUTH_META[item.kind]; const Icon = meta.icon; return <article className={`truth-row ${item.kind}`}><Icon size={18} /><div><span className="truth-label">{meta.label}</span><strong>{item.title}</strong><p>{item.detail}</p>{item.path && <code>{item.path}</code>}</div></article>; }

function DetailList({ title, items, empty }: { title: string; items: Array<{ primary: string; secondary: string; warning?: boolean }>; empty: string }): JSX.Element { return <section className="panel compact-panel"><h3>{title}</h3>{items.length === 0 ? <p className="empty-copy">{empty}</p> : <div className="simple-list">{items.slice(0, 100).map((item, index) => <div key={`${item.primary}-${index}`} className={item.warning ? "warning" : ""}><span><strong>{item.primary}</strong><small>{item.secondary}</small></span>{item.warning && <AlertTriangle size={16} />}</div>)}</div>}</section>; }
function SettingsCard({ title, items }: { title: string; items: Array<{ name: string; value: string }> }): JSX.Element { return <section className="panel compact-panel"><h3>{title}</h3>{items.length === 0 ? <p className="empty-copy">No supported settings were parsed.</p> : <dl className="settings-list">{items.map((item) => <div key={item.name}><dt>{item.name}</dt><dd>{item.value}</dd></div>)}</dl>}</section>; }
function PathList({ title, paths, empty, warning = false }: { title: string; paths: string[]; empty: string; warning?: boolean }): JSX.Element { return <section className="panel compact-panel path-panel"><h3>{title}<span>{paths.length}</span></h3>{paths.length === 0 ? <p className="empty-copy">{empty}</p> : <ul>{paths.slice(0, 100).map((path, index) => <li key={`${path}-${index}`} className={warning ? "warning-path" : ""}>{warning && <AlertTriangle size={14} />}<code>{path}</code></li>)}</ul>}</section>; }

function FileGroupCard({ group, collection, query }: { group: FileGroupKey; collection: FileCollection; query: string }): JSX.Element {
  const meta = GROUP_LABELS[group]; const Icon = meta.icon; const normalized = query.trim().toLowerCase();
  const matches = normalized ? collection.items.filter((item) => item.path.toLowerCase().includes(normalized)) : collection.items;
  return <article className="file-group-card"><div className="file-group-heading"><span><Icon size={18} /><strong>{meta.label}</strong></span><b>{collection.total}</b></div><div className="file-list">{matches.slice(0, 60).map((item) => <div key={item.path}><code title={item.path}>{item.path}</code><small>{formatBytes(item.bytes)}</small></div>)}{matches.length === 0 && <p>No matching observed paths.</p>}</div>{(collection.truncated || matches.length > 60) && <div className="truncation-note">Showing a bounded subset; the total remains exact.</div>}</article>;
}

function formatBytes(bytes: number): string { if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`; if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`; if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`; return `${bytes} B`; }
function formatStatus(value: string): string { return value.replaceAll("-", " ").replace(/^./u, (letter) => letter.toUpperCase()); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
