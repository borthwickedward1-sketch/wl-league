import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Trophy, Skull, Pencil, Check, X, AlertTriangle, Lock, LockOpen, Clock, PartyPopper, RefreshCw } from "lucide-react";
import { storageGet, storageSet } from "./storage";

const TEAMS = [
  ["ARI", "Arizona Cardinals"], ["ATL", "Atlanta Falcons"], ["BAL", "Baltimore Ravens"],
  ["BUF", "Buffalo Bills"], ["CAR", "Carolina Panthers"], ["CHI", "Chicago Bears"],
  ["CIN", "Cincinnati Bengals"], ["CLE", "Cleveland Browns"], ["DAL", "Dallas Cowboys"],
  ["DEN", "Denver Broncos"], ["DET", "Detroit Lions"], ["GB", "Green Bay Packers"],
  ["HOU", "Houston Texans"], ["IND", "Indianapolis Colts"], ["JAX", "Jacksonville Jaguars"],
  ["KC", "Kansas City Chiefs"], ["LAC", "Los Angeles Chargers"], ["LAR", "Los Angeles Rams"],
  ["LV", "Las Vegas Raiders"], ["MIA", "Miami Dolphins"], ["MIN", "Minnesota Vikings"],
  ["NE", "New England Patriots"], ["NO", "New Orleans Saints"], ["NYG", "New York Giants"],
  ["NYJ", "New York Jets"], ["PHI", "Philadelphia Eagles"], ["PIT", "Pittsburgh Steelers"],
  ["SEA", "Seattle Seahawks"], ["SF", "San Francisco 49ers"], ["TB", "Tampa Bay Buccaneers"],
  ["TEN", "Tennessee Titans"], ["WSH", "Washington Commanders"],
].map(([abbr, name]) => ({ abbr, name }));

const TEAM_NAME = Object.fromEntries(TEAMS.map((t) => [t.abbr, t.name]));

const DRAFT_KEY = "pool-league:draft";
const CACHE_KEY = "pool-league:standings-cache";
const PASSCODE_KEY = "pool-league:passcode";
const MANAGER_COUNT = 10;
const PICKS_PER_MANAGER = 3;

function emptyManagers() {
  return Array.from({ length: MANAGER_COUNT }, (_, i) => ({
    id: `m${i}`,
    name: "",
    teams: [null, null, null],
  }));
}

// Baked-in fallback draft. Used whenever shared storage has nothing saved yet
// (including if a write silently failed to sync to anonymous viewers) so the
// published page always shows real standings instead of the setup screen.
const DEFAULT_DRAFT = {
  managers: [
    { id: "m0", name: "Nicole", teams: ["BUF", "HOU", "MIN"] },
    { id: "m1", name: "Steve", teams: ["DEN", "GB", "LAC"] },
    { id: "m2", name: "Frank", teams: ["BAL", "CHI", "KC"] },
    { id: "m3", name: "Michelle", teams: ["ARI", "NYJ", "CAR"] },
    { id: "m4", name: "Joe C", teams: ["TEN", "LV", "ATL"] },
    { id: "m5", name: "Chris R", teams: ["DAL", "SF", "PIT"] },
    { id: "m6", name: "Mike", teams: ["PHI", "SEA", "TB"] },
    { id: "m7", name: "Matt", teams: ["LAR", "CIN", "JAX"] },
    { id: "m8", name: "Joe R", teams: ["CLE", "MIA", "NO"] },
    { id: "m9", name: "Ed", teams: ["NE", "DET", "IND"] },
  ],
  spareTeams: ["NYG", "WSH"],
  draftOrder: ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"],
};

// Real results as of Week 1, 2026 (updated by asking Claude to refresh this).
// Denver @ Kansas City is Monday Night Football and hasn't been played yet.
const DEFAULT_RECORDS_UPDATED_AT = "2026-09-14T20:00:00-04:00";
const DEFAULT_RECORDS = {
  ARI: { wins: 1, losses: 0, ties: 0 }, ATL: { wins: 0, losses: 1, ties: 0 },
  BAL: { wins: 1, losses: 0, ties: 0 }, BUF: { wins: 1, losses: 0, ties: 0 },
  CAR: { wins: 0, losses: 1, ties: 0 }, CHI: { wins: 1, losses: 0, ties: 0 },
  CIN: { wins: 1, losses: 0, ties: 0 }, CLE: { wins: 0, losses: 1, ties: 0 },
  DAL: { wins: 0, losses: 1, ties: 0 }, DEN: { wins: 0, losses: 0, ties: 0 },
  DET: { wins: 1, losses: 0, ties: 0 }, GB: { wins: 0, losses: 1, ties: 0 },
  HOU: { wins: 0, losses: 1, ties: 0 }, IND: { wins: 0, losses: 1, ties: 0 },
  JAX: { wins: 1, losses: 0, ties: 0 }, KC: { wins: 0, losses: 0, ties: 0 },
  LAC: { wins: 0, losses: 1, ties: 0 }, LAR: { wins: 0, losses: 1, ties: 0 },
  LV: { wins: 1, losses: 0, ties: 0 }, MIA: { wins: 0, losses: 1, ties: 0 },
  MIN: { wins: 1, losses: 0, ties: 0 }, NE: { wins: 0, losses: 1, ties: 0 },
  NO: { wins: 0, losses: 1, ties: 0 }, NYG: { wins: 1, losses: 0, ties: 0 },
  NYJ: { wins: 1, losses: 0, ties: 0 }, PHI: { wins: 1, losses: 0, ties: 0 },
  PIT: { wins: 1, losses: 0, ties: 0 }, SEA: { wins: 1, losses: 0, ties: 0 },
  SF: { wins: 1, losses: 0, ties: 0 }, TB: { wins: 0, losses: 1, ties: 0 },
  TEN: { wins: 0, losses: 1, ties: 0 }, WSH: { wins: 0, losses: 1, ties: 0 },
};

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

function recordStr(s) {
  return s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
}

