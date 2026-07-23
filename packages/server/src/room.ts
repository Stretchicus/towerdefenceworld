import { randomBytes } from "node:crypto";
import {
  createMatch,
  defaultTowerLoadout,
  intentBuildTower,
  intentClaimMine,
  intentPlaceTile,
  intentToggleBod,
  intentToggleFriendlyFire,
  intentToggleNoEntry,
  intentUpgrade,
  runAiCombat,
  runAiPlacement,
  serializeMatch,
  tickMatch,
  normalizeTowerForResources,
  validateLoadout,
  type LobbySettings,
  type MatchState,
  type MatchSnapshot,
  type TowerDef,
  type UpgradeTarget,
} from "@tdw/game-core";

export type ClientMessage =
  | { type: "create"; name?: string; settings?: Partial<LobbySettings> }
  | { type: "join"; room: string; name?: string; token?: string }
  | { type: "ready" }
  | { type: "start"; settings?: Partial<LobbySettings> }
  | { type: "setLobby"; settings: Partial<LobbySettings> }
  | { type: "setLoadout"; towers: TowerDef[] }
  | { type: "fillAi" }
  | {
      type: "placeTile";
      cellId: number;
      rotation: number;
    }
  | { type: "buildTower"; cellId: number; typeId?: string }
  | { type: "claimMine"; cellId: number }
  | { type: "upgrade"; target: UpgradeTarget }
  | { type: "toggleBod"; bodTypeId: string; enabled: boolean }
  | { type: "toggleNoEntry"; cellA: number; cellB: number }
  | { type: "toggleTarget"; targetId: string; enabled: boolean }
  | { type: "toggleFriendlyFire"; towerId: string; enabled: boolean }
  | { type: "leave" };

export type ServerMessage =
  | { type: "room"; room: string; token: string; playerId: string }
  | { type: "state"; state: MatchSnapshot | LobbySnapshot }
  | { type: "error"; message: string }
  | { type: "ended"; winnerIds: string[] }
  | { type: "left" };

export interface LobbySnapshot {
  phase: "lobby";
  room: string;
  settings: LobbySettings;
  seats: {
    id: string;
    name: string;
    isAi: boolean;
    ready: boolean;
    token: string;
    loadout: TowerDef[];
  }[];
  hostId: string;
}

interface Seat {
  id: string;
  name: string;
  isAi: boolean;
  ready: boolean;
  token: string;
  loadout: TowerDef[];
  send?: (msg: ServerMessage) => void;
}

interface Room {
  code: string;
  hostId: string;
  settings: LobbySettings;
  seats: Seat[];
  match: MatchState | null;
  tickTimer: ReturnType<typeof setInterval> | null;
}

const rooms = new Map<string, Room>();

function code(): string {
  return randomBytes(3).toString("hex").toUpperCase();
}

function token(): string {
  return randomBytes(16).toString("hex");
}

function defaultSettings(): LobbySettings {
  return {
    mode: "ffa",
    winRule: "last_base",
    worldSize: "small",
    placementMode: "auto",
    resourceCount: 3,
    seatCount: 2,
  };
}

function lobbySnapshot(room: Room): LobbySnapshot {
  return {
    phase: "lobby",
    room: room.code,
    settings: room.settings,
    seats: room.seats.map((s) => ({
      id: s.id,
      name: s.name,
      isAi: s.isAi,
      ready: s.ready,
      token: s.token,
      loadout: s.loadout,
    })),
    hostId: room.hostId,
  };
}

function broadcast(room: Room, msg: ServerMessage): void {
  for (const s of room.seats) {
    s.send?.(msg);
  }
}

function broadcastState(room: Room): void {
  if (room.match) {
    for (const seat of room.seats) {
      seat.send?.({
        type: "state",
        state: serializeMatch(room.match, seat.id),
      });
    }
    if (room.match.phase === "ended") {
      broadcast(room, { type: "ended", winnerIds: room.match.winnerIds });
      stopTicks(room);
    }
  } else {
    broadcast(room, { type: "state", state: lobbySnapshot(room) });
  }
}

