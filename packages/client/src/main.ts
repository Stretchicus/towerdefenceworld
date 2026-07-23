import "./styles.css";
import { BuildOverlay } from "./buildOverlay.js";
import { GameSocket, type ServerMessage } from "./net.js";
import { PlanetView, shadeBodColor, type PlanetViewData } from "./planetView.js";
import {
  bindWorkshop,
  createWorkshopState,
  isWorkshopValid,
  workshopHtml,
  type WorkshopState,
} from "./loadoutWorkshop.js";
import { resourceAmountHtml, resourceLabel } from "./resourceIcons.js";
import { towerVisualIconHtml } from "./towerVisualIcons.js";
import {
  DEFAULT_TOWER_VISUAL,
  type TowerDef,
} from "@tdw/game-core";

interface LobbyState {
  phase: "lobby";
  room: string;
  settings: {
    mode: string;
    winRule: string;
    worldSize: string;
    placementMode: string;
    resourceCount: number;
    seatCount: number;
  };
  seats: {
    id: string;
    name: string;
    isAi: boolean;
    ready: boolean;
    loadout?: TowerDef[];
  }[];
  hostId: string;
}

interface MatchState {
  phase: string;
  tick: number;
  settings: LobbyState["settings"];
  resources: string[];
  bagIndex: number;
  bagTotal: number;
  currentSeat: number;
  currentPlayerId: string | null;
  placementMode: string;
  currentTile: {
    id?: string;
    routeKind?: string;
    connections?: boolean[];
    hasTowerPoint?: boolean;
    hasMine?: boolean;
    mineResourceId?: string;
  } | null;
  legalPlacements: { cellId: number; rotation: number }[];
  winnerIds: string[];
  planet: {
    baseCellIds: number[];
    cells: PlanetViewData["cells"];
  };
  placed: PlanetViewData["placed"];
  players: {
    id: string;
    name: string;
    teamId: string;
    isAi: boolean;
    bank: Record<string, number>;
    baseHp: number;
    baseLevel?: number;
    targetEnabled: Record<string, boolean>;
    bodEnabled: Record<string, boolean>;
    bodLevels?: Record<string, number>;
    alive: boolean;
    baseCellId: number;
    loadout?: TowerDef[];
  }[];
  towers: {
    id: string;
    cellId: number;
    ownerId: string;
    typeId?: string;
    level?: number;
    friendlyFire: boolean;
  }[];
  mines: { cellId: number; id?: string; ownerId?: string; resourceId?: string }[];
  bods: {
    id: string;
    cellId: number;
    ownerId: string;
    typeId?: string;
    hp?: number;
    maxHp?: number;
    path?: number[];
    pathIndex?: number;
    moveCooldown?: number;
    pickups?: string[];
  }[];
  corridorCellIds?: number[];
  bodMoveEveryTicks?: number;
  costs?: {
    baseUpgradeBase: Record<string, number>;
    baseUpgradeLevelIncrease: number;
    bods: Record<string, Record<string, number>>;
    bodUpgrades?: Record<
      string,
      { base: Record<string, number>; levelIncrease: number }
    >;
  };
}

const CLIENT_BUILD = "v0.1.54";
const FALLBACK_TOWER = { stone: 70, power: 55 };
const PLAYER_COLORS = ["#3dd6c6", "#f0a05a", "#7aa2ff", "#e07ad8"];
const TOWER_TYPE_COLORS: Record<string, string> = {
  basic: "#3dd6c6",
  sniper: "#7aa2ff",
  mortar: "#f0a05a",
};

const app = document.getElementById("app")!;
app.innerHTML = `
  <header class="top">
    <div class="top-row">
      <h1>TOWER DEFENCE WORLD <span class="build-tag">${CLIENT_BUILD}</span></h1>
      <div class="header-actions">
        <div class="meta" id="status">Connecting…</div>
        <button type="button" id="btn-leave" class="secondary leave-btn" hidden>Leave room</button>
      </div>
    </div>
    <div class="health-bar" id="health-bar" hidden>
      <div class="health-bar-track" id="health-bar-track"></div>
    </div>
  </header>
  <div id="viewport">
    <div class="hud" id="hud"></div>
  </div>
`;

const viewport = document.getElementById("viewport")!;
const hud = document.getElementById("hud")!;
const statusEl = document.getElementById("status")!;
const leaveBtn = document.getElementById("btn-leave") as HTMLButtonElement;
const healthBar = document.getElementById("health-bar") as HTMLElement;
const healthBarTrack = document.getElementById(
  "health-bar-track",
) as HTMLElement;

const socket = new GameSocket();
const planet = new PlanetView(viewport);
const buildOverlay = new BuildOverlay(viewport, () => {
  if (selectedBuildCell === null || !lastMatch || lastMatch.phase !== "combat") {
    return;
  }
  const self = me();
  const loadout = myLoadout(lastMatch);
  const anyAfford = loadout.some(
    (t) => self && canAffordCost(self.bank, towerBuildCost(lastMatch!, t.id)),
  );
  if (!anyAfford) return;
  showBuildPopup = true;
  buildOverlay.hide();
  lastError = "";
  paint();
});

let roomCode: string | null = localStorage.getItem("tdw_room");
let token: string | null = localStorage.getItem("tdw_token");
let playerId: string | null = localStorage.getItem("tdw_player");
let lastLobby: LobbyState | null = null;
let lastMatch: MatchState | null = null;
let lastError = "";
let planetBuiltFor = "";
let hudShellKey = "";
let selectedBuildCell: number | null = null;
let showBuildPopup = false;
let placementRotation = 0;
let hoverCellId: number | null = null;
let workshop: WorkshopState | null = null;
let workshopSyncKey = "";
let pushLoadoutTimer: ReturnType<typeof setTimeout> | null = null;

const params = new URLSearchParams(location.search);
const joinRoom = params.get("room");

function me() {
  return lastMatch?.players.find((p) => p.id === playerId) ?? null;
}

function inRoom(): boolean {
  return Boolean(lastLobby || lastMatch);
}

function updateLeaveBtn(): void {
  leaveBtn.hidden = !inRoom();
}

function leaveRoom(): void {
  if (inRoom()) socket.send({ type: "leave" });
  resetToMenu();
}

