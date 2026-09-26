import { FormEvent, useEffect, useRef, useState } from "react";
import { login, logout, register, type Player } from "./api/game";
import { World, type NavState } from "./game/World";

type Mode = "login" | "register";
type RoomPlayer = { playerId: string; position: { x: number; y: number; z: number } };
type RoomEvent =
  | { type: "room_state"; players: RoomPlayer[] }
  | { type: "player_joined" | "player_moved"; player: RoomPlayer }
  | { type: "player_left"; playerId: string };

const storageKeys = {
  access: "openworld.access",
  refresh: "openworld.refresh",
  player: "openworld.player",
};

// Compass tape calculations
const PX_PER_DEG = 3;
const VIEWPORT_WIDTH = 420;

type CompassTick = {
  deg: number;
  label?: string;
  type: "cardinal-n" | "cardinal-w" | "cardinal" | "sub" | "minor";
  isCardinal: boolean;
};

// Precompute ticks for a continuous 360° scroll (-360° to +720°)
const COMPASS_TICKS: CompassTick[] = [];
for (let d = -360; d <= 720; d += 15) {
  const norm = ((d % 360) + 360) % 360;
  let label: string | undefined;
  let type: CompassTick["type"] = "minor";
  let isCardinal = false;

  if (norm === 0) {
    label = "N";
    type = "cardinal-n";
    isCardinal = true;
  } else if (norm === 90) {
    label = "E";
    type = "cardinal";
    isCardinal = true;
  } else if (norm === 180) {
    label = "S";
    type = "cardinal";
    isCardinal = true;
  } else if (norm === 270) {
    label = "W";
    type = "cardinal-w";
    isCardinal = true;
  } else if (norm === 45) {
    label = "NE";
    type = "sub";
  } else if (norm === 135) {
    label = "SE";
    type = "sub";
  } else if (norm === 225) {
    label = "SW";
    type = "sub";
  } else if (norm === 315) {
    label = "NW";
    type = "sub";
  } else if (norm % 30 === 0) {
    label = `${norm}°`;
    type = "minor";
  }

  COMPASS_TICKS.push({ deg: d, label, type, isCardinal });
}