function stopTicks(room: Room): void {
  if (room.tickTimer) {
    clearInterval(room.tickTimer);
    room.tickTimer = null;
  }
}

function startTicks(room: Room): void {
  stopTicks(room);
  const hz = room.match?.config.tickRateHz ?? 10;
  room.tickTimer = setInterval(() => {
    if (!room.match) return;
    if (room.match.phase === "placement") {
      runAiPlacement(room.match);
    } else if (room.match.phase === "combat") {
      runAiCombat(room.match);
      tickMatch(room.match);
    }
    broadcastState(room);
  }, 1000 / hz);
}

function findRoom(codeStr: string): Room | undefined {
  return rooms.get(codeStr.toUpperCase());
}

export function handleMessage(
  raw: ClientMessage,
  send: (msg: ServerMessage) => void,
  ctx: { roomCode?: string; playerId?: string },
): { roomCode?: string; playerId?: string } {
  try {
    if (raw.type === "create") {
      const roomCode = code();
      const playerId = `p-${token().slice(0, 8)}`;
      const settings = { ...defaultSettings(), ...raw.settings };
      settings.seatCount = Math.max(2, Math.min(4, settings.seatCount ?? 2));
      const seat: Seat = {
        id: playerId,
        name: raw.name ?? "Commander",
        isAi: false,
        ready: false,
        token: token(),
        loadout: defaultTowerLoadout(settings.resourceCount),
        send,
      };
      const room: Room = {
        code: roomCode,
        hostId: playerId,
        settings,
        seats: [seat],
        match: null,
        tickTimer: null,
      };
      rooms.set(roomCode, room);
      send({
        type: "room",
        room: roomCode,
        token: seat.token,
        playerId,
      });
      broadcastState(room);
      return { roomCode, playerId };
    }

    if (raw.type === "join") {
      const room = findRoom(raw.room);
      if (!room) {
        send({ type: "error", message: "Room not found" });
        return ctx;
      }
      if (room.match) {
        // reconnect by token
        if (raw.token) {
          const seat = room.seats.find((s) => s.token === raw.token);
          if (seat) {
            seat.send = send;
            seat.isAi = false;
            send({
              type: "room",
              room: room.code,
              token: seat.token,
              playerId: seat.id,
            });
            send({
              type: "state",
              state: serializeMatch(room.match, seat.id),
            });
            return { roomCode: room.code, playerId: seat.id };
          }
        }
        send({ type: "error", message: "Match already started" });
        return ctx;
      }
      if (room.seats.filter((s) => !s.isAi).length >= room.settings.seatCount) {
        send({ type: "error", message: "Room full" });
        return ctx;
      }
      // Replace AI seat if present, else add
      let seat = room.seats.find((s) => s.isAi);
      if (seat) {
        seat.name = raw.name ?? "Commander";
        seat.isAi = false;
        seat.ready = false;
        seat.token = token();
        seat.loadout = defaultTowerLoadout(room.settings.resourceCount);
        seat.send = send;
      } else {
        if (room.seats.length >= room.settings.seatCount) {
          send({ type: "error", message: "Room full" });
          return ctx;
        }
        const playerId = `p-${token().slice(0, 8)}`;
        seat = {
          id: playerId,
          name: raw.name ?? "Commander",
          isAi: false,
          ready: false,
          token: token(),
          loadout: defaultTowerLoadout(room.settings.resourceCount),
          send,
        };
        room.seats.push(seat);
      }
      send({
        type: "room",
        room: room.code,
        token: seat.token,
        playerId: seat.id,
      });
      broadcastState(room);
      return { roomCode: room.code, playerId: seat.id };
    }

    const room = ctx.roomCode ? findRoom(ctx.roomCode) : undefined;
    const playerId = ctx.playerId;
    if (!room || !playerId) {
      send({ type: "error", message: "Join a room first" });
      return ctx;
    }
    const seat = room.seats.find((s) => s.id === playerId);
    if (!seat) {
      send({ type: "error", message: "Not seated" });
      return ctx;
    }
    seat.send = send;

    switch (raw.type) {
      case "setLobby": {
        if (playerId !== room.hostId) {
          send({ type: "error", message: "Host only" });
          break;
        }
        const prevResourceCount = room.settings.resourceCount;
        room.settings = { ...room.settings, ...raw.settings };
        room.settings.seatCount = Math.max(
          2,
          Math.min(4, room.settings.seatCount),
        );
        room.settings.resourceCount = Math.max(
          2,
          Math.min(3, room.settings.resourceCount),
        );
        if (room.settings.mode === "teams" && room.settings.seatCount === 3) {
          room.settings.mode = "ffa";
        }
        while (room.seats.length > room.settings.seatCount) {
          const removed = room.seats.pop();
          removed?.send?.({ type: "error", message: "Seat removed" });
        }
        const rc = room.settings.resourceCount;
        if (rc !== prevResourceCount) {
          for (const s of room.seats) {
            if (s.isAi) continue;
            const normalized = s.loadout.map((t) =>
              normalizeTowerForResources(t, rc),
            );
            const checked = validateLoadout(normalized, rc);
            s.loadout = checked.ok ? checked.towers : normalized;
            if (!checked.ok) s.ready = false;
          }
        }
        broadcastState(room);
        break;
      }
      case "fillAi": {
        if (playerId !== room.hostId) {
          send({ type: "error", message: "Host only" });
          break;
        }
        while (room.seats.length < room.settings.seatCount) {
          room.seats.push({
            id: `ai-${token().slice(0, 6)}`,
            name: `AI ${room.seats.length + 1}`,
            isAi: true,
            ready: true,
            token: token(),
            loadout: defaultTowerLoadout(room.settings.resourceCount),
          });
        }
        broadcastState(room);
        break;
      }
      case "setLoadout": {
        if (room.match) {
          send({ type: "error", message: "Loadout locked after start" });
          break;
        }
        if (seat.isAi) {
          send({ type: "error", message: "AI loadout is fixed" });
          break;
        }
        const rc = room.settings.resourceCount;
        const normalized = raw.towers.map((t) =>
          normalizeTowerForResources(t, rc),
        );
        const checked = validateLoadout(normalized, rc);
        if (!checked.ok) {
          send({
            type: "error",
            message: checked.errors.join("; "),
          });
          break;
        }
        seat.loadout = structuredClone(checked.towers);
        seat.ready = false;
        broadcastState(room);
        break;
      }
      case "ready": {
        const rc = room.settings.resourceCount;
        const checked = validateLoadout(seat.loadout, rc);
        if (!checked.ok) {
          send({
            type: "error",
            message: `Invalid loadout: ${checked.errors.join("; ")}`,
          });
          break;
        }
        seat.loadout = checked.towers;
        seat.ready = true;
        broadcastState(room);
        break;
      }
      case "start": {
        if (playerId !== room.hostId) {
          send({ type: "error", message: "Host only" });
          break;
        }
        if (raw.settings) {
          room.settings = { ...room.settings, ...raw.settings };
          room.settings.seatCount = Math.max(
            2,
            Math.min(4, room.settings.seatCount),
          );
          if (room.settings.mode === "teams" && room.settings.seatCount === 3) {
            room.settings.mode = "ffa";
          }
        }
        const rc = room.settings.resourceCount;
        while (room.seats.length < room.settings.seatCount) {
          room.seats.push({
            id: `ai-${token().slice(0, 6)}`,
            name: `AI ${room.seats.length + 1}`,
            isAi: true,
            ready: true,
            token: token(),
            loadout: defaultTowerLoadout(rc),
          });
        }
        for (const s of room.seats) {
          if (s.isAi) {
            s.loadout = defaultTowerLoadout(rc);
            continue;
          }
          const checked = validateLoadout(s.loadout, rc);
          if (!checked.ok) {
            send({
              type: "error",
              message: `${s.name}: invalid loadout — ${checked.errors.join("; ")}`,
            });
            return ctx;
          }
          s.loadout = checked.towers;
        }
        room.match = createMatch({
          id: room.code,
          seed: Date.now() % 1_000_000,
          settings: room.settings,
          seats: room.seats.map((s) => ({
            id: s.id,
            name: s.name,
            isAi: s.isAi,
            loadout: s.loadout,
          })),
        });
        startTicks(room);
        broadcastState(room);
        break;
      }
      case "placeTile": {
        if (!room.match) break;
        const r = intentPlaceTile(
          room.match,
          playerId,
          raw.cellId,
          raw.rotation,
        );
        if (!r.ok) send({ type: "error", message: r.error ?? "place failed" });
        else broadcastState(room);
        break;
      }
      case "buildTower": {
        if (!room.match) break;
        const r = intentBuildTower(
          room.match,
          playerId,
          raw.cellId,
          raw.typeId,
        );
        if (!r.ok) send({ type: "error", message: r.error ?? "build failed" });
        else broadcastState(room);
        break;
      }
      case "claimMine": {
        if (!room.match) break;
        const r = intentClaimMine(room.match, playerId, raw.cellId);
        if (!r.ok) send({ type: "error", message: r.error ?? "claim failed" });
        else broadcastState(room);
        break;
      }
      case "upgrade": {
        if (!room.match) break;
        const r = intentUpgrade(room.match, playerId, raw.target);
        if (!r.ok) send({ type: "error", message: r.error ?? "upgrade failed" });
        else broadcastState(room);
        break;
      }
      case "toggleBod": {
        if (!room.match) break;
        intentToggleBod(room.match, playerId, raw.bodTypeId, raw.enabled);
        broadcastState(room);
        break;
      }
      case "toggleNoEntry": {
        if (!room.match) break;
        const r = intentToggleNoEntry(
          room.match,
          playerId,
          raw.cellA,
          raw.cellB,
        );
        if (!r.ok) {
          send({ type: "error", message: r.error ?? "toggle failed" });
        } else {
          broadcastState(room);
        }
        break;
      }
      case "toggleTarget": {
        // Deprecated client message retained as a compatibility no-op.
        break;
      }
      case "toggleFriendlyFire": {
        if (!room.match) break;
        intentToggleFriendlyFire(
          room.match,
          playerId,
          raw.towerId,
          raw.enabled,
        );
        broadcastState(room);
        break;
      }
      case "leave": {
        seat.send = undefined;
        if (room.match) {
          seat.isAi = true;
          seat.name = `${seat.name} (AI)`;
          const mp = room.match.players.find((p) => p.id === playerId);
          if (mp) mp.isAi = true;
        } else {
          room.seats = room.seats.filter((s) => s.id !== playerId);
          if (room.hostId === playerId && room.seats[0]) {
            room.hostId = room.seats[0].id;
          }
          if (room.seats.length === 0) {
            stopTicks(room);
            rooms.delete(room.code);
          } else {
            broadcastState(room);
          }
        }
        send({ type: "left" });
        return {};
      }
      default:
        send({ type: "error", message: "Unknown message" });
    }
  } catch (err) {
    send({
      type: "error",
      message: err instanceof Error ? err.message : "Server error",
    });
  }
  return ctx;
}

export function detachSender(roomCode: string, playerId: string): void {
  const room = findRoom(roomCode);
  if (!room) return;
  const seat = room.seats.find((s) => s.id === playerId);
  if (seat) seat.send = undefined;
}