function statsFor(teamAbbrs, records) {
  let wins = 0, losses = 0, ties = 0;
  teamAbbrs.forEach((abbr) => {
    const r = records[abbr];
    if (r) { wins += r.wins; losses += r.losses; ties += r.ties; }
  });
  const games = wins + losses + ties;
  const winPct = games > 0 ? (wins + 0.5 * ties) / games : 0;
  return { wins, losses, ties, games, winPct };
}

// Walk the ESPN standings JSON tree (its nesting varies) and pull out every
// {team, stats[]} entry we find, keyed by team abbreviation. This only works
// from a real site — Claude's artifact sandbox blocks the fetch entirely.
function extractRecords(data) {
  const out = {};
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.team && Array.isArray(node.stats)) {
      const abbr = node.team.abbreviation;
      if (abbr) {
        const m = {};
        node.stats.forEach((s) => { m[s.name] = s.value; });
        out[abbr] = { wins: m.wins ?? 0, losses: m.losses ?? 0, ties: m.ties ?? 0 };
      }
    }
    Object.values(node).forEach(walk);
  }
  walk(data);
  return out;
}

function timeAgo(iso) {
  if (!iso) return "never";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// Standard 3-round snake: round 1 forward (picks 1-10), round 2 reverse (11-20),
// round 3 forward again (21-30). Returns the manager id on the clock for a given
// zero-based overall pick index, plus which board column that corresponds to.
function snakeSlot(pickIndex, count) {
  const round = Math.floor(pickIndex / count);
  const posInRound = pickIndex % count;
  const col = round % 2 === 0 ? posInRound : count - 1 - posInRound;
  return { round, col };
}

export default function PoolLeague() {
  const [draft, setDraft] = useState(null); // {managers, spareTeams}
  const [draftVersion, setDraftVersion] = useState("new");
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draftDraftState, setDraftDraftState] = useState(null); // working copy while editing

  const [records, setRecords] = useState({});
  const [updatedAt, setUpdatedAt] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const [editingStandings, setEditingStandings] = useState(false);
  const [standingsDraft, setStandingsDraft] = useState(null);

  const [passcode, setPasscode] = useState(null); // null = no lock set yet
  const [unlocked, setUnlocked] = useState(false); // session-only, resets on reload
  const [gateOpen, setGateOpen] = useState(false);
  const [gateAction, setGateAction] = useState(null); // "editPicks" | "updateStandings"
  const [gateInput, setGateInput] = useState("");
  const [gateError, setGateError] = useState("");

  // --- load draft config + saved standings on mount ---
  useEffect(() => {
    (async () => {
      try {
        const d = await storageGet(DRAFT_KEY);
        if (d && d.value) {
          const parsed = JSON.parse(d.value);
          setDraft(parsed);
          setDraftVersion(d.version || "new");
        } else {
          setDraft(DEFAULT_DRAFT);
        }
      } catch (e) {
        setDraft(DEFAULT_DRAFT);
      }
      try {
        const c = await storageGet(CACHE_KEY);
        if (c && c.value) {
          const parsed = JSON.parse(c.value);
          setRecords(parsed.records || {});
          setUpdatedAt(parsed.updatedAt || null);
        } else {
          setRecords(DEFAULT_RECORDS);
          setUpdatedAt(DEFAULT_RECORDS_UPDATED_AT);
        }
      } catch (e) {
        setRecords(DEFAULT_RECORDS);
        setUpdatedAt(DEFAULT_RECORDS_UPDATED_AT);
      }
      try {
        const p = await storageGet(PASSCODE_KEY);
        if (p && p.value) setPasscode(p.value);
      } catch (e) {
        // no passcode set yet, fine
      }
      setLoadingDraft(false);
    })();
  }, []);

  // --- live standings fetch (real site → no sandbox restriction) ---
  const fetchLive = useCallback(async () => {
    setFetching(true);
    setFetchError(null);
    const year = new Date().getFullYear();
    const urls = [
      `https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=${year}&seasontype=2`,
      `https://site.web.api.espn.com/apis/v2/sports/football/nfl/standings?season=${year}&seasontype=2`,
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`ESPN returned ${res.status}`);
        const data = await res.json();
        const rec = extractRecords(data);
        // Early in the week/season ESPN may not have every team populated —
        // that's not a failure, those teams are just still at their prior record.
        TEAMS.forEach((t) => { if (!rec[t.abbr]) rec[t.abbr] = records[t.abbr] || { wins: 0, losses: 0, ties: 0 }; });
        setRecords(rec);
        const now = new Date().toISOString();
        setUpdatedAt(now);
        storageSet(CACHE_KEY, JSON.stringify({ records: rec, updatedAt: now })).catch(() => {});
        setFetching(false);
        return;
      } catch (e) {
        // try the next URL
      }
    }
    setFetchError("Couldn't reach live NFL data right now — showing the last saved standings.");
    setFetching(false);
  }, [records]);

  useEffect(() => {
    if (!loadingDraft && draft) fetchLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingDraft, draft]);

  // --- derived leaderboard ---
  const board = useMemo(() => {
    if (!draft) return [];
    return draft.managers
      .filter((m) => m.teams.every(Boolean))
      .map((m) => ({ ...m, stats: statsFor(m.teams, records) }))
      .sort((a, b) => a.stats.winPct - b.stats.winPct);
  }, [draft, records]);

  const totalGames = board.reduce((s, m) => s + m.stats.games, 0);
  const seasonStarted = totalGames > 0;
  const lowLeaders = board.length ? board.filter((m) => m.stats.winPct === board[0].stats.winPct) : [];
  const highLeaders = board.length ? board.filter((m) => m.stats.winPct === board[board.length - 1].stats.winPct) : [];
  const lowIds = new Set(lowLeaders.map((m) => m.id));
  const highIds = new Set(highLeaders.map((m) => m.id));

  // --- setup / edit flow ---
  const pickedElsewhere = (managerIdx, slotIdx) => {
    const set = new Set();
    draftDraftState.managers.forEach((m, mi) => {
      m.teams.forEach((t, ti) => {
        if (t && !(mi === managerIdx && ti === slotIdx)) set.add(t);
      });
    });
    return set;
  };

  const updatePick = (managerIdx, slotIdx, value) => {
    setDraftDraftState((prev) => {
      const managers = prev.managers.map((m) => ({ ...m, teams: [...m.teams] }));
      managers[managerIdx].teams[slotIdx] = value || null;
      return { ...prev, managers };
    });
  };

  const updateName = (managerIdx, value) => {
    setDraftDraftState((prev) => {
      const managers = prev.managers.map((m) => ({ ...m }));
      managers[managerIdx].name = value;
      return { ...prev, managers };
    });
  };

  const allPicked = draftDraftState
    ? draftDraftState.managers.every((m) => m.teams.every(Boolean))
    : false;
  const namesFilled = draftDraftState
    ? draftDraftState.managers.every((m) => m.name.trim().length > 0)
    : false;

  const saveDraft = async () => {
    const chosen = new Set();
    draftDraftState.managers.forEach((m) => m.teams.forEach((t) => chosen.add(t)));
    const spareTeams = TEAMS.map((t) => t.abbr).filter((a) => !chosen.has(a));
    const payload = { managers: draftDraftState.managers, spareTeams, draftOrder: draftDraftState.draftOrder };
    try {
      const res = await storageSet(DRAFT_KEY, JSON.stringify(payload));
      if (!res) {
        alert("The draft didn't actually save to shared storage — please try again.");
        return;
      }
      setDraft(payload);
      if (res.version) setDraftVersion(res.version);
      setEditing(false);
    } catch (e) {
      alert("Couldn't save the draft — please try again.");
    }
  };

  const startEditing = () => {
    const managers = draft
      ? draft.managers.map((m) => ({ ...m, teams: [...m.teams] }))
      : emptyManagers();
    const draftOrder = draft?.draftOrder && draft.draftOrder.length === managers.length
      ? [...draft.draftOrder]
      : managers.map((m) => m.id);
    setDraftDraftState({ managers, draftOrder });
    setEditing(true);
  };

  const setDraftOrder = (newOrder) => {
    setDraftDraftState((prev) => ({ ...prev, draftOrder: newOrder }));
  };

  const startStandingsEdit = () => {
    const draftTeams = draft ? Array.from(new Set(draft.managers.flatMap((m) => m.teams.filter(Boolean)))) : [];
    const initial = {};
    draftTeams.forEach((abbr) => {
      const r = records[abbr];
      initial[abbr] = r ? { ...r } : { wins: 0, losses: 0, ties: 0 };
    });
    setStandingsDraft(initial);
    setEditingStandings(true);
  };

  const updateStandingsField = (abbr, field, value) => {
    const n = Math.max(0, parseInt(value, 10) || 0);
    setStandingsDraft((prev) => ({ ...prev, [abbr]: { ...prev[abbr], [field]: n } }));
  };

  const saveStandings = async () => {
    try {
      const now = new Date().toISOString();
      const res = await storageSet(CACHE_KEY, JSON.stringify({ records: standingsDraft, updatedAt: now }));
      if (!res) {
        alert("The standings didn't actually save — please try again.");
        return;
      }
      setRecords(standingsDraft);
      setUpdatedAt(now);
      setEditingStandings(false);
    } catch (e) {
      alert("Couldn't save the standings — please try again.");
    }
  };

  // "Edit picks" / "Update standings" go straight through if there's no
  // passcode set, or this browser session already unlocked it — otherwise
  // they ask for the code first, then route to whichever action was requested.
  const handleEditClick = () => {
    if (!passcode || unlocked) {
      startEditing();
    } else {
      setGateAction("editPicks");
      setGateInput("");
      setGateError("");
      setGateOpen(true);
    }
  };

  const handleUpdateStandingsClick = () => {
    if (!passcode || unlocked) {
      startStandingsEdit();
    } else {
      setGateAction("updateStandings");
      setGateInput("");
      setGateError("");
      setGateOpen(true);
    }
  };

  const submitGate = () => {
    if (gateInput === passcode) {
      setUnlocked(true);
      setGateOpen(false);
      if (gateAction === "updateStandings") startStandingsEdit();
      else startEditing();
      setGateAction(null);
    } else {
      setGateError("That's not the right passcode.");
    }
  };

  const savePasscode = async (code) => {
    try {
      const res = await storageSet(PASSCODE_KEY, code);
      if (!res) {
        alert("The passcode didn't actually save — please try again.");
        return;
      }
      setPasscode(code);
      setUnlocked(true); // whoever just set it is already in the editor
    } catch (e) {
      alert("Couldn't save the passcode — please try again.");
    }
  };

  if (loadingDraft) {
    return (
      <Shell>
        <div className="pl-loading">Loading league…</div>
      </Shell>
    );
  }

  if (editing) {
    return (
      <Shell>
        <SetupView
          state={draftDraftState}
          pickedElsewhere={pickedElsewhere}
          updatePick={updatePick}
          updateName={updateName}
          allPicked={allPicked}
          namesFilled={namesFilled}
          onSave={saveDraft}
          onCancel={() => (draft ? setEditing(false) : null)}
          canCancel={!!draft}
          passcode={passcode}
          onSetPasscode={savePasscode}
          draftOrder={draftDraftState.draftOrder}
          onReorder={setDraftOrder}
        />
      </Shell>
    );
  }

  if (editingStandings) {
    return (
      <Shell>
        <StandingsEditView
          draft={standingsDraft}
          teamOrder={draft ? Array.from(new Set(draft.managers.flatMap((m) => m.teams.filter(Boolean)))) : []}
          onChange={updateStandingsField}
          onSave={saveStandings}
          onCancel={() => setEditingStandings(false)}
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="pl-header">
        <div>
          <div className="pl-eyebrow">Season pool</div>
          <h1 className="pl-title">Winners and Losers League</h1>
        </div>
        <div className="pl-headerRight">
          <button className="pl-iconBtn" onClick={fetchLive} disabled={fetching} title="Refresh live standings">
            <RefreshCw size={16} className={fetching ? "pl-spin" : ""} />
            <span>{fetching ? "Updating…" : "Refresh"}</span>
          </button>
          <button className="pl-iconBtn pl-ghost" onClick={handleUpdateStandingsClick} title="Manually correct this week's standings">
            {passcode ? <Lock size={14} /> : <Pencil size={14} />}
            <span>Manual correct</span>
          </button>
          <button className="pl-iconBtn pl-ghost" onClick={handleEditClick} title="Edit draft picks">
            {passcode ? <Lock size={14} /> : <Pencil size={14} />}
            <span>Edit picks</span>
          </button>
        </div>
      </header>
      <div className="pl-updated">Standings updated {timeAgo(updatedAt)}</div>
      {fetchError && (
        <div className="pl-error"><AlertTriangle size={14} />{fetchError}</div>
      )}

      {!seasonStarted && (
        <div className="pl-notice">No games played yet this season — everyone starts at 0.0%.</div>
      )}

      <SpectrumBar board={board} />

      <div className="pl-poles">
        <PoleCard label="Basement Champion" sub="Lowest combined win rate wins this pole" icon={<Skull size={18} />} tone="rust" managers={lowLeaders} />
        <PoleCard label="Win Machine" sub="Highest combined win rate wins this pole" icon={<Trophy size={18} />} tone="gold" managers={highLeaders} />
      </div>

      <BoardTable board={board} lowIds={lowIds} highIds={highIds} />

      {draft?.spareTeams?.length > 0 && (
        <div className="pl-spares">
          <span className="pl-sparesLabel">Undrafted</span>
          {draft.spareTeams.map((a) => (
            <span key={a} className="pl-chip pl-chipMuted">{TEAM_NAME[a] || a}</span>
          ))}
        </div>
      )}

      {gateOpen && (
        <div className="pl-overlay" onClick={() => setGateOpen(false)}>
          <div className="pl-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pl-modalIcon"><Lock size={18} /></div>
            <div className="pl-modalTitle">Enter the commissioner passcode</div>
            <input
              className="pl-input pl-modalInput"
              type="password"
              autoFocus
              value={gateInput}
              onChange={(e) => { setGateInput(e.target.value); setGateError(""); }}
              onKeyDown={(e) => e.key === "Enter" && submitGate()}
              placeholder="Passcode"
            />
            {gateError && <div className="pl-setupWarn">{gateError}</div>}
            <div className="pl-modalActions">
              <button className="pl-iconBtn pl-ghost" onClick={() => setGateOpen(false)}>
                <X size={14} /><span>Cancel</span>
              </button>
              <button className="pl-iconBtn pl-primary" onClick={submitGate}>
                <LockOpen size={14} /><span>Unlock</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="pl-root">
      <style>{CSS}</style>
      {children}
    </div>
  );
}

function SpectrumBar({ board }) {
  if (board.length === 0) return null;
  const sorted = [...board].sort((a, b) => b.stats.winPct - a.stats.winPct);

  // Scale the track to the actual spread of win% this season, rather than a
  // fixed 0-100 range, so differences between managers are easier to see.
  const pcts = sorted.map((m) => m.stats.winPct);
  let domainMin = Math.min(...pcts);
  let domainMax = Math.max(...pcts);
  if (domainMin === domainMax) { domainMin -= 0.05; domainMax += 0.05; } // avoid a zero-width scale
  const domainMid = (domainMin + domainMax) / 2;
  const span = domainMax - domainMin;
  const posOf = (v) => ((v - domainMin) / span) * 100;
  const centerPos = posOf(domainMid);

  return (
    <div className="pl-spectrum">
      <div className="pl-barHeaderRow">
        <span />
        <div className="pl-barScale">
          <span>{pct(domainMin)}</span><span>{pct(domainMid)}</span><span>{pct(domainMax)}</span>
        </div>
        <span />
      </div>
      <div className="pl-barsWrap">
        {sorted.map((m) => {
          const valuePos = posOf(m.stats.winPct);
          const above = m.stats.winPct >= domainMid;
          const left = Math.min(centerPos, valuePos);
          const width = Math.max(0, Math.abs(valuePos - centerPos));
          return (
            <div className="pl-barRow" key={m.id} title={`${m.name}: ${pct(m.stats.winPct)}`}>
              <div className="pl-barName">{m.name}</div>
              <div className="pl-barTrack">
                <div className="pl-barCenterLine" style={{ left: `${centerPos}%` }} />
                <div
                  className={`pl-barFill ${above ? "pl-barFillGold" : "pl-barFillRust"}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </div>
              <div className="pl-barPct">{pct(m.stats.winPct)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PoleCard({ label, sub, icon, tone, managers }) {
  return (
    <div className={`pl-pole pl-pole-${tone}`}>
      <div className="pl-poleIcon">{icon}</div>
      <div className="pl-poleLabel">{label}</div>
      <div className="pl-poleSub">{sub}</div>
      {managers && managers.length > 0 ? (
        <>
          <div className="pl-poleStat">
            {pct(managers[0].stats.winPct)}
            {managers.length > 1 && <span className="pl-poleTieNote">{managers.length}-way tie</span>}
          </div>
          <div className="pl-poleManagers">
            {managers.map((m) => (
              <div className="pl-poleManagerBlock" key={m.id}>
                <div className="pl-poleManagerRow">
                  <span className="pl-poleManager">{m.name}</span>
                  <span className="pl-poleRecord">({recordStr(m.stats)})</span>
                </div>
                <div className="pl-poleTeams">
                  {m.teams.map((a) => (
                    <span key={a} className="pl-chip">{TEAM_NAME[a] || a}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="pl-poleEmpty">Set up the draft to see standings</div>
      )}
    </div>
  );
}

function BoardTable({ board, lowIds, highIds }) {
  if (board.length === 0) return null;
  return (
    <div className="pl-standings">
      <div className="pl-standingsHeader">
        <span>Manager</span>
        <span>Record · Win %</span>
      </div>
      {[...board].reverse().map((m) => (
        <div
          key={m.id}
          className={`pl-stRow ${lowIds.has(m.id) ? "pl-stRowLow" : highIds.has(m.id) ? "pl-stRowHigh" : ""}`}
        >
          <div className="pl-stTop">
            <div className="pl-stName">
              {m.name}
              {highIds.has(m.id) && <Trophy size={13} className="pl-inlineIcon pl-gold" />}
              {lowIds.has(m.id) && <Skull size={13} className="pl-inlineIcon pl-rust" />}
            </div>
            <div className="pl-stRight">
              <div className="pl-statBlock">
                <span className="pl-statLabel">Record</span>
                <span className="pl-statValue">{recordStr(m.stats)}</span>
              </div>
              <div className="pl-statBlock">
                <span className="pl-statLabel">Win %</span>
                <span className="pl-statValue">{pct(m.stats.winPct)}</span>
              </div>
            </div>
          </div>
          <div className="pl-stTeams">
            {m.teams.map((a) => (
              <span key={a} className="pl-chip pl-chipSmall">{a}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function StandingsEditView({ draft, teamOrder, onChange, onSave, onCancel }) {
  if (!draft) return null;
  return (
    <div className="pl-setup">
      <div className="pl-eyebrow">Update this week's records</div>
      <h1 className="pl-title">Enter each team's W–L–T</h1>
      <p className="pl-setupHint">
        Only the 30 drafted teams are listed. Enter each team's total wins, losses, and ties
        for the season so far — check espn.com/nfl/standings for the current numbers.
      </p>

      <div className="pl-standingsForm">
        {teamOrder.map((abbr) => (
          <div className="pl-standingsRow" key={abbr}>
            <div className="pl-standingsTeamName">{TEAM_NAME[abbr] || abbr}</div>
            <div className="pl-standingsInputs">
              <label className="pl-standingsField">
                <span>W</span>
                <input
                  type="number" min="0" inputMode="numeric" className="pl-standingsInput"
                  value={draft[abbr]?.wins ?? 0}
                  onChange={(e) => onChange(abbr, "wins", e.target.value)}
                />
              </label>
              <label className="pl-standingsField">
                <span>L</span>
                <input
                  type="number" min="0" inputMode="numeric" className="pl-standingsInput"
                  value={draft[abbr]?.losses ?? 0}
                  onChange={(e) => onChange(abbr, "losses", e.target.value)}
                />
              </label>
              <label className="pl-standingsField">
                <span>T</span>
                <input
                  type="number" min="0" inputMode="numeric" className="pl-standingsInput"
                  value={draft[abbr]?.ties ?? 0}
                  onChange={(e) => onChange(abbr, "ties", e.target.value)}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="pl-setupActions">
        <button className="pl-iconBtn pl-ghost" onClick={onCancel}>
          <X size={14} /><span>Cancel</span>
        </button>
        <button className="pl-iconBtn pl-primary" onClick={onSave}>
          <Check size={14} /><span>Save standings</span>
        </button>
      </div>
    </div>
  );
}

function PasscodeBox({ passcode, onSetPasscode }) {
  const [open, setOpen] = useState(false);
  const [code1, setCode1] = useState("");
  const [code2, setCode2] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    if (code1.length < 4) { setErr("Use at least 4 characters."); return; }
    if (code1 !== code2) { setErr("Passcodes don't match."); return; }
    onSetPasscode(code1);
    setOpen(false);
    setCode1(""); setCode2(""); setErr("");
  };

  if (!open) {
    return (
      <div className="pl-lockBox">
        {passcode ? (
          <>
            <Lock size={14} />
            <span>Editing is locked with a commissioner passcode.</span>
            <button className="pl-linkBtn" onClick={() => setOpen(true)}>Change it</button>
          </>
        ) : (
          <>
            <LockOpen size={14} />
            <span>Anyone with this link can currently edit picks.</span>
            <button className="pl-linkBtn" onClick={() => setOpen(true)}>Set a passcode</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="pl-lockBox pl-lockBoxOpen">
      <div className="pl-lockForm">
        <input className="pl-input" type="password" placeholder="New passcode" value={code1} onChange={(e) => { setCode1(e.target.value); setErr(""); }} />
        <input className="pl-input" type="password" placeholder="Confirm passcode" value={code2} onChange={(e) => { setCode2(e.target.value); setErr(""); }} />
        <button className="pl-iconBtn pl-primary" onClick={submit}><Check size={14} /><span>Save</span></button>
        <button className="pl-iconBtn pl-ghost" onClick={() => { setOpen(false); setErr(""); }}><X size={14} /><span>Cancel</span></button>
      </div>
      {err && <div className="pl-setupWarn">{err}</div>}
    </div>
  );
}

function DraftOrderTab({ managers, draftOrder, onReorder, totalPicked, availableTeams }) {
  const order = draftOrder && draftOrder.length === managers.length ? draftOrder : managers.map((m) => m.id);
  const byId = useMemo(() => Object.fromEntries(managers.map((m) => [m.id, m])), [managers]);

  const nameFor = (id, col) => {
    const nm = byId[id]?.name?.trim();
    return nm || `Pick ${col + 1}`;
  };

  const move = (idx, dir) => {
    const next = [...order];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onReorder(next);
  };

  const TOTAL = MANAGER_COUNT * PICKS_PER_MANAGER; // 30
  const draftComplete = totalPicked >= TOTAL;
  const currentIndex = Math.min(totalPicked, TOTAL - 1);
  const { round, col } = snakeSlot(currentIndex, MANAGER_COUNT);
  const onClockId = order[col];

  return (
    <div className="pl-orderWrap">
      <p className="pl-setupHint" style={{ marginTop: 0 }}>
        Set your draft order below (position 1 picks first). It snakes: round 1 goes 1→10,
        round 2 goes 10→1, round 3 goes 1→10 again — 30 picks total. The clock tracks itself
        as picks fill in on the Draft board tab.
      </p>

      {!draftComplete ? (
        <div className="pl-clockBanner">
          <div className="pl-clockPulseDot" />
          <div className="pl-clockInfo">
            <div className="pl-clockEyebrow">Pick {currentIndex + 1} of {TOTAL} · Round {round + 1}</div>
            <div className="pl-clockName">{nameFor(onClockId, col)} is on the clock</div>
          </div>
          <div className="pl-clockBadge">
            <Clock size={16} />
            <span>0:69</span>
          </div>
        </div>
      ) : (
        <div className="pl-clockBanner pl-clockDone">
          <PartyPopper size={20} />
          <div className="pl-clockName">Draft complete — nice work.</div>
        </div>
      )}

      <div className="pl-snakeBoard">
        {[0, 1, 2].map((r) => (
          <div className="pl-snakeRow" key={r}>
            <div className="pl-snakeRoundLabel">
              R{r + 1} <span className="pl-snakeArrow">{r % 2 === 0 ? "→" : "←"}</span>
            </div>
            <div className="pl-snakeCells">
              {order.map((id, c) => {
                const isCurrent = !draftComplete && r === round && c === col;
                const isPast = r < round || (r === round && c < col) || draftComplete;
                return (
                  <div
                    key={`${r}-${c}`}
                    className={`pl-snakeCell ${isCurrent ? "pl-snakeCellCurrent" : ""} ${isPast ? "pl-snakeCellPast" : ""}`}
                  >
                    {isCurrent && <span className="pl-snakeEmoji">🐍</span>}
                    <span className="pl-snakeCellName">{nameFor(id, c)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="pl-availableWrap">
        <div className="pl-availableHeader">Remaining teams ({availableTeams.length})</div>
        {availableTeams.length === 0 ? (
          <div className="pl-poleEmpty">Every team has been picked or spared.</div>
        ) : (
          <div className="pl-availableGrid">
            {availableTeams.map((t) => (
              <span key={t.abbr} className="pl-chip pl-chipAvailable">{t.name}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SetupView({ state, pickedElsewhere, updatePick, updateName, allPicked, namesFilled, onSave, onCancel, canCancel, passcode, onSetPasscode, draftOrder, onReorder }) {
  const [tab, setTab] = useState("assign"); // "assign" | "available" | "order"
  const totalPicked = state.managers.reduce((s, m) => s + m.teams.filter(Boolean).length, 0);

  const pickedSet = useMemo(() => {
    const s = new Set();
    state.managers.forEach((m) => m.teams.forEach((t) => t && s.add(t)));
    return s;
  }, [state.managers]);
  const availableTeams = TEAMS.filter((t) => !pickedSet.has(t.abbr));

  return (
    <div className="pl-setup">
      <div className="pl-eyebrow">Set up the league</div>
      <h1 className="pl-title">Assign 3 teams to each manager</h1>
      <p className="pl-setupHint">
        {totalPicked} of {MANAGER_COUNT * PICKS_PER_MANAGER} teams assigned — 2 teams will be left undrafted.
      </p>

      <PasscodeBox passcode={passcode} onSetPasscode={onSetPasscode} />

      <div className="pl-tabs">
        <button className={`pl-tab ${tab === "assign" ? "pl-tabActive" : ""}`} onClick={() => setTab("assign")}>
          Draft board
        </button>
        <button className={`pl-tab ${tab === "order" ? "pl-tabActive" : ""}`} onClick={() => setTab("order")}>
          🐍 Draft order
        </button>
      </div>

      {tab === "order" && (
        <DraftOrderTab managers={state.managers} draftOrder={draftOrder} onReorder={onReorder} totalPicked={totalPicked} availableTeams={availableTeams} />
      )}

      {tab === "assign" && (
      <>
      <div className="pl-setupGrid">
        {state.managers.map((m, mi) => (
          <div className="pl-setupRow" key={m.id}>
            <input
              className="pl-input"
              placeholder={`Manager ${mi + 1} name`}
              value={m.name}
              onChange={(e) => updateName(mi, e.target.value)}
            />
            <div className="pl-managerPicks">
              {[0, 1, 2].map((si) => (
                m.teams[si] ? (
                  <span key={si} className="pl-chip pl-chipPicked">{TEAM_NAME[m.teams[si]] || m.teams[si]}</span>
                ) : (
                  <span key={si} className="pl-chip pl-chipEmpty">Empty</span>
                )
              ))}
            </div>
            <div className="pl-selects">
              {[0, 1, 2].map((si) => {
                const taken = pickedElsewhere(mi, si);
                return (
                  <select
                    key={si}
                    className="pl-select"
                    value={m.teams[si] || ""}
                    onChange={(e) => updatePick(mi, si, e.target.value)}
                  >
                    <option value="">Team {si + 1}</option>
                    {TEAMS.filter((t) => !taken.has(t.abbr)).map((t) => (
                      <option key={t.abbr} value={t.abbr}>{t.name}</option>
                    ))}
                  </select>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      </>
      )}

      <div className="pl-setupActions">
        {canCancel && (
          <button className="pl-iconBtn pl-ghost" onClick={onCancel}>
            <X size={14} /><span>Cancel</span>
          </button>
        )}
        <button className="pl-iconBtn pl-primary" onClick={onSave} disabled={!allPicked || !namesFilled}>
          <Check size={14} /><span>Save draft</span>
        </button>
      </div>
      {!allPicked && <div className="pl-setupWarn">Every manager needs exactly 3 teams before you can save.</div>}
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');

.pl-root {
  --bg: #10140F;
  --surface: #1A2118;
  --surface-raised: #212B1D;
  --line: #2C382A;
  --ink: #F2EFE4;
  --muted: #8FA08A;
  --gold: #E3A94C;
  --gold-dim: #4A3B22;
  --rust: #C1502E;
  --rust-dim: #3D2620;
  background: var(--bg);
  color: var(--ink);
  font-family: 'Inter', sans-serif;
  padding: 28px;
  border-radius: 16px;
  max-width: 900px;
  margin: 0 auto;
  box-sizing: border-box;
}
.pl-root * { box-sizing: border-box; }
.pl-loading { padding: 60px 0; text-align: center; color: var(--muted); font-family: 'JetBrains Mono', monospace; }

.pl-eyebrow {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 4px;
}
.pl-title {
  font-family: 'Anton', sans-serif;
  font-weight: 400;
  font-size: 34px;
  letter-spacing: 0.01em;
  margin: 0;
  line-height: 1.05;
}

.pl-header { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 14px; margin-bottom: 4px; }
.pl-headerRight { display: flex; gap: 8px; flex-wrap: wrap; }

.pl-iconBtn {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--gold); color: #1A1305;
  border: none; border-radius: 999px;
  padding: 9px 16px; font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13px;
  cursor: pointer;
}
.pl-iconBtn:disabled { opacity: 0.55; cursor: default; }
.pl-iconBtn.pl-ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
.pl-iconBtn.pl-primary { background: var(--gold); color: #1A1305; }
.pl-spin { animation: pl-spin 0.9s linear infinite; }
@keyframes pl-spin { to { transform: rotate(360deg); } }

.pl-updated { color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 12px; margin: 10px 0 4px; }
.pl-error { display: flex; align-items: center; gap: 6px; color: var(--rust); font-size: 13px; margin-bottom: 8px; }
.pl-notice { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; font-size: 13px; color: var(--muted); margin: 10px 0; }

.pl-spectrum { margin: 26px 0 20px; }
.pl-barHeaderRow { display: grid; grid-template-columns: 72px 1fr 48px; gap: 8px; margin-bottom: 8px; }
.pl-barScale { display: flex; justify-content: space-between; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted); }
.pl-barsWrap { display: flex; flex-direction: column; gap: 7px; }
.pl-barRow { display: grid; grid-template-columns: 72px 1fr 48px; gap: 8px; align-items: center; }
.pl-barName { font-size: 12px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pl-barTrack { position: relative; height: 16px; background: var(--surface); border: 1px solid var(--line); border-radius: 4px; overflow: hidden; }
.pl-barCenterLine { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: var(--line); z-index: 1; }
.pl-barFill { position: absolute; top: 1px; bottom: 1px; border-radius: 2px; min-width: 2px; }
.pl-barFillGold { background: var(--gold); }
.pl-barFillRust { background: var(--rust); }
.pl-barPct { font-family: 'JetBrains Mono', monospace; font-size: 11px; text-align: right; color: var(--muted); }

.pl-poles { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 22px; }
.pl-pole { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px; }
.pl-pole-gold { border-color: var(--gold-dim); }
.pl-pole-rust { border-color: var(--rust-dim); }
.pl-poleIcon { color: var(--muted); margin-bottom: 6px; }
.pl-pole-gold .pl-poleIcon { color: var(--gold); }
.pl-pole-rust .pl-poleIcon { color: var(--rust); }
.pl-poleLabel { font-family: 'Anton', sans-serif; font-size: 18px; letter-spacing: 0.02em; }
.pl-poleSub { color: var(--muted); font-size: 12px; margin: 2px 0 12px; }
.pl-poleStat { font-family: 'JetBrains Mono', monospace; font-size: 22px; margin: 2px 0 10px; display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.pl-poleTieNote { font-family: 'Inter', sans-serif; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); background: var(--surface-raised); border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; }
.pl-poleManagers { display: flex; flex-direction: column; gap: 10px; }
.pl-poleManagerBlock + .pl-poleManagerBlock { padding-top: 10px; border-top: 1px dashed var(--line); }
.pl-poleManagerRow { display: flex; align-items: baseline; gap: 6px; margin-bottom: 6px; }
.pl-poleManager { font-weight: 700; font-size: 15px; }
.pl-poleRecord { color: var(--muted); font-size: 13px; }
.pl-poleTeams { display: flex; flex-wrap: wrap; gap: 6px; }
.pl-poleEmpty { color: var(--muted); font-size: 13px; }

.pl-chip { display: inline-block; background: var(--surface-raised); border: 1px solid var(--line); border-radius: 999px; padding: 3px 10px; font-size: 12px; color: var(--ink); }
.pl-chipSmall { padding: 2px 8px; font-family: 'JetBrains Mono', monospace; font-size: 11px; }
.pl-chipMuted { color: var(--muted); }

.pl-standings { display: flex; flex-direction: column; margin-top: 8px; }
.pl-standingsHeader {
  display: flex; justify-content: space-between; font-family: 'JetBrains Mono', monospace; font-size: 11px;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); padding: 0 4px 8px; border-bottom: 1px solid var(--line);
}
.pl-stRow { padding: 12px 4px; border-bottom: 1px solid var(--line); }
.pl-stRow:last-child { border-bottom: none; }
.pl-stRowHigh { box-shadow: inset 3px 0 0 var(--gold); padding-left: 10px; }
.pl-stRowLow { box-shadow: inset 3px 0 0 var(--rust); padding-left: 10px; }
.pl-stTop { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 8px; }
.pl-stName { font-weight: 700; font-size: 15px; display: flex; align-items: center; gap: 6px; min-width: 0; }
.pl-inlineIcon.pl-gold { color: var(--gold); flex-shrink: 0; }
.pl-inlineIcon.pl-rust { color: var(--rust); flex-shrink: 0; }
.pl-stRight { display: flex; align-items: flex-start; gap: 44px; flex-shrink: 0; }
.pl-statBlock { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.pl-statLabel { font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.pl-statValue { font-family: 'JetBrains Mono', monospace; font-size: 15px; font-weight: 600; color: var(--ink); }
.pl-stTeams { display: flex; flex-wrap: wrap; gap: 6px; }

.pl-spares { margin-top: 18px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pl-sparesLabel { font-family: 'JetBrains Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }

.pl-overlay {
  position: fixed; inset: 0; background: rgba(8,10,7,0.72);
  display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px;
}
.pl-modal {
  background: var(--surface); border: 1px solid var(--line); border-radius: 14px;
  padding: 22px; width: 100%; max-width: 320px; text-align: center;
}
.pl-modalIcon { color: var(--gold); margin-bottom: 6px; display: flex; justify-content: center; }
.pl-modalTitle { font-weight: 600; font-size: 15px; margin-bottom: 14px; }
.pl-modalInput { width: 100%; margin-bottom: 6px; text-align: center; }
.pl-modalActions { display: flex; gap: 8px; margin-top: 14px; justify-content: center; }

.pl-lockBox {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  background: var(--surface); border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 14px; font-size: 13px; color: var(--muted); margin-bottom: 18px;
}
.pl-lockBoxOpen { align-items: flex-start; flex-direction: column; }
.pl-lockForm { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.pl-linkBtn { background: none; border: none; color: var(--gold); font-weight: 600; font-size: 13px; cursor: pointer; padding: 0; text-decoration: underline; }

.pl-orderWrap { }

.pl-clockBanner {
  display: flex; align-items: center; gap: 12px;
  background: linear-gradient(90deg, var(--gold-dim), var(--surface));
  border: 1px solid var(--gold-dim); border-radius: 12px; padding: 14px 16px; margin-bottom: 18px;
}
.pl-clockDone { background: linear-gradient(90deg, var(--gold-dim), var(--surface)); color: var(--gold); gap: 10px; }
.pl-clockPulseDot { width: 10px; height: 10px; border-radius: 50%; background: var(--gold); flex-shrink: 0; animation: pl-pulse 1.4s ease-in-out infinite; }
@keyframes pl-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.7); } }
.pl-clockInfo { flex: 1; min-width: 0; }
.pl-clockEyebrow { font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.pl-clockName { font-weight: 700; font-size: 16px; }
.pl-clockBadge {
  display: flex; align-items: center; gap: 6px; font-family: 'JetBrains Mono', monospace; font-weight: 600;
  background: var(--surface-raised); border: 1px solid var(--gold-dim); color: var(--gold);
  border-radius: 8px; padding: 6px 12px; font-size: 15px; flex-shrink: 0; animation: pl-pulse 1.4s ease-in-out infinite;
}

.pl-snakeBoard { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; }
.pl-snakeRow { display: flex; align-items: center; gap: 10px; }
.pl-snakeRoundLabel { width: 42px; flex-shrink: 0; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--muted); }
.pl-snakeArrow { color: var(--gold); }
.pl-snakeCells { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; flex: 1; }
.pl-snakeCell {
  position: relative; background: var(--surface); border: 1px solid var(--line); border-radius: 6px;
  padding: 6px 4px; text-align: center; min-height: 34px; display: flex; align-items: center; justify-content: center;
  transition: background 0.4s ease, border-color 0.4s ease, transform 0.4s ease;
}
.pl-snakeCellPast { opacity: 0.45; }
.pl-snakeCellCurrent {
  background: var(--gold); border-color: var(--gold); opacity: 1; transform: scale(1.08);
  box-shadow: 0 0 0 3px var(--gold-dim); z-index: 2;
}
.pl-snakeCellName { font-size: 9px; color: var(--muted); line-height: 1.2; word-break: break-word; }
.pl-snakeCellCurrent .pl-snakeCellName { color: #1A1305; font-weight: 700; }
.pl-snakeEmoji { position: absolute; top: -20px; font-size: 18px; animation: pl-slither 1.2s ease-in-out infinite; }
@keyframes pl-slither { 0%, 100% { transform: translateX(-2px) rotate(-8deg); } 50% { transform: translateX(2px) rotate(8deg); } }

.pl-orderList { display: flex; flex-direction: column; gap: 6px; }
.pl-orderRow { display: flex; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.pl-orderNum { font-family: 'JetBrains Mono', monospace; color: var(--gold); font-weight: 700; width: 20px; }
.pl-orderName { flex: 1; font-weight: 600; font-size: 13px; }
.pl-orderBtns { display: flex; gap: 4px; }
.pl-orderBtn {
  background: var(--surface-raised); border: 1px solid var(--line); color: var(--ink);
  border-radius: 6px; width: 26px; height: 26px; cursor: pointer; font-size: 13px;
}
.pl-orderBtn:disabled { opacity: 0.3; cursor: default; }

.pl-tabs { display: flex; gap: 6px; margin-bottom: 16px; }
.pl-tab {
  background: var(--surface); border: 1px solid var(--line); color: var(--muted);
  border-radius: 999px; padding: 8px 16px; font-family: 'Inter', sans-serif; font-weight: 600; font-size: 13px; cursor: pointer;
}
.pl-tab.pl-tabActive { background: var(--gold); color: #1A1305; border-color: var(--gold); }
.pl-availableWrap { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-bottom: 16px; }
.pl-availableHeader { font-family: 'JetBrains Mono', monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin-bottom: 10px; }
.pl-availableGrid { display: flex; flex-wrap: wrap; gap: 8px; }
.pl-chipAvailable { background: var(--surface-raised); border-color: var(--gold-dim); }

.pl-managerPicks { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; order: 3; margin-top: 2px; }
.pl-chipPicked { border-color: var(--gold-dim); }
.pl-chipEmpty { color: var(--muted); border-style: dashed; }

.pl-standingsForm { display: flex; flex-direction: column; gap: 8px; }
.pl-standingsRow { display: flex; align-items: center; justify-content: space-between; gap: 10px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.pl-standingsTeamName { font-size: 13px; font-weight: 600; flex: 1; min-width: 0; }
.pl-standingsInputs { display: flex; gap: 8px; flex-shrink: 0; }
.pl-standingsField { display: flex; flex-direction: column; align-items: center; gap: 3px; font-family: 'JetBrains Mono', monospace; font-size: 10px; color: var(--muted); }
.pl-standingsInput { width: 40px; background: var(--surface-raised); border: 1px solid var(--line); color: var(--ink); border-radius: 6px; padding: 5px 4px; text-align: center; font-family: 'JetBrains Mono', monospace; font-size: 13px; }

.pl-setup { }
.pl-setupHint { color: var(--muted); font-size: 13px; margin: 8px 0 18px; }
.pl-setupGrid { display: flex; flex-direction: column; gap: 10px; }
.pl-setupRow { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.pl-input { background: var(--surface-raised); border: 1px solid var(--line); color: var(--ink); border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: 'Inter', sans-serif; width: 160px; flex-shrink: 0; }
.pl-selects { display: flex; gap: 8px; flex-wrap: wrap; flex: 1; }
.pl-select { background: var(--surface-raised); border: 1px solid var(--line); color: var(--ink); border-radius: 8px; padding: 8px 10px; font-size: 13px; font-family: 'Inter', sans-serif; flex: 1; min-width: 150px; }
.pl-setupActions { display: flex; gap: 10px; margin-top: 18px; }
.pl-setupWarn { color: var(--rust); font-size: 12px; margin-top: 10px; }

@media (max-width: 640px) {
  .pl-root { padding: 18px; }
  .pl-title { font-size: 26px; }
  .pl-poles { grid-template-columns: 1fr; }
  .pl-input { width: 100%; }
  .pl-snakeRoundLabel { width: 30px; font-size: 9px; }
  .pl-snakeCellName { font-size: 7px; }
  .pl-clockBanner { flex-wrap: wrap; }
}
`;
