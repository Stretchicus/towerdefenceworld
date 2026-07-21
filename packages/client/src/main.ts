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
  currentTile: unknown;
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
  bods: { cellId: number; ownerId: string }[];
}

const TOWER_COST = { stone: 25, power: 10 };

const app = document.getElementById("app")!;
app.innerHTML = `
  <header class="top">
    <h1>TOWER DEFENCE WORLD</h1>
    <div class="header-actions">
      <div class="meta" id="status">Connecting…</div>
      <button id="btn-leave" class="secondary leave-btn" hidden>Leave</button>
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
          <button id="btn-apply" class="secondary">Apply settings</button>
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

  document.getElementById("btn-apply")?.addEventListener("click", () => {
    socket.send({
      type: "setLobby",
      settings: {
        mode: (document.getElementById("mode") as HTMLSelectElement).value,
        winRule: (document.getElementById("win") as HTMLSelectElement).value,
        worldSize: (document.getElementById("world") as HTMLSelectElement).value,
        placementMode: (document.getElementById("place") as HTMLSelectElement)
          .value,
        seatCount: Number(
          (document.getElementById("seats") as HTMLSelectElement).value,
        ),
        resourceCount: Number(
          (document.getElementById("res") as HTMLSelectElement).value,
        ),
      },
    });
  });
  document.getElementById("btn-ai")?.addEventListener("click", () => {
    socket.send({ type: "fillAi" });
  });
  document.getElementById("btn-ready")?.addEventListener("click", () => {
    socket.send({ type: "ready" });
  });
  document.getElementById("btn-start")?.addEventListener("click", () => {
    socket.send({ type: "start" });
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

  hud.innerHTML = `
    <div class="panel side-left">
      <h2>${m.phase.toUpperCase()} · T${m.tick}</h2>
      <div class="legend">
        <span><i class="swatch route"></i> Route</span>
        <span><i class="swatch base"></i> Base</span>
        <span><i class="swatch pad"></i> Tower pad</span>
      </div>
      <div class="bank">${bank}</div>
      <p style="font-size:0.85rem;color:var(--muted);margin-top:0.6rem">
        HP: ${self?.baseHp.toFixed(0) ?? "—"}
        ${m.phase === "placement" ? `· Tile ${m.bagIndex}/${m.bagTotal}` : ""}
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

  const viewData: PlanetViewData = {
    cells: m.planet.cells,
    baseCellIds: m.planet.baseCellIds,
    placed: m.placed,
    towers: m.towers,
    mines: m.mines,
    bods: m.bods,
    players: m.players,
  };
  const structKey = `${m.planet.cells.length}:${m.placed.length}:${m.towers.length}:${m.mines.length}`;
  if (planetBuiltFor !== `${m.planet.cells.length}:${m.phase}`) {
    planet.setPlanet(viewData);
    planetBuiltFor = `${m.planet.cells.length}:${m.phase}`;
  } else {
    planet.refreshMarkers(viewData);
  }
  void structKey;
}

planet.onCellClick = (cellId) => {
  if (!lastMatch) return;
  if (lastMatch.phase === "placement") {
    socket.send({ type: "placeTile", cellId, rotation: 0 });
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
    if (placed?.tile.hasMine && !lastMatch.mines.some((x) => x.cellId === cellId)) {
      socket.send({ type: "claimMine", cellId });
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