function resetToMenu(): void {
  roomCode = null;
  token = null;
  playerId = null;
  lastLobby = null;
  lastMatch = null;
  lastError = "";
  planetBuiltFor = "";
  hudShellKey = "";
  selectedBuildCell = null;
  showBuildPopup = false;
  workshop = null;
  workshopSyncKey = "";
  if (pushLoadoutTimer) {
    clearTimeout(pushLoadoutTimer);
    pushLoadoutTimer = null;
  }
  localStorage.removeItem("tdw_room");
  localStorage.removeItem("tdw_token");
  localStorage.removeItem("tdw_player");
  history.replaceState({}, "", location.pathname);
  statusEl.textContent = "Link online";
  updateLeaveBtn();
  paint();
}

leaveBtn.addEventListener("click", () => leaveRoom());

function updateHealthBar(m: MatchState | null): void {
  if (!m || m.phase === "lobby") {
    healthBar.hidden = true;
    healthBarTrack.innerHTML = "";
    return;
  }
  healthBar.hidden = false;
  const total = m.players.reduce(
    (sum, p) => sum + Math.max(0, p.baseHp),
    0,
  );
  healthBarTrack.innerHTML = m.players
    .map((p, i) => {
      const hp = Math.max(0, p.baseHp);
      const flex = total > 0 ? hp : 1;
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length]!;
      const mine = p.id === playerId;
      const dead = !p.alive || hp <= 0;
      return `<div class="health-seg ${mine ? "mine" : ""} ${dead ? "dead" : ""}" style="flex:${flex} 1 0;background:${color}" title="${p.name}: ${hp.toFixed(0)} HP">
        <span class="health-seg-label">${p.name}${mine ? " ←" : ""} · ${hp.toFixed(0)}</span>
      </div>`;
    })
    .join("");
}

function freeTowerPads(m: MatchState): number[] {
  const occupied = new Set(m.towers.map((t) => t.cellId));
  return m.placed
    .filter((p) => p.tile.hasTowerPoint && !occupied.has(p.cellId))
    .map((p) => p.cellId);
}

function anyTowerAffordable(m: MatchState): boolean {
  const self = me();
  if (!self) return false;
  return myLoadout(m).some((t) =>
    canAffordCost(self.bank, towerBuildCost(m, t.id)),
  );
}

function selectBuildPad(cellId: number): void {
  if (selectedBuildCell === cellId) {
    selectedBuildCell = null;
    showBuildPopup = false;
    buildOverlay.hide();
  } else {
    selectedBuildCell = cellId;
    showBuildPopup = false;
    lastError = "";
    planet.focusCell(cellId);
  }
  paint();
}

function clearBuildSelection(): void {
  selectedBuildCell = null;
  showBuildPopup = false;
  buildOverlay.hide();
  paint();
}

function closeBuildPopup(): void {
  showBuildPopup = false;
  paint();
}

function openBuildPopup(): void {
  if (selectedBuildCell === null || !lastMatch) return;
  if (!anyTowerAffordable(lastMatch)) return;
  showBuildPopup = true;
  buildOverlay.hide();
  paint();
}

function confirmBuildTower(typeId: string): void {
  if (selectedBuildCell === null || !lastMatch) return;
  lastError = "";
  socket.send({
    type: "buildTower",
    cellId: selectedBuildCell,
    typeId,
  });
  showBuildPopup = false;
  selectedBuildCell = null;
  buildOverlay.hide();
  paint();
}

function patchModalTowerAffordability(
  m: MatchState,
  self: NonNullable<ReturnType<typeof me>>,
): void {
  const list = document.getElementById("build-modal-list");
  if (!list || !showBuildPopup) return;
  for (const t of myLoadout(m)) {
    const btn = list.querySelector(
      `[data-build-type="${t.id}"]`,
    ) as HTMLButtonElement | null;
    if (!btn) continue;
    const cost = towerBuildCost(m, t.id);
    const afford = canAffordCost(self.bank, cost);
    btn.disabled = !afford;
    btn.classList.toggle("cant-afford", !afford);
    const chips = btn.querySelector(".cost-row");
    if (chips) chips.innerHTML = costChipsHtml(cost, afford);
  }
}

function myLoadout(m?: MatchState | null): TowerDef[] {
  const fromMatch = (m ?? lastMatch)?.players.find((p) => p.id === playerId)
    ?.loadout;
  if (fromMatch?.length) return fromMatch;
  const fromLobby = lastLobby?.seats.find((s) => s.id === playerId)?.loadout;
  if (fromLobby?.length) return fromLobby;
  return workshop?.towers ?? [];
}

function towerDefFor(
  m: MatchState,
  typeId: string | undefined,
  ownerId?: string,
): TowerDef | undefined {
  const owner =
    m.players.find((p) => p.id === (ownerId ?? playerId)) ?? me();
  return owner?.loadout?.find((t) => t.id === typeId) ?? owner?.loadout?.[0];
}

function towerVisualFor(
  m: MatchState,
  typeId: string | undefined,
  ownerId?: string,
): string {
  return towerDefFor(m, typeId, ownerId)?.visualId ?? DEFAULT_TOWER_VISUAL;
}

function matchCosts(m: MatchState) {
  return {
    baseUpgradeBase: m.costs?.baseUpgradeBase ?? { stone: 40, power: 30 },
    baseUpgradeLevelIncrease: m.costs?.baseUpgradeLevelIncrease ?? 1.4,
    bods: m.costs?.bods ?? {
      grunt: { stone: 4, water: 2 },
      bruiser: { stone: 12, power: 6 },
    },
    bodUpgrades: m.costs?.bodUpgrades ?? {},
  };
}

function towerBuildCost(
  m: MatchState,
  typeId: string,
): Record<string, number> {
  const def = towerDefFor(m, typeId);
  return def?.buildCost ?? FALLBACK_TOWER;
}

/** Mirror server scaleCost — ceil(base * mult^level) */
function scaleCostClient(
  base: Record<string, number>,
  levelIncrease: number,
  level: number,
): Record<string, number> {
  const mult = Math.pow(levelIncrease, level);
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = Math.ceil(v * mult);
  }
  return out;
}