export default function App() {
  const [player, setPlayer] = useState<Player | null>(() => {
    const saved = localStorage.getItem(storageKeys.player);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Player;
    return parsed.username ? parsed : null;
  });
  const [mode, setMode] = useState<Mode>("login");
  const [status, setStatus] = useState("Sign in to explore");
  const [showFullMap, setShowFullMap] = useState(false);
  const [nav, setNav] = useState<NavState>({
    x: 0,
    z: 0,
    yaw: 0,
    playerAngle: 0,
    biome: "🌿 Starter Glade",
  });

  const worldRef = useRef<HTMLDivElement>(null);
  const world = useRef<World | null>(null);

  function storeAuth(result: { access: string; refresh: string; player: Player }) {
    localStorage.setItem(storageKeys.access, result.access);
    localStorage.setItem(storageKeys.refresh, result.refresh);
    localStorage.setItem(storageKeys.player, JSON.stringify(result.player));
    setPlayer(result.player);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      setStatus("Authenticating…");
      if (mode === "register") {
        storeAuth(await register(form));
      } else {
        storeAuth(await login(String(form.get("username")), String(form.get("password"))));
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authentication failed");
    }
  }

  async function leave() {
    const access = localStorage.getItem(storageKeys.access);
    const refresh = localStorage.getItem(storageKeys.refresh);
    if (access && refresh) await logout(access, refresh);
    Object.values(storageKeys).forEach((key) => localStorage.removeItem(key));
    setPlayer(null);
    setStatus("Signed out");
  }

  useEffect(() => {
    if (!player || !worldRef.current) return;
    const token = localStorage.getItem(storageKeys.access);
    if (!token) {
      setPlayer(null);
      return;
    }
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(
      `${protocol}://${location.hostname}:8000/ws/game/rooms/demo/?token=${encodeURIComponent(token)}`
    );

    world.current = new World(
      worldRef.current,
      (position) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "move", position }));
        }
      },
      (navState) => {
        setNav(navState);
      }
    );

    socket.onopen = () => setStatus("Starter Island — online");
    socket.onmessage = ({ data }) => {
      const event: RoomEvent = JSON.parse(data);
      const ownId = String(player.id);
      if (event.type === "room_state") {
        event.players
          .filter((remote) => remote.playerId !== ownId)
          .forEach((remote) => world.current?.upsertRemote(remote.playerId, remote));
      } else if (event.type === "player_left") {
        world.current?.removeRemote(event.playerId);
      } else if (event.player.playerId !== ownId) {
        world.current?.upsertRemote(event.player.playerId, event.player);
      }
    };
    socket.onclose = () => setStatus("Room connection lost");

    // Keyboard shortcut for toggling map (M key or Escape)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "m" || e.key === "M") {
        setShowFullMap((prev) => !prev);
      } else if (e.key === "Escape") {
        setShowFullMap(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      socket.close();
      window.removeEventListener("keydown", handleKeyDown);
      world.current?.dispose();
      world.current = null;
    };
  }, [player]);

  // Compute Cardinal Heading
  const yawDeg = ((nav.yaw * 180) / Math.PI) % 360;
  const compassDeg = (yawDeg + 360) % 360;
  const cardinalDirections = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const cardinalIndex = Math.round(compassDeg / 45) % 8;
  const cardinalText = cardinalDirections[cardinalIndex];

  // Horizontal tape scroll offset (centered at VIEWPORT_WIDTH / 2)
  const tapeOffset = -((compassDeg + 360) * PX_PER_DEG) + VIEWPORT_WIDTH / 2;

  // Player icon map rotation
  const playerDeg = (nav.playerAngle * 180) / Math.PI;

  // Percentage mapping for full map coordinates (-180 to +180 range)
  const mapPlayerX = Math.min(94, Math.max(6, ((nav.x + 180) / 360) * 100));
  const mapPlayerZ = Math.min(94, Math.max(6, ((nav.z + 180) / 360) * 100));

  if (!player) {
    return (
      <main className="welcome">
        <section>
          <p className="eyebrow">OPENWORLD</p>
          <h1>Starter Island</h1>
          <p>Create an explorer or sign back in.</p>
          <div className="tabs">
            <button
              className={mode === "login" ? "selected" : ""}
              type="button"
              onClick={() => setMode("login")}
            >
              Login
            </button>
            <button
              className={mode === "register" ? "selected" : ""}
              type="button"
              onClick={() => setMode("register")}
            >
              Register
            </button>
          </div>
          <form onSubmit={submit}>
            <label>
              Username
              <input name="username" minLength={1} maxLength={150} required autoFocus />
            </label>
            {mode === "register" && (
              <>
                <label>
                  Display name
                  <input name="display_name" maxLength={24} placeholder="Explorer" />
                </label>
                <label>
                  Avatar
                  <input name="avatar" type="file" accept="image/*" />
                </label>
              </>
            )}
            <label>
              Password
              <input name="password" type="password" minLength={8} required />
            </label>
            {mode === "register" && (
              <label>
                Confirm password
                <input name="password_confirmation" type="password" minLength={8} required />
              </label>
            )}
            <button>{mode === "login" ? "Enter world" : "Create explorer"}</button>
          </form>
          <small>{status}</small>
        </section>
      </main>
    );
  }

  return (
    <main className="game">
      <div ref={worldRef} className="canvas" />
      <div className="crosshair">+</div>

      {/* 1. HORIZONTAL COMPASS BAR IN MOST TOP */}
      <div className="top-compass-container">
        <div className="top-heading-pill">
          <span className="heading-deg">{Math.round(compassDeg)}°</span>
          <span className="heading-cardinal">{cardinalText}</span>
          <span className="heading-divider">·</span>
          <span className="heading-biome">{nav.biome}</span>
        </div>

        <div className="top-compass-bar">
          <div className="compass-center-marker">
            <span className="center-arrow">▼</span>
          </div>

          <div
            className="compass-tape-track"
            style={{ transform: `translateX(${tapeOffset}px)` }}
          >
            {COMPASS_TICKS.map((tick, i) => (
              <div
                key={i}
                className={`tape-tick ${tick.type}`}
                style={{ left: `${(tick.deg + 360) * PX_PER_DEG}px` }}
              >
                {tick.label && (
                  <span className="tick-label">
                    {tick.label}
                    {tick.type === "cardinal-w" && <span className="sea-glyph">🌊</span>}
                  </span>
                )}
                <div className="tick-line" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. MINIMAP ON LEFT SIDE (CLICKABLE TO OPEN FULL MAP POPUP) */}
      <div
        className="left-minimap-card clickable"
        onClick={() => setShowFullMap(true)}
        title="Click to open Full Expedition Map (M)"
      >
        <div className="minimap-header">
          <span className="minimap-title">MAP</span>
          <div className="minimap-coords">
            <span>X: {Math.round(nav.x)}</span>
            <span>·</span>
            <span>Z: {Math.round(nav.z)}</span>
          </div>
        </div>

        <div className="minimap-dial">
          <span className="map-cardinal map-n">N</span>
          <span className="map-cardinal map-e">E</span>
          <span className="map-cardinal map-s">S</span>
          <span className="map-cardinal map-w">W</span>

          <div className="minimap-surface">
            <div className="relief-ocean" title="West Ocean" />
            <div className="relief-beach" title="West Beach Shore" />
            <div className="relief-forest" title="Inland Forest" />
            <div className="radar-cross" />

            <div
              className="player-cursor"
              style={{
                left: `${Math.min(88, Math.max(12, 50 + (nav.x / 180) * 40))}%`,
                top: `${Math.min(88, Math.max(12, 50 + (nav.z / 180) * 40))}%`,
                transform: `translate(-50%, -50%) rotate(${playerDeg}deg)`,
              }}
            >
              ▲
            </div>
          </div>
        </div>

        <div className="minimap-footer">
          <span className="footer-tag">{nav.biome}</span>
          <span className="minimap-hint">Click for Full Map [M]</span>
        </div>
      </div>

      {/* 3. FULL MAP POPUP MODAL */}
      {showFullMap && (
        <div className="full-map-overlay" onClick={() => setShowFullMap(false)}>
          <div
            className="full-map-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Modal Header */}
            <div className="map-modal-header">
              <div className="map-modal-title">
                <h2>🗺️ STARTER ISLAND · EXPEDITION MAP</h2>
                <span className="map-modal-subtitle">
                  {nav.biome} · Coordinates: X {Math.round(nav.x)}, Z {Math.round(nav.z)}
                </span>
              </div>
              <button
                className="map-close-btn"
                onClick={() => setShowFullMap(false)}
                title="Close Map (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Main Interactive Map Canvas */}
            <div className="map-viewport">
              {/* Compass Rose in Corner */}
              <div className="map-compass-rose">
                <span className="rose-n">N</span>
                <span className="rose-e">E</span>
                <span className="rose-s">S</span>
                <span className="rose-w">W</span>
                <div className="rose-needle" />
              </div>

              {/* Geographic Island Topography */}
              <div className="topographic-terrain">
                {/* West Sea Shore & Ocean */}
                <div className="topo-deep-ocean">
                  <span className="topo-label sea">WESTERN OCEAN</span>
                </div>
                <div className="topo-shallows">
                  <span className="topo-label shallows">AZURE SHALLOWS</span>
                </div>
                <div className="topo-beach">
                  <span className="topo-label beach">🏖️ SUNSET BEACH & DUNES</span>
                </div>

                {/* Inland Forest & Highlands */}
                <div className="topo-glade">
                  <span className="topo-label glade">🌿 STARTER GLADE</span>
                </div>
                <div className="topo-forest">
                  <span className="topo-label forest">🌲 TOWERING PINE HIGHLANDS</span>
                </div>
                <div className="topo-ridge">
                  <span className="topo-label ridge">⛰️ MOUNTAIN RIDGE</span>
                </div>

                {/* Grid Overlay */}
                <div className="topo-grid" />

                {/* Points of Interest (POI) Pins */}
                <div className="map-poi poi-beach" style={{ left: "26%", top: "50%" }}>
                  <span className="poi-icon">🏖️</span>
                  <span className="poi-name">West Sea Shore</span>
                </div>
                <div className="map-poi poi-spawn" style={{ left: "50%", top: "50%" }}>
                  <span className="poi-icon">📍</span>
                  <span className="poi-name">Starter Glade (Spawn)</span>
                </div>
                <div className="map-poi poi-pines" style={{ left: "68%", top: "35%" }}>
                  <span className="poi-icon">🌲</span>
                  <span className="poi-name">Alpine Pine Grove</span>
                </div>
                <div className="map-poi poi-ridge" style={{ left: "76%", top: "65%" }}>
                  <span className="poi-icon">⛰️</span>
                  <span className="poi-name">Eastern Ridge</span>
                </div>

                {/* Live Animated Player Position Marker */}
                <div
                  className="fullmap-player-pin"
                  style={{
                    left: `${mapPlayerX}%`,
                    top: `${mapPlayerZ}%`,
                  }}
                >
                  <div className="player-pulse-ring" />
                  <div
                    className="player-pin-arrow"
                    style={{ transform: `rotate(${playerDeg}deg)` }}
                  >
                    ▲
                  </div>
                  <span className="player-pin-label">YOU (Explorer)</span>
                </div>
              </div>
            </div>

            {/* Modal Footer with Legend & Hotkey Hint */}
            <div className="map-modal-footer">
              <div className="map-legend">
                <span className="legend-item">
                  <span className="legend-swatch swatch-sea" /> West Ocean
                </span>
                <span className="legend-item">
                  <span className="legend-swatch swatch-beach" /> Sandy Beach
                </span>
                <span className="legend-item">
                  <span className="legend-swatch swatch-glade" /> Meadow Glade
                </span>
                <span className="legend-item">
                  <span className="legend-swatch swatch-forest" /> Pine Forest
                </span>
                <span className="legend-item">
                  <span className="legend-swatch swatch-player" /> Current Location
                </span>
              </div>
              <span className="map-hotkey-hint">Press <strong>M</strong> or <strong>ESC</strong> to close</span>
            </div>
          </div>
        </div>
      )}

      {/* 4. PROFILE HUD ON BOTTOM LEFT */}
      <aside className="bottom-left-profile">
        {player.avatar && <img src={player.avatar} alt="" />}
        <strong>{player.display_name || player.username}</strong>
        <span>@{player.username}</span>
        <span>{status}</span>
        <span>WASD to move · drag to orbit</span>
        <button type="button" onClick={leave}>
          Sign out
        </button>
      </aside>
    </main>
  );
}

// Automatically reload the page when hot modules update
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}
