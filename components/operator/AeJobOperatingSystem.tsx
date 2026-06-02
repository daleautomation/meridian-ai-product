"use client";

import Link from "next/link";
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { groupByRoleCategory, buildNeedsDylanItems } from "@/lib/ae-jobs/workspace";
import { seedOpportunities } from "@/lib/ae-jobs/seed";
import { palette } from "@/lib/theme";
import type {
  AeJobsViewId,
  AeJobsWorkspaceModel,
  ChecklistKey,
  JobOpportunity,
  NeedsDylanItem,
  RoleCategory,
} from "@/lib/ae-jobs/types";

interface AeJobOperatingSystemProps {
  initialModel: AeJobsWorkspaceModel;
  initialSelectedOpportunityId?: string;
}

export function AeJobOperatingSystem({
  initialModel,
  initialSelectedOpportunityId,
}: AeJobOperatingSystemProps) {
  const defaultSelectedId =
    initialSelectedOpportunityId &&
    initialModel.opportunities.some((o) => o.id === initialSelectedOpportunityId)
      ? initialSelectedOpportunityId
      : (initialModel.opportunities[0]?.id ?? "");

  const [model, setModel] = useState(initialModel);
  const [view, setView] = useState<AeJobsViewId>("today");
  const [roleFilter, setRoleFilter] = useState<RoleCategory | "all">("all");
  const [selectedId, setSelectedId] = useState(defaultSelectedId);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const selected = useMemo(
    () => model.opportunities.find((o) => o.id === selectedId) ?? model.opportunities[0] ?? null,
    [model.opportunities, selectedId],
  );

  const filteredPipeline = useMemo(() => {
    if (roleFilter === "all") return model.opportunities;
    return model.opportunities.filter((o) => o.roleCategory === roleFilter);
  }, [model.opportunities, roleFilter]);

  const roleGroups = useMemo(
    () => groupByRoleCategory(filteredPipeline),
    [filteredPipeline],
  );

  const toggleChecklist = useCallback(
    async (oppId: string, key: ChecklistKey, value: boolean) => {
      setSaving(true);
      setModel((prev) => ({
        ...prev,
        opportunities: prev.opportunities.map((o) =>
          o.id === oppId ? { ...o, checklist: { ...o.checklist, [key]: value } } : o,
        ),
      }));
      try {
        const res = await fetch("/api/ae-jobs/opportunities", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opportunityId: oppId, checklist: { [key]: value } }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.opportunities) {
            setModel((prev) => ({
              ...prev,
              opportunities: data.opportunities,
              todayActions: rebuildToday(data.opportunities),
              needsDylan: buildNeedsDylanItems(data.opportunities),
            }));
          }
        }
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const handleImport = useCallback(async (mode: "replace" | "merge") => {
    setImportError(null);
    setImporting(true);
    try {
      let opportunities: JobOpportunity[];
      try {
        const parsed = JSON.parse(importJson) as unknown;
        if (Array.isArray(parsed)) {
          opportunities = parsed as JobOpportunity[];
        } else if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { opportunities?: unknown }).opportunities)
        ) {
          opportunities = (parsed as { opportunities: JobOpportunity[] }).opportunities;
        } else {
          throw new Error("Expected an opportunities array or store object with opportunities");
        }
      } catch (e) {
        setImportError(e instanceof Error ? e.message : "Invalid JSON");
        return;
      }

      const res = await fetch("/api/ae-jobs/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, opportunities }),
      });
      const data = await res.json();
      if (!res.ok || !data.model) {
        setImportError(data.error ?? "Import failed");
        return;
      }
      setModel(data.model);
      setSelectedId(data.model.opportunities[0]?.id ?? "");
      setImportOpen(false);
      setImportJson("");
    } finally {
      setImporting(false);
    }
  }, [importJson]);

  const loadSeedTemplate = useCallback(() => {
    setImportJson(JSON.stringify(seedOpportunities(), null, 2));
    setImportError(null);
  }, []);

  return (
    <main style={styles.shell}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>Personal AE Job Operating System</div>
          <h1 style={styles.title}>Career pipeline</h1>
          <p style={styles.subtitle}>
            {model.owner.name}&apos;s applications — stages, follow-ups, and prep in one place.
          </p>
        </div>
        <div style={styles.headerActions}>
          <Link href="/operator/jobs/brief" style={styles.backLink}>
            Career Brief
          </Link>
          <Link href="/workspace-select" style={styles.backLink}>
            Workspaces
          </Link>
          <div style={styles.badge}>
            <span style={styles.statusDot} />
            {model.summary.total} opportunities
          </div>
        </div>
      </header>

      <IngestionBanner ingestion={model.ingestion} />

      <ManualImportPanel
        open={importOpen}
        importing={importing}
        importJson={importJson}
        importError={importError}
        onToggle={() => setImportOpen((v) => !v)}
        onChange={setImportJson}
        onLoadSeed={loadSeedTemplate}
        onImport={handleImport}
      />

      <nav aria-label="AE Job OS views" style={styles.nav}>
        <NavTab id="today" label="Today" count={model.todayActions.length + model.needsDylan.length} active={view} onSelect={setView} />
        <NavTab id="pipeline" label="Pipeline" count={model.opportunities.length} active={view} onSelect={setView} />
        <NavTab id="by_role" label="By role" count={roleGroups.length} active={view} onSelect={setView} />
      </nav>

      <section style={styles.metrics}>
        <Metric label="Active high priority" value={String(model.summary.highPriority)} />
        <Metric label="Interviews in play" value={String(model.summary.interviewsThisWeek)} />
        <Metric label="Account Executive" value={String(model.summary.byCategory.account_executive)} />
        <Metric label="Sales Engineer" value={String(model.summary.byCategory.sales_engineer)} />
      </section>

      {view === "pipeline" ? (
        <div style={styles.filterRow}>
          <label style={styles.filterLabel}>
            Role category
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as RoleCategory | "all")}
              style={styles.select}
            >
              <option value="all">All roles</option>
              {(Object.keys(model.roleLabels) as RoleCategory[]).map((cat) => (
                <option key={cat} value={cat}>
                  {model.roleLabels[cat]} ({model.summary.byCategory[cat]})
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div style={styles.body}>
        <div style={styles.mainColumn}>
          {view === "today" ? (
            <TodayView
              actions={model.todayActions}
              needsDylan={model.needsDylan}
              roleLabels={model.roleLabels}
              onSelect={(id) => {
                setSelectedId(id);
                setView("pipeline");
              }}
            />
          ) : view === "by_role" ? (
            <ByRoleView
              groups={roleGroups}
              stageLabels={model.stageLabels}
              selectedId={selected?.id}
              onSelect={setSelectedId}
            />
          ) : (
            <PipelineTable
              opportunities={filteredPipeline}
              stageLabels={model.stageLabels}
              roleLabels={model.roleLabels}
              selectedId={selected?.id}
              onSelect={setSelectedId}
            />
          )}
        </div>

        {selected ? (
          <aside style={styles.detailPanel}>
            <DetailPanel
              opportunity={selected}
              model={model}
              saving={saving}
              onToggleChecklist={toggleChecklist}
            />
          </aside>
        ) : null}
      </div>
    </main>
  );
}

function rebuildToday(opportunities: JobOpportunity[]) {
  const today = new Date().toISOString().slice(0, 10);
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return opportunities
    .filter((o) => o.stage !== "closed_lost" && o.stage !== "on_hold")
    .filter((o) => o.priority === "high" || (o.followUpDate && o.followUpDate.slice(0, 10) <= today))
    .sort((a, b) => {
      const pa = priorityOrder[a.priority];
      const pb = priorityOrder[b.priority];
      if (pa !== pb) return pa - pb;
      return (a.followUpDate ?? "9999-12-31").localeCompare(b.followUpDate ?? "9999-12-31");
    })
    .map((o) => ({
      opportunityId: o.id,
      company: o.company,
      roleTitle: o.roleTitle,
      nextAction: o.nextAction,
      followUpDate: o.followUpDate,
      priority: o.priority,
      roleCategory: o.roleCategory,
    }));
}

function IngestionBanner({
  ingestion,
}: {
  ingestion: AeJobsWorkspaceModel["ingestion"];
}) {
  return (
    <div style={styles.ingestionBanner}>
      <div>
        <strong>Email ingestion</strong>
        <span style={styles.ingestionMuted}> — {ingestion.statusMessage}</span>
        {ingestion.lastIngestedAt ? (
          <span style={styles.ingestionMuted}>
            {" "}
            Last ingest: {formatDate(ingestion.lastIngestedAt.slice(0, 10))}.
          </span>
        ) : null}
      </div>
      <code style={styles.ingestionCode}>POST /api/ae-jobs/ingest</code>
    </div>
  );
}

function ManualImportPanel({
  open,
  importing,
  importJson,
  importError,
  onToggle,
  onChange,
  onLoadSeed,
  onImport,
}: {
  open: boolean;
  importing: boolean;
  importJson: string;
  importError: string | null;
  onToggle: () => void;
  onChange: (value: string) => void;
  onLoadSeed: () => void;
  onImport: (mode: "replace" | "merge") => void;
}) {
  return (
    <div style={styles.importPanel}>
      <button type="button" onClick={onToggle} style={styles.importToggle}>
        {open ? "Hide manual import" : "Manual JSON import"}
      </button>
      {open ? (
        <div style={styles.importBody}>
          <p style={styles.importHint}>
            Paste an opportunities array or full store JSON. Low-friction — session auth only, no DB.
          </p>
          <textarea
            value={importJson}
            onChange={(e) => onChange(e.target.value)}
            placeholder='[{ "id": "opp-...", "company": "...", ... }]'
            style={styles.importTextarea}
            rows={8}
          />
          {importError ? <p style={styles.importError}>{importError}</p> : null}
          <div style={styles.importActions}>
            <button type="button" onClick={onLoadSeed} style={styles.importSecondary}>
              Load seed template
            </button>
            <button
              type="button"
              disabled={importing || !importJson.trim()}
              onClick={() => onImport("merge")}
              style={styles.importSecondary}
            >
              Merge
            </button>
            <button
              type="button"
              disabled={importing || !importJson.trim()}
              onClick={() => onImport("replace")}
              style={styles.importPrimary}
            >
              {importing ? "Importing…" : "Replace pipeline"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function NavTab({
  id,
  label,
  count,
  active,
  onSelect,
}: {
  id: AeJobsViewId;
  label: string;
  count: number;
  active: AeJobsViewId;
  onSelect: (id: AeJobsViewId) => void;
}) {
  const selected = active === id;
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      style={{ ...styles.navTab, ...(selected ? styles.navTabActive : {}) }}
    >
      <span>{label}</span>
      <span style={selected ? styles.navCountActive : styles.navCount}>{count}</span>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.metric}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
    </div>
  );
}

function TodayView({
  actions,
  needsDylan,
  roleLabels,
  onSelect,
}: {
  actions: AeJobsWorkspaceModel["todayActions"];
  needsDylan: NeedsDylanItem[];
  roleLabels: Record<RoleCategory, string>;
  onSelect: (id: string) => void;
}) {
  if (actions.length === 0 && needsDylan.length === 0) {
    return (
      <div style={styles.empty}>
        <h2 style={styles.sectionTitle}>Nothing urgent today</h2>
        <p style={styles.muted}>High-priority and due follow-ups will appear here.</p>
      </div>
    );
  }
  return (
    <section>
      {needsDylan.length > 0 ? (
        <>
          <h2 style={styles.sectionTitle}>Needs Dylan</h2>
          <div style={styles.needsDylanList}>
            {needsDylan.map((item) => (
              <button
                key={`${item.opportunityId}-${item.category}`}
                type="button"
                onClick={() => onSelect(item.opportunityId)}
                style={styles.needsDylanCard}
              >
                <div style={styles.todayTop}>
                  <NeedsDylanPill label={item.categoryLabel} category={item.category} />
                  {item.followUpDate ? (
                    <span style={styles.dueDate}>Due {formatDate(item.followUpDate)}</span>
                  ) : null}
                </div>
                <strong style={styles.todayCompany}>{item.company}</strong>
                <span style={styles.todayRole}>{item.roleTitle}</span>
                <p style={styles.todayAction}>{item.nextAction}</p>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {actions.length > 0 ? (
        <>
          <h2 style={{ ...styles.sectionTitle, marginTop: needsDylan.length > 0 ? "24px" : 0 }}>
            Today — highest leverage actions
          </h2>
          <div style={styles.todayList}>
            {actions.map((action, i) => (
              <button
                key={action.opportunityId}
                type="button"
                onClick={() => onSelect(action.opportunityId)}
                style={{ ...styles.todayCard, ...(i === 0 ? styles.todayCardPrimary : {}) }}
              >
                <div style={styles.todayTop}>
                  <PriorityPill priority={action.priority} />
                  {action.followUpDate ? (
                    <span style={styles.dueDate}>Due {formatDate(action.followUpDate)}</span>
                  ) : null}
                </div>
                <strong style={styles.todayCompany}>{action.company}</strong>
                <span style={styles.todayRole}>{action.roleTitle}</span>
                <span style={styles.todayCategory}>{roleLabels[action.roleCategory]}</span>
                <p style={styles.todayAction}>{action.nextAction}</p>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function PipelineTable({
  opportunities,
  stageLabels,
  roleLabels,
  selectedId,
  onSelect,
}: {
  opportunities: JobOpportunity[];
  stageLabels: AeJobsWorkspaceModel["stageLabels"];
  roleLabels: Record<RoleCategory, string>;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section style={styles.tableWrap}>
      <h2 style={styles.sectionTitle}>Pipeline</h2>
      <table style={styles.table}>
        <thead>
          <tr>
            {["Company", "Role", "Category", "Stage", "Last touch", "Next action", "Follow-up", "Priority"].map(
              (h) => (
                <th key={h} style={styles.th}>
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opp) => (
            <tr
              key={opp.id}
              onClick={() => onSelect(opp.id)}
              style={{
                ...styles.tr,
                ...(selectedId === opp.id ? styles.trSelected : {}),
              }}
            >
              <td style={styles.td}>
                <strong>{opp.company}</strong>
              </td>
              <td style={styles.td}>{opp.roleTitle}</td>
              <td style={styles.td}>{roleLabels[opp.roleCategory]}</td>
              <td style={styles.td}>{stageLabels[opp.stage]}</td>
              <td style={styles.td}>{formatDate(opp.lastTouchpoint)}</td>
              <td style={styles.td}>{opp.nextAction}</td>
              <td style={styles.td}>{opp.followUpDate ? formatDate(opp.followUpDate) : "—"}</td>
              <td style={styles.td}>
                <PriorityPill priority={opp.priority} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ByRoleView({
  groups,
  stageLabels,
  selectedId,
  onSelect,
}: {
  groups: ReturnType<typeof groupByRoleCategory>;
  stageLabels: AeJobsWorkspaceModel["stageLabels"];
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section>
      <h2 style={styles.sectionTitle}>Grouped by role type</h2>
      {groups.map((group) => (
        <div key={group.category} style={styles.roleGroup}>
          <h3 style={styles.roleGroupTitle}>
            {group.label}
            <span style={styles.roleGroupCount}>{group.items.length}</span>
          </h3>
          <div style={styles.roleGroupList}>
            {group.items.map((opp) => (
              <button
                key={opp.id}
                type="button"
                onClick={() => onSelect(opp.id)}
                style={{
                  ...styles.roleCard,
                  ...(selectedId === opp.id ? styles.roleCardSelected : {}),
                }}
              >
                <div style={styles.roleCardTop}>
                  <strong>{opp.company}</strong>
                  <PriorityPill priority={opp.priority} />
                </div>
                <span>{opp.roleTitle}</span>
                <span style={styles.muted}>
                  {stageLabels[opp.stage]} · {opp.nextAction}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function DetailPanel({
  opportunity,
  model,
  saving,
  onToggleChecklist,
}: {
  opportunity: JobOpportunity;
  model: AeJobsWorkspaceModel;
  saving: boolean;
  onToggleChecklist: (oppId: string, key: ChecklistKey, value: boolean) => void;
}) {
  const doneCount = (Object.keys(opportunity.checklist) as ChecklistKey[]).filter(
    (k) => opportunity.checklist[k],
  ).length;

  return (
    <div style={styles.detail}>
      <div style={styles.detailHeader}>
        <div style={styles.eyebrow}>{model.roleLabels[opportunity.roleCategory]}</div>
        <h2 style={styles.detailTitle}>{opportunity.company}</h2>
        <p style={styles.detailRole}>{opportunity.roleTitle}</p>
      </div>

      <div style={styles.detailMeta}>
        <MetaRow label="Stage" value={model.stageLabels[opportunity.stage]} />
        <MetaRow label="Last touch" value={formatDate(opportunity.lastTouchpoint)} />
        <MetaRow label="Follow-up" value={opportunity.followUpDate ? formatDate(opportunity.followUpDate) : "—"} />
        <MetaRow label="Priority" value={<PriorityPill priority={opportunity.priority} />} />
      </div>

      <div style={styles.detailBlock}>
        <div style={styles.blockLabel}>Source & evidence</div>
        <div style={styles.evidenceGrid}>
          <MetaRow label="Source" value={formatSource(opportunity.source)} />
          <MetaRow
            label="Last email subject"
            value={opportunity.sourceEmailSubject ?? "—"}
          />
          <MetaRow label="Last sender" value={opportunity.sourceSender ?? "—"} />
          <MetaRow label="Confidence" value={formatConfidence(opportunity.confidence)} />
        </div>
      </div>

      <div style={styles.detailBlock}>
        <div style={styles.blockLabel}>Next action</div>
        <p style={styles.nextActionText}>{opportunity.nextAction}</p>
      </div>

      {opportunity.notes ? (
        <div style={styles.detailBlock}>
          <div style={styles.blockLabel}>Notes</div>
          <p style={styles.notesText}>{opportunity.notes}</p>
        </div>
      ) : null}

      <div style={styles.detailBlock}>
        <div style={styles.checklistHeader}>
          <div style={styles.blockLabel}>Checklist</div>
          <span style={styles.muted}>
            {doneCount}/{(Object.keys(model.checklistLabels) as ChecklistKey[]).length}
            {saving ? " · saving…" : ""}
          </span>
        </div>
        <ul style={styles.checklist}>
          {(Object.keys(model.checklistLabels) as ChecklistKey[]).map((key) => (
            <li key={key} style={styles.checklistItem}>
              <label style={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={opportunity.checklist[key]}
                  onChange={(e) => onToggleChecklist(opportunity.id, key, e.target.checked)}
                />
                <span style={opportunity.checklist[key] ? styles.checkDone : undefined}>
                  {model.checklistLabels[key]}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={styles.metaRow}>
      <span style={styles.metaLabel}>{label}</span>
      <span style={styles.metaValue}>{value}</span>
    </div>
  );
}

function formatSource(source: JobOpportunity["source"]): string {
  if (source === "email_ingestion") return "Email ingestion";
  if (source === "json_import") return "JSON import";
  return "Manual";
}

function formatConfidence(confidence: JobOpportunity["confidence"]): string {
  if (confidence == null) return "— (manual)";
  return `${Math.round(confidence * 100)}%`;
}

function NeedsDylanPill({
  label,
  category,
}: {
  label: string;
  category: NeedsDylanItem["category"];
}) {
  const colors = {
    loom_due: { bg: palette.orangePale, color: palette.orange, border: palette.orangeBorder },
    follow_up_overdue: { bg: palette.orangePale, color: palette.orange, border: palette.orangeBorder },
    waiting_on_reply: { bg: palette.bluePale, color: palette.blue, border: palette.blueBorder },
    prep_required: { bg: palette.bluePale, color: palette.blue, border: palette.blueBorder },
    interview_reminder_48h: { bg: palette.bluePale, color: palette.blue, border: palette.blueBorder },
    interview_reminder_24h: { bg: palette.orangePale, color: palette.orange, border: palette.orangeBorder },
  }[category];
  return (
    <span
      style={{
        ...styles.pill,
        background: colors.bg,
        color: colors.color,
        border: `1px solid ${colors.border}`,
      }}
    >
      {label}
    </span>
  );
}

function PriorityPill({ priority }: { priority: JobOpportunity["priority"] }) {
  const colors = {
    high: { bg: palette.orangePale, color: palette.orange, border: palette.orangeBorder },
    medium: { bg: palette.bluePale, color: palette.blue, border: palette.blueBorder },
    low: { bg: palette.surfaceHover, color: palette.textSecondary, border: palette.border },
  }[priority];
  return (
    <span
      style={{
        ...styles.pill,
        background: colors.bg,
        color: colors.color,
        border: `1px solid ${colors.border}`,
      }}
    >
      {priority}
    </span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso.includes("T") ? iso : `${iso}T12:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

const styles: Record<string, CSSProperties> = {
  shell: {
    minHeight: "100dvh",
    padding: "24px 28px 48px",
    background:
      "radial-gradient(circle at 20% 0%, rgba(37,99,235,0.12), transparent 28%), linear-gradient(180deg, #FBFDFF 0%, #F4F7FC 100%)",
    color: palette.textPrimary,
    fontFamily: "var(--font-inter), -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "16px",
    flexWrap: "wrap",
    marginBottom: "16px",
  },
  eyebrow: {
    color: palette.blue,
    fontSize: "11px",
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  },
  title: {
    margin: "6px 0 4px",
    fontSize: "32px",
    letterSpacing: "-0.04em",
    lineHeight: 1.1,
  },
  subtitle: { color: palette.textSecondary, fontSize: "14px", margin: 0 },
  headerActions: { display: "flex", alignItems: "center", gap: "12px" },
  backLink: {
    color: palette.textSecondary,
    fontSize: "13px",
    fontWeight: 700,
    textDecoration: "none",
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "999px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    fontSize: "13px",
    fontWeight: 700,
  },
  statusDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: palette.success,
  },
  ingestionBanner: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "12px",
    flexWrap: "wrap",
    padding: "12px 16px",
    marginBottom: "16px",
    borderRadius: "14px",
    border: `1px dashed ${palette.borderAccent}`,
    background: palette.bluePale,
    fontSize: "13px",
  },
  ingestionMuted: { color: palette.textSecondary, fontWeight: 400 },
  ingestionCode: {
    fontSize: "12px",
    padding: "4px 8px",
    borderRadius: "8px",
    background: palette.surface,
    border: `1px solid ${palette.border}`,
  },
  importPanel: {
    marginBottom: "16px",
    borderRadius: "14px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    overflow: "hidden",
  },
  importToggle: {
    width: "100%",
    padding: "10px 16px",
    border: "none",
    background: "transparent",
    textAlign: "left",
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
    color: palette.textSecondary,
  },
  importBody: { padding: "0 16px 16px" },
  importHint: { margin: "0 0 8px", fontSize: "12px", color: palette.textSecondary },
  importTextarea: {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    borderRadius: "12px",
    border: `1px solid ${palette.border}`,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "12px",
    resize: "vertical",
  },
  importError: { margin: "8px 0 0", fontSize: "12px", color: palette.orange },
  importActions: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" },
  importPrimary: {
    padding: "8px 14px",
    borderRadius: "10px",
    border: `1px solid ${palette.blueBorder}`,
    background: palette.bluePale,
    color: palette.blue,
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
  },
  importSecondary: {
    padding: "8px 14px",
    borderRadius: "10px",
    border: `1px solid ${palette.border}`,
    background: palette.surfaceHover,
    color: palette.textSecondary,
    fontWeight: 700,
    fontSize: "13px",
    cursor: "pointer",
  },
  nav: { display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" },
  navTab: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "10px 14px",
    borderRadius: "12px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "13px",
    color: palette.textSecondary,
  },
  navTabActive: {
    background: palette.bluePale,
    borderColor: palette.blueBorder,
    color: palette.blue,
  },
  navCount: { color: palette.textTertiary, fontSize: "12px" },
  navCountActive: { color: palette.blue, fontSize: "12px" },
  metrics: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: "10px",
    marginBottom: "16px",
  },
  metric: {
    padding: "14px 16px",
    borderRadius: "16px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
  },
  metricLabel: { fontSize: "11px", color: palette.textSecondary, fontWeight: 700, textTransform: "uppercase" },
  metricValue: { fontSize: "24px", fontWeight: 800, marginTop: "4px", letterSpacing: "-0.03em" },
  filterRow: { marginBottom: "12px" },
  filterLabel: { display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", fontWeight: 700, color: palette.textSecondary },
  select: {
    maxWidth: "320px",
    padding: "10px 12px",
    borderRadius: "12px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    fontSize: "14px",
  },
  body: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 320px",
    gap: "16px",
    alignItems: "start",
  },
  mainColumn: {
    padding: "18px",
    borderRadius: "20px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
    minHeight: "420px",
  },
  detailPanel: {
    position: "sticky",
    top: "16px",
  },
  detail: {
    padding: "18px",
    borderRadius: "20px",
    border: `1px solid ${palette.border}`,
    background: palette.surface,
  },
  detailHeader: { marginBottom: "14px" },
  detailTitle: { margin: "4px 0", fontSize: "22px", letterSpacing: "-0.03em" },
  detailRole: { margin: 0, color: palette.textSecondary, fontSize: "14px" },
  detailMeta: {
    display: "grid",
    gap: "8px",
    padding: "12px 0",
    borderTop: `1px solid ${palette.borderLight}`,
    borderBottom: `1px solid ${palette.borderLight}`,
    marginBottom: "14px",
  },
  metaRow: { display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "13px" },
  metaLabel: { color: palette.textSecondary, fontWeight: 600 },
  metaValue: { fontWeight: 700, textAlign: "right" },
  evidenceGrid: { display: "grid", gap: "8px" },
  detailBlock: { marginBottom: "16px" },
  blockLabel: { fontSize: "11px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: palette.textSecondary, marginBottom: "6px" },
  nextActionText: { margin: 0, fontSize: "14px", lineHeight: 1.5 },
  notesText: { margin: 0, fontSize: "13px", color: palette.textSecondary, lineHeight: 1.5, whiteSpace: "pre-wrap" },
  checklistHeader: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  checklist: { listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: "6px" },
  checklistItem: { fontSize: "13px" },
  checkLabel: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" },
  checkDone: { textDecoration: "line-through", color: palette.textTertiary },
  sectionTitle: { margin: "0 0 14px", fontSize: "18px", letterSpacing: "-0.02em" },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px" },
  th: {
    textAlign: "left",
    padding: "10px 8px",
    borderBottom: `2px solid ${palette.border}`,
    color: palette.textSecondary,
    fontSize: "11px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px 8px",
    borderBottom: `1px solid ${palette.borderLight}`,
    verticalAlign: "top",
  },
  tr: { cursor: "pointer" },
  trSelected: { background: palette.surfaceSelected },
  todayList: { display: "grid", gap: "10px" },
  needsDylanList: { display: "grid", gap: "10px" },
  needsDylanCard: {
    display: "grid",
    gap: "4px",
    padding: "16px",
    borderRadius: "16px",
    border: `1px solid ${palette.blueBorder}`,
    background: palette.bluePale,
    textAlign: "left",
    cursor: "pointer",
  },
  todayCard: {
    display: "grid",
    gap: "4px",
    padding: "16px",
    borderRadius: "16px",
    border: `1px solid ${palette.border}`,
    background: palette.surfaceHover,
    textAlign: "left",
    cursor: "pointer",
  },
  todayCardPrimary: {
    borderColor: palette.orangeBorder,
    background: palette.orangePale,
  },
  todayTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  todayCompany: { fontSize: "16px" },
  todayRole: { fontSize: "13px", color: palette.textSecondary },
  todayCategory: { fontSize: "11px", fontWeight: 700, color: palette.blue },
  todayAction: { margin: "6px 0 0", fontSize: "14px", lineHeight: 1.4 },
  dueDate: { fontSize: "12px", color: palette.textSecondary, fontWeight: 700 },
  pill: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: "999px",
    fontSize: "11px",
    fontWeight: 800,
    textTransform: "uppercase",
  },
  roleGroup: { marginBottom: "20px" },
  roleGroupTitle: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: "0 0 10px",
    fontSize: "15px",
  },
  roleGroupCount: {
    fontSize: "12px",
    padding: "2px 8px",
    borderRadius: "999px",
    background: palette.bluePale,
    color: palette.blue,
    fontWeight: 800,
  },
  roleGroupList: { display: "grid", gap: "8px" },
  roleCard: {
    display: "grid",
    gap: "4px",
    padding: "12px 14px",
    borderRadius: "14px",
    border: `1px solid ${palette.border}`,
    background: palette.surfaceHover,
    textAlign: "left",
    cursor: "pointer",
  },
  roleCardSelected: {
    borderColor: palette.blueBorder,
    background: palette.surfaceSelected,
  },
  roleCardTop: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  muted: { color: palette.textSecondary, fontSize: "12px" },
  empty: { padding: "24px 0" },
};