function towerUpgradeCost(
  m: MatchState,
  tower: { level?: number; typeId?: string; ownerId?: string },
): Record<string, number> {
  const def = towerDefFor(m, tower.typeId, tower.ownerId);
  return scaleCostClient(
    def?.upgradeCost ?? { stone: 40, power: 30 },
    def?.upgradeLevelIncrease ?? 1.35,
    tower.level ?? 0,
  );
}

function bodUpgradeCost(
  m: MatchState,
  bodTypeId: string,
  level: number,
): Record<string, number> {
  const c = matchCosts(m);
  const up = c.bodUpgrades[bodTypeId];
  if (!up) return { stone: 8, power: 4 };
  return scaleCostClient(up.base, up.levelIncrease, level);
}

function baseUpgradeCost(
  m: MatchState,
  self: { baseLevel?: number } | null,
): Record<string, number> {
  const c = matchCosts(m);
  return scaleCostClient(
    c.baseUpgradeBase,
    c.baseUpgradeLevelIncrease,
    self?.baseLevel ?? 0,
  );
}

function schedulePushLoadout(): void {
  if (!workshop || !lastLobby) return;
  if (!isWorkshopValid(workshop)) return;
  if (pushLoadoutTimer) clearTimeout(pushLoadoutTimer);
  pushLoadoutTimer = setTimeout(() => {
    if (!workshop || !isWorkshopValid(workshop)) return;
    socket.send({ type: "setLoadout", towers: workshop.towers });
  }, 280);
}

function canAffordCost(
  bank: Record<string, number>,
  cost: Record<string, number>,
): boolean {
  return Object.entries(cost).every(([k, v]) => (bank[k] ?? 0) >= v);
}

function costChipsHtml(cost: Record<string, number>, afford: boolean): string {
  return Object.entries(cost)
    .map(
      ([k, v]) =>
        `<span class="cost-chip ${afford ? "ok" : "short"}">${resourceAmountHtml(k, v)}</span>`,
    )
    .join("");
}

function tilePreviewSvg(
  connections: boolean[],
  rotation: number,
  sides = 6,
): string {
  const r = ((rotation % sides) + sides) % sides;
  const conn = connections.slice(0, sides).map((_, i) => {
    const src = connections[(i - r + sides) % sides] ?? false;
    return src;
  });
  const cx = 50;
  const cy = 50;
  const rad = 36;
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
    pts.push(`${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`);
  }
  const edges: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a0 = (Math.PI * 2 * i) / sides - Math.PI / 2;
    const a1 = (Math.PI * 2 * (i + 1)) / sides - Math.PI / 2;
    const mx = cx + rad * 0.72 * Math.cos((a0 + a1) / 2);
    const my = cy + rad * 0.72 * Math.sin((a0 + a1) / 2);
    const open = conn[i];
    edges.push(
      `<line x1="${cx}" y1="${cy}" x2="${mx}" y2="${my}" stroke="${open ? "#ffe566" : "#334450"}" stroke-width="${open ? 5 : 2}" stroke-linecap="round"/>`,
    );
  }
  return `<svg class="tile-preview" viewBox="0 0 100 100" aria-label="Current tile">
    <polygon points="${pts.join(" ")}" fill="#0c1c28" stroke="#3dd6c6" stroke-width="2"/>
    ${edges.join("")}
    <circle cx="${cx}" cy="${cy}" r="4" fill="#3dd6c6"/>
  </svg>`;
}

function tilePlacementHint(
  tile: NonNullable<MatchState["currentTile"]>,
  rotation: number,
): string {
  const bits = [tile.routeKind ?? "route"];
  if (tile.hasTowerPoint) bits.push("tower pad");
  if (tile.hasMine) {
    bits.push(
      tile.mineResourceId
        ? `${resourceLabel(tile.mineResourceId)} mine`
        : "mine",
    );
  }
  bits.push(`rot ${rotation}`);
  return bits.join(" · ");
}

function rotatePlacement(dir: 1 | -1): void {
  if (!lastMatch || lastMatch.phase !== "placement") return;
  const tile = lastMatch.currentTile;
  if (!tile?.connections) return;
  const legal = lastMatch.legalPlacements ?? [];
  if (hoverCellId !== null) {
    const forCell = legal
      .filter((p) => p.cellId === hoverCellId)
      .map((p) => p.rotation)
      .sort((a, b) => a - b);
    if (forCell.length) {
      const idx = forCell.indexOf(placementRotation);
      const next =
        forCell[
          (((idx < 0 ? 0 : idx) + dir) % forCell.length + forCell.length) %
            forCell.length
        ]!;
      placementRotation = next;
      paint();
      return;
    }
  }
  // No hover / no legal on hover: step rotation, snap to next globally useful rot
  const sides = 6;
  placementRotation = (((placementRotation + dir) % sides) + sides) % sides;
  const any = legal.find((p) => p.rotation === placementRotation);
  if (!any && legal.length) {
    // jump to next legal rotation that appears in the list
    for (let step = 0; step < sides; step++) {
      const r = (((placementRotation + dir * step) % sides) + sides) % sides;
      if (legal.some((p) => p.rotation === r)) {
        placementRotation = r;
        break;
      }
    }
  }
  paint();
}

