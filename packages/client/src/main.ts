import "./styles.css";
import { GameSocket, type ServerMessage } from "./net.js";
import { PlanetView, type PlanetViewData } from "./planetView.js";

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
  seats: { id: string; name: string; isAi: boolean; ready: boolean }[];
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
    targetEnabled: Record<string, boolean>;
    bodEnabled: Record<string, boolean>;
    alive: boolean;
    baseCellId: number;
  }[];
  towers: { id: string; cellId: number; ownerId: string; friendlyFire: boolean }[];
  mines: { cellId: number; id?: string; ownerId?: string }[];
  bods: {
    id: string;
    cellId: number;
    ownerId: string;
    path?: number[];
    pathIndex?: number;
    moveCooldown?: number;
  }[];
  bodMoveEveryTicks?: number;
}

const CLIENT_BUILD = "v0.1.7";
const TOWER_COST = { stone: 25, power: 10 };

const app = document.getElementById("app")!;
app.innerHTML = `
  <header class="top">
    <h1>TOWER DEFENCE WORLD <span class="build-tag">${CLIENT_BUILD}</span></h1>
    <div class="header-actions">
      <div class="meta" id="status">Connecting…</div>
      <button type="button" id="btn-leave" class="secondary leave-btn" hidden>Leave room</button>
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

const socket = new GameSocket();
const planet = new PlanetView(viewport);

let roomCode: string | null = localStorage.getItem("tdw_room");
let token: string | null = localStorage.getItem("tdw_token");
let playerId: string | null = localStorage.getItem("tdw_player");
let lastLobby: LobbyState | null = null;
let lastMatch: MatchState | null = null;
let lastError = "";
let planetBuiltFor = "";
let selectedBuildCell: number | null = null;
let placementRotation = 0;
let hoverCellId: number | null = null;

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
  selectedBuildCell = null;
  localStorage.removeItem("tdw_room");
  localStorage.removeItem("tdw_token");
  localStorage.removeItem("tdw_player");
  history.replaceState({}, "", location.pathname);
  statusEl.textContent = "Link online";
  updateLeaveBtn();
  paint();
}

leaveBtn.addEventListener("click", () => leaveRoom());

function freeTowerPads(m: MatchState): number[] {
  const occupied = new Set(m.towers.map((t) => t.cellId));
  return m.placed
    .filter((p) => p.tile.hasTowerPoint && !occupied.has(p.cellId))
    .map((p) => p.cellId);
}

function canAffordTower(self: NonNullable<ReturnType<typeof me>>): boolean {
  return (
    (self.bank.stone ?? 0) >= TOWER_COST.stone &&
    (self.bank.power ?? 0) >= TOWER_COST.power
  );
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
  const s = lastLobby;
  updateLeaveBtn();
  hud.innerHTML = `
    <div class="panel lobby">
      <h2>COMMAND LOBBY</h2>
      <p class="error">${lastError}</p>
      ${
        s
          ? `<p>Room <strong>${s.room}</strong> · Host ${s.hostId === playerId ? "you" : s.hostId}</p>
        <ul class="seat-list">${s.seats
          .map(
            (seat) =>
              `<li>${seat.name}${seat.isAi ? " (AI)" : ""}${seat.ready ? " ✓" : ""}${seat.id === playerId ? " ← you" : ""}</li>`,
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
              ${[2, 3, 4, 5]
                .map(
                  (n) =>
                    `<option value="${n}" ${s.settings.resourceCount === n ? "selected" : ""}>${n}</option>`,
                )
                .join("")}
            </select>
          </label>
        </div>
        <div class="row">
          <button id="btn-ai" class="secondary">Fill AI</button>
          <button id="btn-ready">Ready</button>
          <button id="btn-start">Start</button>
        </div>
        <p style="font-size:0.8rem;color:var(--muted)">Share: ${location.origin}?room=${s.room}</p>`
          : `<div class="row">
          <label>Name <input id="name" value="Commander" /></label>
        </div>
        <div class="row">
          <button id="btn-create">Create match</button>
          <label>Room <input id="join-code" placeholder="CODE" value="${joinRoom ?? ""}" /></label>
          <button id="btn-join" class="secondary">Join</button>
        </div>`
      }
    </div>
  `;

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
    socket.send({ type: "ready" });
  });
  document.getElementById("btn-start")?.addEventListener("click", () => {
    socket.send({ type: "start", settings: readLobbySettings() });
  });
}

function renderMatch(): void {
  const m = lastMatch!;
  planet.setSpin(m.phase === "placement");
  updateLeaveBtn();
  const self = me();
  const bank = self
    ? Object.entries(self.bank)
        .map(([k, v]) => `<span class="chip">${k}: ${v.toFixed(1)}</span>`)
        .join("")
    : "";

  const targets = self
    ? Object.entries(self.targetEnabled)
        .map(
          ([id, on]) =>
            `<button class="chip ${on ? "on" : "off"}" data-target="${id}">${m.players.find((p) => p.id === id)?.name ?? id}</button>`,
        )
        .join("")
    : "";

  const bods = self
    ? Object.entries(self.bodEnabled)
        .map(
          ([id, on]) =>
            `<button class="chip ${on ? "on" : "off"}" data-bod="${id}">${id}</button>`,
        )
        .join("")
    : "";

  const pads = freeTowerPads(m);
  const afford = self ? canAffordTower(self) : false;
  const myTowers = m.towers.filter((t) => t.ownerId === playerId);

  const buildList =
    m.phase === "combat"
      ? `<h2>BUILD TOWER</h2>
      <p class="hint">Cost: ${TOWER_COST.stone} stone + ${TOWER_COST.power} power</p>
      <p class="hint">Cyan rings on the planet = empty tower pads. Click a ring or a button below.</p>
      <div class="build-list">
        ${
          pads.length === 0
            ? `<p class="hint">No free pads left.</p>`
            : pads
                .slice(0, 12)
                .map(
                  (cellId) =>
                    `<button class="build-btn ${selectedBuildCell === cellId ? "selected" : ""}" data-build="${cellId}" ${afford ? "" : "disabled"}>
                      Pad #${cellId}${afford ? "" : " (need resources)"}
                    </button>`,
                )
                .join("") +
              (pads.length > 12
                ? `<p class="hint">+${pads.length - 12} more on map</p>`
                : "")
        }
      </div>
      <h2>YOUR TOWERS (${myTowers.length})</h2>
      <div class="build-list">
        ${
          myTowers.length === 0
            ? `<p class="hint">None yet.</p>`
            : myTowers
                .map(
                  (t) =>
                    `<button class="secondary build-btn" data-up-tower="${t.id}">Upgrade #${t.cellId}</button>`,
                )
                .join("")
        }
      </div>`
      : `<p class="hint">Gold tubes = routes. Orange cells = bases.</p>`;

  const turnPlayer = m.players[m.currentSeat];
  const myTurn =
    m.phase === "placement" &&
    m.placementMode === "manual" &&
    turnPlayer?.id === playerId;
  const legal = m.legalPlacements ?? [];
  const legalCellIds = [...new Set(legal.map((p) => p.cellId))];
  const tile = m.currentTile;
  const tilePanel =
    m.phase === "placement" && m.placementMode === "manual" && tile?.connections
      ? `<h2>CURRENT TILE</h2>
        <div id="tile-preview-wrap" class="tile-preview-wrap">
          ${tilePreviewSvg(tile.connections, placementRotation, 6)}
          <p class="hint">${tile.routeKind ?? "route"}${tile.hasTowerPoint ? " · tower pad" : ""}${tile.hasMine ? " · mine" : ""} · rot ${placementRotation}</p>
          <div class="row">
            <button type="button" id="btn-rot-ccw" class="secondary">⟲ Rotate</button>
            <button type="button" id="btn-rot-cw" class="secondary">Rotate ⟳</button>
          </div>
          <p class="hint">PC: mouse wheel rotates (snaps to next valid on hovered green cell). Mobile: twist with two fingers or use buttons. Click a <strong>green</strong> cell to place.</p>
        </div>`
      : "";

  const turnBanner =
    m.phase === "placement" && m.placementMode === "manual"
      ? myTurn
        ? `<p class="turn-banner yours">Your turn — place on a green cell (${m.bagIndex + 1}/${m.bagTotal}). Your base = bright green ring.</p>`
        : `<p class="turn-banner">Waiting for ${turnPlayer?.name ?? "…"} (${m.bagIndex}/${m.bagTotal})</p>`
      : m.phase === "placement"
        ? `<p class="turn-banner">Auto-placing routes…</p>`
        : "";

  hud.innerHTML = `
    <div class="panel side-left">
      <h2>${m.phase.toUpperCase()} · T${m.tick}</h2>
      ${turnBanner}
      ${tilePanel}
      <div class="legend">
        <span><i class="swatch route"></i> Route</span>
        <span><i class="swatch base"></i> Enemy base</span>
        <span><i class="swatch mine"></i> Your base</span>
        <span><i class="swatch legal"></i> Legal place</span>
        <span><i class="swatch pad"></i> Tower pad</span>
      </div>
      <div class="bank">${bank}</div>
      <p style="font-size:0.85rem;color:var(--muted);margin-top:0.6rem">
        HP: ${self?.baseHp.toFixed(0) ?? "—"}
        ${m.phase === "combat" ? `· Free pads: ${pads.length}` : ""}
      </p>
      <p class="error">${lastError}</p>
      <h2>TARGETS</h2>
      <div class="row">${targets || "—"}</div>
      <h2>BODS</h2>
      <div class="row">${bods || "—"}</div>
    </div>
    <div class="panel side-right">
      <h2>PLAYERS</h2>
      <ul class="seat-list">
        ${m.players
          .map(
            (p) =>
              `<li style="${p.alive ? "" : "opacity:0.45"}">${p.name} · HP ${p.baseHp.toFixed(0)}${p.id === playerId ? " ←" : ""}</li>`,
          )
          .join("")}
      </ul>
      ${buildList}
      <div class="row" style="margin-top:0.75rem">
        <button id="btn-upgrade-base" class="secondary">Upgrade base</button>
      </div>
      ${
        m.phase === "ended"
          ? `<p>Winners: ${m.winnerIds.map((id) => m.players.find((p) => p.id === id)?.name ?? id).join(", ")}</p>
             <button id="btn-exit-end">Back to menu</button>`
          : ""
      }
    </div>
  `;

  hud.querySelectorAll("[data-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.target!;
      const on = self?.targetEnabled[id];
      socket.send({ type: "toggleTarget", targetId: id, enabled: !on });
    });
  });
  hud.querySelectorAll("[data-bod]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = (btn as HTMLElement).dataset.bod!;
      const on = self?.bodEnabled[id];
      socket.send({ type: "toggleBod", bodTypeId: id, enabled: !on });
    });
  });
  hud.querySelectorAll("[data-build]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cellId = Number((btn as HTMLElement).dataset.build);
      selectedBuildCell = cellId;
      socket.send({ type: "buildTower", cellId });
    });
  });
  hud.querySelectorAll("[data-up-tower]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const structureId = (btn as HTMLElement).dataset.upTower!;
      socket.send({
        type: "upgrade",
        target: { kind: "tower", structureId },
      });
    });
  });
  document.getElementById("btn-upgrade-base")?.addEventListener("click", () => {
    if (!playerId) return;
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

  const viewData: PlanetViewData = {
    cells: m.planet.cells,
    baseCellIds: m.planet.baseCellIds,
    placed: m.placed,
    towers: m.towers,
    mines: m.mines,
    bods: m.bods,
    bodMoveEveryTicks: m.bodMoveEveryTicks ?? 10,
    players: m.players,
    legalCellIds: myTurn ? legalCellIds : [],
    myBaseCellId: self?.baseCellId ?? null,
    interactionMode:
      m.phase === "placement"
        ? "placement"
        : m.phase === "combat"
          ? "combat"
          : "other",
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
      selectedBuildCell = cellId;
      socket.send({ type: "buildTower", cellId });
      return;
    }
    if (
      placed?.tile.hasMine &&
      !lastMatch.mines.some((x) => x.cellId === cellId)
    ) {
      socket.send({ type: "claimMine", cellId });
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
          <p class="hint">${tile.routeKind ?? "route"}${tile.hasTowerPoint ? " · tower pad" : ""}${tile.hasMine ? " · mine" : ""} · rot ${placementRotation}</p>
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
  requestAnimationFrame(loop);
}
loop();