function renderLobby(): void {
  planet.setSpin(true);
  updateHealthBar(null);
  const s = lastLobby;
  updateLeaveBtn();

  if (s) {
    const mySeat = s.seats.find((seat) => seat.id === playerId);
    const key = `${s.room}:${playerId}:${s.settings.resourceCount}`;
    if (!workshop || workshopSyncKey !== key) {
      const keepId = workshop?.towers[workshop.selectedIndex]?.id;
      const keepIdx = workshop?.selectedIndex ?? 0;
      workshop = createWorkshopState(
        mySeat?.loadout ?? workshop?.towers,
        s.settings.resourceCount,
      );
      if (keepId) {
        const i = workshop.towers.findIndex((t) => t.id === keepId);
        workshop.selectedIndex =
          i >= 0 ? i : Math.min(keepIdx, Math.max(0, workshop.towers.length - 1));
      }
      workshopSyncKey = key;
    }
  } else {
    workshop = null;
    workshopSyncKey = "";
  }

  const workshopBlock =
    s && workshop
      ? workshopHtml(workshop)
      : "";
  const loadoutOk = workshop ? isWorkshopValid(workshop) : true;

  const prevLobby = hud.querySelector(".lobby") as HTMLElement | null;
  const lobbyScroll = prevLobby?.scrollTop ?? 0;

  hud.innerHTML = `
    <div class="panel lobby ${s ? "in-room" : "lobby-menu"}">
      <div class="lobby-head">
        <h2>COMMAND LOBBY</h2>
        <p class="error">${lastError}</p>
      </div>
      ${
        s
          ? `<div class="lobby-body">
        <div class="lobby-col lobby-setup">
          <p class="lobby-room">Room <strong>${s.room}</strong> · Host ${s.hostId === playerId ? "you" : s.hostId}</p>
          <ul class="seat-list">${s.seats
            .map(
              (seat) =>
                `<li>${seat.name}${seat.isAi ? " (AI)" : ""}${seat.ready ? " ✓" : ""}${seat.id === playerId ? " ← you" : ""}${
                  seat.loadout?.length
                    ? ` · [${seat.loadout.map((t) => t.id).join(", ")}]`
                    : ""
                }</li>`,
            )
            .join("")}</ul>
          <div class="row">
            <label>Mode
              <select id="mode">
                <option value="ffa" ${s.settings.mode === "ffa" ? "selected" : ""}>FFA</option>
                <option value="teams" ${s.settings.mode === "teams" ? "selected" : ""}>Teams</option>
              </select>
            </label>
            <label>Win
              <select id="win">
                <option value="last_base" ${s.settings.winRule === "last_base" ? "selected" : ""}>Last base</option>
                <option value="timed" ${s.settings.winRule === "timed" ? "selected" : ""}>Timed</option>
              </select>
            </label>
          </div>
          <div class="row">
            <label>World
              <select id="world">
                <option value="small" ${s.settings.worldSize === "small" ? "selected" : ""}>Small</option>
                <option value="medium" ${s.settings.worldSize === "medium" ? "selected" : ""}>Medium</option>
                <option value="large" ${s.settings.worldSize === "large" ? "selected" : ""}>Large</option>
              </select>
            </label>
            <label>Placement
              <select id="place">
                <option value="auto" ${s.settings.placementMode === "auto" ? "selected" : ""}>Auto</option>
                <option value="manual" ${s.settings.placementMode === "manual" ? "selected" : ""}>Manual</option>
              </select>
            </label>
          </div>
          <div class="row">
            <label>Seats
              <select id="seats">
                ${[2, 3, 4]
                  .map(
                    (n) =>
                      `<option value="${n}" ${s.settings.seatCount === n ? "selected" : ""}>${n}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label>Resources
              <select id="res">
                ${[2, 3]
                  .map(
                    (n) =>
                      `<option value="${n}" ${s.settings.resourceCount === n ? "selected" : ""}>${n}</option>`,
                  )
                  .join("")}
              </select>
            </label>
          </div>
          <div class="row lobby-actions">
            <button id="btn-ai" class="secondary">Fill AI</button>
            <button id="btn-ready" ${loadoutOk ? "" : "disabled"} title="${loadoutOk ? "" : "Fix loadout first"}">Ready</button>
            <button id="btn-start">Start</button>
          </div>
          <p class="lobby-share">Share: ${location.origin}?room=${s.room}</p>
        </div>
        <div class="lobby-col lobby-workshop-wrap">
          ${workshopBlock}
        </div>
      </div>`
          : `<div class="lobby-body lobby-body-menu">
        <div class="row">
          <label>Name <input id="name" value="Commander" /></label>
        </div>
        <div class="row">
          <button id="btn-create">Create match</button>
          <label>Room <input id="join-code" placeholder="CODE" value="${joinRoom ?? ""}" /></label>
          <button id="btn-join" class="secondary">Join</button>
        </div>
      </div>`
      }
    </div>
  `;

  const nextLobby = hud.querySelector(".lobby") as HTMLElement | null;
  if (nextLobby && lobbyScroll > 0) {
    nextLobby.scrollTop = lobbyScroll;
  }

  if (!s) {
    document.getElementById("btn-create")?.addEventListener("click", () => {
      const name = (document.getElementById("name") as HTMLInputElement).value;
      socket.send({ type: "create", name, settings: { seatCount: 2 } });
    });
    document.getElementById("btn-join")?.addEventListener("click", () => {
      const name = (document.getElementById("name") as HTMLInputElement).value;
      const room = (
        document.getElementById("join-code") as HTMLInputElement
      ).value.trim();
      socket.send({ type: "join", room, name, token: token ?? undefined });
    });
    return;
  }

  const wsRoot = document.getElementById("tower-workshop");
  if (wsRoot && workshop) {
    bindWorkshop(wsRoot, workshop, (kind = "hard") => {
      // soft = local-only while dragging (never push/paint — that kills the drag)
      if (kind === "soft") return;
      schedulePushLoadout();
      if (kind === "hard") paint();
    });
  }

  const readLobbySettings = () => ({
    mode: (document.getElementById("mode") as HTMLSelectElement).value,
    winRule: (document.getElementById("win") as HTMLSelectElement).value,
    worldSize: (document.getElementById("world") as HTMLSelectElement).value,
    placementMode: (document.getElementById("place") as HTMLSelectElement).value,
    seatCount: Number(
      (document.getElementById("seats") as HTMLSelectElement).value,
    ),
    resourceCount: Number(
      (document.getElementById("res") as HTMLSelectElement).value,
    ),
  });

  // Keep server in sync when host changes dropdowns (no Apply button)
  for (const id of ["mode", "win", "world", "place", "seats", "res"]) {
    document.getElementById(id)?.addEventListener("change", () => {
      if (s.hostId !== playerId) return;
      socket.send({ type: "setLobby", settings: readLobbySettings() });
    });
  }

  document.getElementById("btn-ai")?.addEventListener("click", () => {
    if (s.hostId === playerId) {
      socket.send({ type: "setLobby", settings: readLobbySettings() });
    }
    socket.send({ type: "fillAi" });
  });
  document.getElementById("btn-ready")?.addEventListener("click", () => {
    if (workshop && !isWorkshopValid(workshop)) {
      lastError = "Fix tower loadout before Ready";
      paint();
      return;
    }
    if (workshop && isWorkshopValid(workshop)) {
      socket.send({ type: "setLoadout", towers: workshop.towers });
    }
    socket.send({ type: "ready" });
  });
  document.getElementById("btn-start")?.addEventListener("click", () => {
    if (workshop && isWorkshopValid(workshop)) {
      socket.send({ type: "setLoadout", towers: workshop.towers });
    }
    socket.send({ type: "start", settings: readLobbySettings() });
  });
}

function bindMatchHudHandlers(self: ReturnType<typeof me>): void {
  hud.querySelectorAll("[data-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.target!;
      const on = self?.targetEnabled[id];
      socket.send({ type: "toggleTarget", targetId: id, enabled: !on });
    });
  });
  hud.querySelectorAll("[data-bod]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const id = (btn as HTMLElement).dataset.bod!;
      const on = self?.bodEnabled[id];
      socket.send({ type: "toggleBod", bodTypeId: id, enabled: !on });
    });
  });
  hud.querySelectorAll("[data-bod-up]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if ((btn as HTMLButtonElement).disabled) return;
      const bodTypeId = (btn as HTMLElement).dataset.bodUp!;
      socket.send({
        type: "upgrade",
        target: { kind: "bod", bodTypeId },
      });
    });
  });
  hud.querySelectorAll("[data-build]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const cellId = Number((btn as HTMLElement).dataset.build);
      if (!Number.isFinite(cellId) || !lastMatch) return;
      selectBuildPad(cellId);
    });
  });
  hud.querySelectorAll("[data-hud-build]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openBuildPopup();
    });
  });
  document.getElementById("build-modal-backdrop")?.addEventListener("click", () => {
    closeBuildPopup();
  });
  document.getElementById("btn-build-cancel")?.addEventListener("click", () => {
    closeBuildPopup();
  });
  hud.querySelectorAll("[data-build-type]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if ((btn as HTMLButtonElement).disabled) return;
      const typeId = (btn as HTMLElement).dataset.buildType!;
      confirmBuildTower(typeId);
    });
  });
  hud.querySelectorAll("[data-up-tower]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if ((btn as HTMLButtonElement).disabled) return;
      const structureId = (btn as HTMLElement).dataset.upTower!;
      socket.send({
        type: "upgrade",
        target: { kind: "tower", structureId },
      });
    });
  });
  document.getElementById("btn-upgrade-base")?.addEventListener("click", () => {
    const el = document.getElementById(
      "btn-upgrade-base",
    ) as HTMLButtonElement | null;
    if (!playerId || el?.disabled) return;
    socket.send({
      type: "upgrade",
      target: { kind: "base", playerId },
    });
  });
  document.getElementById("btn-exit-end")?.addEventListener("click", () => {
    leaveRoom();
  });
  document.getElementById("btn-rot-cw")?.addEventListener("click", () => {
    rotatePlacement(1);
  });
  document.getElementById("btn-rot-ccw")?.addEventListener("click", () => {
    rotatePlacement(-1);
  });
}

function patchMatchLive(m: MatchState, self: ReturnType<typeof me>): void {
  const costs = matchCosts(m);
  const loadout = myLoadout(m);
  const anyAfford = loadout.some(
    (t) => self && canAffordCost(self.bank, towerBuildCost(m, t.id)),
  );
  const baseCost = baseUpgradeCost(m, self);
  const affordBase = self ? canAffordCost(self.bank, baseCost) : false;

  const bankEl = document.getElementById("bank-live");
  if (bankEl && self) {
    bankEl.innerHTML = Object.entries(self.bank)
      .map(
        ([k, v]) =>
          `<span class="chip">${resourceAmountHtml(k, v.toFixed(1))}</span>`,
      )
      .join("");
  }
  const phaseEl = document.getElementById("phase-live");
  if (phaseEl) phaseEl.textContent = `${m.phase.toUpperCase()} · T${m.tick}`;
  const hpEl = document.getElementById("hp-live");
  if (hpEl) {
    const pads = freeTowerPads(m);
    hpEl.textContent = `HP: ${self?.baseHp.toFixed(0) ?? "—"}${
      m.phase === "combat" ? ` · Free pads: ${pads.length}` : ""
    }`;
  }
  const errEl = document.getElementById("error-live");
  if (errEl) errEl.textContent = lastError;

  hud.querySelectorAll("[data-build]").forEach((btn) => {
    const el = btn as HTMLButtonElement;
    const cellId = Number(el.dataset.build);
    const selected = selectedBuildCell === cellId;
    el.classList.toggle("selected", selected);
    el.classList.toggle("cant-afford", !anyAfford);
    el.classList.toggle("has-build-bar", selected && anyAfford);
  });
  const hudBuildBars = hud.querySelectorAll("[data-hud-build]");
  hudBuildBars.forEach((btn) => {
    (btn as HTMLElement).hidden = !(
      selectedBuildCell !== null &&
      anyAfford &&
      m.phase === "combat" &&
      Number((btn as HTMLElement).dataset.hudBuild) === selectedBuildCell
    );
  });
  const modal = document.getElementById("build-modal");
  if (modal) {
    modal.hidden = !showBuildPopup;
  }
  if (showBuildPopup && self) {
    patchModalTowerAffordability(m, self);
  }
  hud.querySelectorAll("[data-up-tower]").forEach((btn) => {
    const el = btn as HTMLButtonElement;
    const structureId = el.dataset.upTower!;
    const tower = m.towers.find((t) => t.id === structureId);
    const upCost = tower
      ? towerUpgradeCost(m, tower)
      : { stone: 40, power: 30 };
    const afford = self ? canAffordCost(self.bank, upCost) : false;
    el.disabled = !afford;
    const chips = el.querySelector(".cost-row");
    if (chips) chips.innerHTML = costChipsHtml(upCost, afford);
    const label = el.querySelector(".btn-label");
    if (label && tower) {
      label.textContent = `Upgrade ${tower.typeId ?? "tower"} #${tower.cellId} (L${(tower.level ?? 0) + 1})`;
    }
  });
  const baseBtn = document.getElementById(
    "btn-upgrade-base",
  ) as HTMLButtonElement | null;
  if (baseBtn) {
    baseBtn.disabled = !affordBase;
    const chips = baseBtn.querySelector(".cost-row");
    if (chips) chips.innerHTML = costChipsHtml(baseCost, affordBase);
    const label = baseBtn.querySelector(".btn-label");
    if (label) {
      label.textContent = `Upgrade base (L${(self?.baseLevel ?? 0) + 1})`;
    }
  }

  hud.querySelectorAll("[data-bod]").forEach((btn) => {
    const el = btn as HTMLElement;
    const id = el.dataset.bod!;
    const on = self?.bodEnabled[id];
    const cost = costs.bods[id] ?? {};
    const afford = self ? canAffordCost(self.bank, cost) : false;
    const chip = el.closest(".bod-chip");
    chip?.classList.toggle("on", !!on);
    chip?.classList.toggle("off", !on);
    chip?.classList.toggle("cant-afford", !afford);
    const chips = el.querySelector(".cost-row");
    if (chips) chips.innerHTML = costChipsHtml(cost, afford);
  });
  hud.querySelectorAll("[data-bod-up]").forEach((btn) => {
    const el = btn as HTMLButtonElement;
    const id = el.dataset.bodUp!;
    const level = self?.bodLevels?.[id] ?? 0;
    const upCost = bodUpgradeCost(m, id, level);
    const afford = self ? canAffordCost(self.bank, upCost) : false;
    el.disabled = !afford;
    const chips = el.querySelector(".cost-row");
    if (chips) chips.innerHTML = costChipsHtml(upCost, afford);
    const lvl = el.querySelector(".bod-up-lvl");
    if (lvl) lvl.textContent = `L${level + 1}`;
  });

  updateHealthBar(m);
}

function renderMatch(): void {
  const m = lastMatch!;
  planet.setSpin(m.phase === "placement");
  updateLeaveBtn();
  const self = me();
  const costs = matchCosts(m);
  const loadout = myLoadout(m);
  const anyAfford = loadout.some(
    (t) => self && canAffordCost(self.bank, towerBuildCost(m, t.id)),
  );
  const baseCost = baseUpgradeCost(m, self);
  const affordBase = self ? canAffordCost(self.bank, baseCost) : false;

  const pads = freeTowerPads(m);
  if (selectedBuildCell !== null && !pads.includes(selectedBuildCell)) {
    selectedBuildCell = null;
    showBuildPopup = false;
    buildOverlay.hide();
  }
  const myTowers = m.towers.filter((t) => t.ownerId === playerId);

  const turnPlayer = m.players[m.currentSeat];
  const myTurn =
    m.phase === "placement" &&
    m.placementMode === "manual" &&
    turnPlayer?.id === playerId;
  const legal = m.legalPlacements ?? [];
  const legalCellIds = [...new Set(legal.map((p) => p.cellId))];
  const tile = m.currentTile;

  const shellKey = [
    m.phase,
    m.placementMode,
    m.currentSeat,
    m.bagIndex,
    myTurn ? "1" : "0",
    placementRotation,
    pads.join(","),
    myTowers.map((t) => `${t.id}:${t.level ?? 0}:${t.typeId ?? ""}`).join(","),
    self?.baseLevel ?? 0,
    Object.entries(self?.targetEnabled ?? {})
      .map(([k, v]) => `${k}:${v}`)
      .join(","),
    Object.entries(self?.bodEnabled ?? {})
      .map(([k, v]) => `${k}:${v}`)
      .join(","),
    Object.entries(self?.bodLevels ?? {})
      .map(([k, v]) => `${k}:${v}`)
      .join(","),
    m.winnerIds.join(","),
    selectedBuildCell ?? "",
    showBuildPopup ? "1" : "0",
    loadout.map((t) => t.id).join(","),
    anyAfford ? "1" : "0",
  ].join("|");

  if (shellKey === hudShellKey && hud.querySelector(".side-left")) {
    patchMatchLive(m, self);
  } else {
    hudShellKey = shellKey;

    const targets = self
      ? Object.entries(self.targetEnabled)
          .map(
            ([id, on]) =>
              `<button class="chip ${on ? "on" : "off"}" data-target="${id}">${m.players.find((p) => p.id === id)?.name ?? id}</button>`,
          )
          .join("")
      : "";

    const selfColor =
      PLAYER_COLORS[
        Math.max(0, m.players.findIndex((p) => p.id === self?.id)) %
          PLAYER_COLORS.length
      ]!;
    const bods = self
      ? Object.entries(self.bodEnabled)
          .map(([id, on]) => {
            const cost = costs.bods[id] ?? {};
            const afford = canAffordCost(self.bank, cost);
            const level = self.bodLevels?.[id] ?? 0;
            const upCost = bodUpgradeCost(m, id, level);
            const affordUp = canAffordCost(self.bank, upCost);
            const tint = shadeBodColor(selfColor, id);
            return `<div class="bod-chip chip ${on ? "on" : "off"} ${afford ? "" : "cant-afford"}">
              <button type="button" class="bod-toggle" data-bod="${id}">
                <span class="bod-preview" style="--bod-color:${tint}" title="${id}" aria-hidden="true"></span>
                <span class="bod-toggle-copy">
                  <span class="bod-name">${id}</span>
                  <span class="cost-row">${costChipsHtml(cost, afford)}</span>
                </span>
              </button>
              <button type="button" class="bod-up-slot" data-bod-up="${id}" title="Upgrade ${id}" aria-label="Upgrade ${id}" ${affordUp ? "" : "disabled"}>
                <span class="bod-up-lvl">L${level + 1}</span>
                <span class="cost-row">${costChipsHtml(upCost, affordUp)}</span>
              </button>
            </div>`;
          })
          .join("")
      : "";

    const buildModalHtml =
      showBuildPopup && selectedBuildCell !== null
        ? `<div class="build-modal" id="build-modal" role="dialog" aria-modal="true" aria-labelledby="build-modal-title">
            <div class="build-modal-backdrop" id="build-modal-backdrop"></div>
            <div class="build-modal-card">
              <h3 id="build-modal-title">Build on pad #${selectedBuildCell}</h3>
              <div class="type-picker" id="build-modal-list">
                ${loadout
                  .map((t) => {
                    const cost = towerBuildCost(m, t.id);
                    const afford = self
                      ? canAffordCost(self.bank, cost)
                      : false;
                    const color = TOWER_TYPE_COLORS[t.id] ?? "#9ab";
                    return `<button type="button" class="build-btn type-chip ${afford ? "" : "cant-afford"}" data-build-type="${t.id}" ${afford ? "" : "disabled"} style="--type-color:${color}">
                      <span class="btn-label">${towerVisualIconHtml(t.visualId)} ${t.id} · p${t.power} r${t.range}</span>
                      <span class="cost-row">${costChipsHtml(cost, afford)}</span>
                    </button>`;
                  })
                  .join("")}
              </div>
              <button type="button" id="btn-build-cancel" class="secondary">Cancel</button>
            </div>
          </div>`
        : `<div class="build-modal" id="build-modal" hidden></div>`;

    const buildList =
      m.phase === "combat"
        ? `<h2>BUILD TARGETS</h2>
      <div class="pad-rail" id="pad-rail">
        ${
          pads.length === 0
            ? `<p class="hint">No free pads left.</p>`
            : pads
                .map((cellId) => {
                  const selected = selectedBuildCell === cellId;
                  const showBar = selected && anyAfford;
                  return `<div class="pad-target ${selected ? "selected" : ""} ${anyAfford ? "" : "cant-afford"}">
                      <button type="button" class="pad-disc ${selected ? "selected" : ""} ${anyAfford ? "" : "cant-afford"} ${showBar ? "has-build-bar" : ""}" data-build="${cellId}" title="Pad #${cellId}" aria-label="Pad ${cellId}">
                        <span class="pad-disc-glow"></span>
                        <span class="pad-disc-id">${cellId}</span>
                      </button>
                      ${
                        showBar
                          ? `<button type="button" class="hud-build-bar" data-hud-build="${cellId}" aria-label="Build on pad ${cellId}"><span class="build-bar-label">BUILD</span></button>`
                          : ""
                      }
                    </div>`;
                })
                .join("")
        }
      </div>
      <h2>YOUR TOWERS (${myTowers.length})</h2>
      <div class="build-list">
        ${
          myTowers.length === 0
            ? `<p class="hint">None yet.</p>`
            : myTowers
                .map((t) => {
                  const upCost = towerUpgradeCost(m, t);
                  const affordUp = self
                    ? canAffordCost(self.bank, upCost)
                    : false;
                  const color = TOWER_TYPE_COLORS[t.typeId ?? ""] ?? "#9ab";
                  const vis = towerVisualFor(m, t.typeId, t.ownerId);
                  return `<button class="secondary build-btn" data-up-tower="${t.id}" ${affordUp ? "" : "disabled"} style="border-left:3px solid ${color};--type-color:${color}">
                      <span class="btn-label">${towerVisualIconHtml(vis)} Upgrade ${t.typeId ?? "tower"} #${t.cellId} (L${(t.level ?? 0) + 1})</span>
                      <span class="cost-row">${costChipsHtml(upCost, affordUp)}</span>
                    </button>`;
                })
                .join("")
        }
      </div>`
        : m.phase === "placement"
          ? `<p class="hint">Flat road ribbons = routes on the hex grid.</p>`
          : "";

    const tilePanel =
      m.phase === "placement" &&
      m.placementMode === "manual" &&
      tile?.connections
        ? `<h2>CURRENT TILE</h2>
        <div id="tile-preview-wrap" class="tile-preview-wrap">
          ${tilePreviewSvg(tile.connections, placementRotation, 6)}
          <p class="hint">${tilePlacementHint(tile, placementRotation)}</p>
          <div class="row">
            <button type="button" id="btn-rot-ccw" class="secondary">⟲ Rotate</button>
            <button type="button" id="btn-rot-cw" class="secondary">Rotate ⟳</button>
          </div>
          <p class="hint">PC: mouse wheel rotates. Mobile: two-finger twist or buttons. Click a <strong>green</strong> cell.</p>
        </div>`
        : "";

    const turnBanner =
      m.phase === "placement" && m.placementMode === "manual"
        ? myTurn
          ? `<p class="turn-banner yours">Your turn — place on a green cell (${m.bagIndex + 1}/${m.bagTotal}).</p>`
          : `<p class="turn-banner">Waiting for ${turnPlayer?.name ?? "…"} (${m.bagIndex}/${m.bagTotal})</p>`
        : m.phase === "placement"
          ? `<p class="turn-banner">Auto-placing routes…</p>`
          : "";

    hud.innerHTML = `
    <div class="panel side-left">
      <h2 id="phase-live">${m.phase.toUpperCase()} · T${m.tick}</h2>
      ${turnBanner}
      ${tilePanel}
      <div class="legend">
        <span><i class="swatch route"></i> Road</span>
        <span><i class="swatch base"></i> Base plinth</span>
        <span><i class="swatch mine"></i> Your castle</span>
        <span><i class="swatch legal"></i> Legal place</span>
        <span><i class="swatch pad"></i> Tower pad</span>
      </div>
      <div class="bank" id="bank-live">${
        self
          ? Object.entries(self.bank)
              .map(
                ([k, v]) =>
                  `<span class="chip">${resourceAmountHtml(k, v.toFixed(1))}</span>`,
              )
              .join("")
          : ""
      }</div>
      <p id="hp-live" style="font-size:0.85rem;color:var(--muted);margin-top:0.6rem">
        HP: ${self?.baseHp.toFixed(0) ?? "—"}
        ${m.phase === "combat" ? `· Free pads: ${pads.length}` : ""}
      </p>
      <p class="error" id="error-live">${lastError}</p>
      <h2>TARGETS</h2>
      <div class="row">${targets || "—"}</div>
      <h2>BODS</h2>
      <div class="bod-stack">${bods || "—"}</div>
    </div>
    <div class="panel side-right">
      ${buildList}
      ${
        m.phase === "combat"
          ? `<div class="row" style="margin-top:0.75rem">
        <button id="btn-upgrade-base" class="secondary" ${affordBase ? "" : "disabled"}>
          <span class="btn-label">Upgrade base (L${(self?.baseLevel ?? 0) + 1})</span>
          <span class="cost-row">${costChipsHtml(baseCost, affordBase)}</span>
        </button>
      </div>`
          : ""
      }
      ${
        m.phase === "ended"
          ? `<p>${m.winnerIds.length === 1 ? "Winner" : "Winners"}: ${m.winnerIds.map((id) => m.players.find((p) => p.id === id)?.name ?? id).join(", ")}</p>
             <button id="btn-exit-end">Back to menu</button>`
          : ""
      }
    </div>
    ${buildModalHtml}
  `;

    bindMatchHudHandlers(self);
  }

  updateHealthBar(m);

  const viewData: PlanetViewData = {
    cells: m.planet.cells,
    baseCellIds: m.planet.baseCellIds,
    placed: m.placed,
    towers: m.towers.map((t) => ({
      cellId: t.cellId,
      ownerId: t.ownerId,
      typeId: t.typeId,
      visualId: towerVisualFor(m, t.typeId, t.ownerId),
    })),
    mines: m.mines,
    bods: m.bods,
    bodMoveEveryTicks: m.bodMoveEveryTicks ?? 10,
    players: m.players,
    legalCellIds: myTurn ? legalCellIds : [],
    corridorCellIds: m.corridorCellIds ?? [],
    myBaseCellId: self?.baseCellId ?? null,
    interactionMode:
      m.phase === "placement"
        ? "placement"
        : m.phase === "combat"
          ? "combat"
          : "other",
    phase: m.phase,
    winnerIds: m.winnerIds ?? [],
    padsAffordable: anyAfford,
  };
  const planetKey = `${m.planet.cells.length}:${m.phase}:${myTurn ? legalCellIds.join(",") : ""}:${self?.baseCellId ?? ""}`;
  if (planetBuiltFor !== planetKey) {
    planet.setPlanet(viewData);
    planetBuiltFor = planetKey;
  } else {
    planet.refreshMarkers(viewData);
  }
}

planet.onCellClick = (cellId) => {
  if (!lastMatch) return;
  if (lastMatch.phase === "placement") {
    const legal = (lastMatch.legalPlacements ?? []).filter(
      (p) => p.cellId === cellId,
    );
    const rotation =
      legal.find((p) => p.rotation === placementRotation)?.rotation ??
      legal[0]?.rotation ??
      placementRotation;
    socket.send({ type: "placeTile", cellId, rotation });
    return;
  }
  if (lastMatch.phase === "combat") {
    const placed = lastMatch.placed.find((p) => p.cellId === cellId);
    const hasTower = lastMatch.towers.some((t) => t.cellId === cellId);
    if (placed?.tile.hasTowerPoint && !hasTower) {
      selectBuildPad(cellId);
      return;
    }
    // Empty / non-pad ground clears build selection
    if (selectedBuildCell !== null) {
      clearBuildSelection();
    }
  }
};

planet.onTileRotate = (dir) => rotatePlacement(dir);

planet.onHoverCell = (cellId) => {
  hoverCellId = cellId;
  if (!lastMatch || lastMatch.phase !== "placement") return;
  if (cellId === null) return;
  const legal = (lastMatch.legalPlacements ?? []).filter(
    (p) => p.cellId === cellId,
  );
  if (
    legal.length &&
    !legal.some((p) => p.rotation === placementRotation)
  ) {
    placementRotation = legal[0]!.rotation;
    const wrap = document.getElementById("tile-preview-wrap");
    const tile = lastMatch.currentTile;
    if (wrap && tile?.connections) {
      const svg = wrap.querySelector(".tile-preview");
      if (svg) {
        wrap.innerHTML = `
          ${tilePreviewSvg(tile.connections, placementRotation, 6)}
          <p class="hint">${tilePlacementHint(tile, placementRotation)}</p>
          <div class="row">
            <button type="button" id="btn-rot-ccw" class="secondary">⟲ Rotate</button>
            <button type="button" id="btn-rot-cw" class="secondary">Rotate ⟳</button>
          </div>
          <p class="hint">PC: mouse wheel rotates (snaps to next valid on hovered green cell). Mobile: twist with two fingers or use buttons. Click a <strong>green</strong> cell to place.</p>`;
        document.getElementById("btn-rot-cw")?.addEventListener("click", () => {
          rotatePlacement(1);
        });
        document
          .getElementById("btn-rot-ccw")
          ?.addEventListener("click", () => {
            rotatePlacement(-1);
          });
      }
    }
  }
};

function paint(): void {
  if (lastMatch && lastMatch.phase !== "lobby") renderMatch();
  else renderLobby();
}

socket.onOpen = () => {
  statusEl.textContent = "Link online";
  if (joinRoom) {
    socket.send({
      type: "join",
      room: joinRoom,
      name: "Commander",
      token: token ?? undefined,
    });
  } else if (roomCode && token) {
    socket.send({
      type: "join",
      room: roomCode,
      name: "Commander",
      token,
    });
  }
  paint();
};

socket.onClose = () => {
  statusEl.textContent = "Disconnected";
};

socket.onMessage = (msg: ServerMessage) => {
  if (msg.type === "room") {
    roomCode = msg.room;
    token = msg.token;
    playerId = msg.playerId;
    localStorage.setItem("tdw_room", msg.room);
    localStorage.setItem("tdw_token", msg.token);
    localStorage.setItem("tdw_player", msg.playerId);
    statusEl.textContent = `Room ${msg.room}`;
    history.replaceState({}, "", `?room=${msg.room}`);
    updateLeaveBtn();
  } else if (msg.type === "state") {
    lastError = "";
    const state = msg.state as { phase: string };
    if (state.phase === "lobby") {
      lastLobby = state as LobbyState;
      lastMatch = null;
    } else {
      lastMatch = state as MatchState;
      lastLobby = null;
    }
    paint();
  } else if (msg.type === "error") {
    lastError = msg.message;
    paint();
  } else if (msg.type === "ended") {
    statusEl.textContent = `Ended · ${msg.winnerIds.join(", ")}`;
  } else if (msg.type === "left") {
    resetToMenu();
  }
};

socket.connect();
paint();

function loop(): void {
  planet.render();
  syncWorldBuildOverlay();
  requestAnimationFrame(loop);
}

function syncWorldBuildOverlay(): void {
  const m = lastMatch;
  const cellId = selectedBuildCell;
  if (
    !m ||
    m.phase !== "combat" ||
    cellId === null ||
    showBuildPopup ||
    !anyTowerAffordable(m) ||
    m.towers.some((t) => t.cellId === cellId) ||
    !freeTowerPads(m).includes(cellId)
  ) {
    buildOverlay.hide();
    return;
  }
  const proj = planet.projectCellToViewport(cellId, 0.055);
  if (!proj || !proj.visible) {
    buildOverlay.hide();
    return;
  }
  buildOverlay.update({ visible: true, x: proj.x, y: proj.y });
}

loop();
