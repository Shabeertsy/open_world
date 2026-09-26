import { FormEvent, useEffect, useRef, useState } from "react";
import { login, logout, register, type Player } from "./api/game";
import { World, type NavState, type BarType, type ExchangeBooth } from "./game/World";

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

export type Inventory = {
  bronze: number;
  silver: number;
  gold: number;
  opTokens: number;
};

const INVENTORY_STORAGE_KEY = "openworld_player_inventory";

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
    biome: "Starter Glade",
  });

  const worldRef = useRef<HTMLDivElement>(null);
  const world = useRef<World | null>(null);

  // Collectible Bars & OP Token Inventory State (Persisted in localStorage)
  const [inventory, setInventory] = useState<Inventory>(() => {
    try {
      const saved = localStorage.getItem(INVENTORY_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return { bronze: 0, silver: 0, gold: 0, opTokens: 0 };
  });

  const [nearBooth, setNearBooth] = useState<ExchangeBooth | null>(null);
  const [showExchangeModal, setShowExchangeModal] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2800);
  };

  const updateInventory = (updater: (prev: Inventory) => Inventory) => {
    setInventory((prev) => {
      const next = updater(prev);
      localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const exchangeBars = (type: BarType | "all", amount?: number) => {
    updateInventory((prev) => {
      let earned = 0;
      let newBronze = prev.bronze;
      let newSilver = prev.silver;
      let newGold = prev.gold;

      if (type === "all") {
        earned = prev.bronze * 5 + prev.silver * 25 + prev.gold * 100;
        newBronze = 0;
        newSilver = 0;
        newGold = 0;
      } else if (type === "gold") {
        const qty = Math.min(prev.gold, amount ?? prev.gold);
        earned = qty * 100;
        newGold -= qty;
      } else if (type === "silver") {
        const qty = Math.min(prev.silver, amount ?? prev.silver);
        earned = qty * 25;
        newSilver -= qty;
      } else if (type === "bronze") {
        const qty = Math.min(prev.bronze, amount ?? prev.bronze);
        earned = qty * 5;
        newBronze -= qty;
      }

      if (earned > 0) {
        world.current?.playPickupSound("exchange");
        showToast(`✨ Exchanged for +${earned} OP Tokens!`);
      }

      return {
        bronze: newBronze,
        silver: newSilver,
        gold: newGold,
        opTokens: prev.opTokens + earned,
      };
    });
  };

  // Virtual Touch Joystick & Action Buttons State (Right Side)
  const [joystickPos, setJoystickPos] = useState({ x: 0, y: 0 });
  const [isJumping, setIsJumping] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const joystickActive = useRef(false);
  const joystickCenter = useRef({ x: 0, y: 0 });
  const MAX_JOYSTICK_RADIUS = 46;

  const updateJoystick = (clientX: number, clientY: number) => {
    const rawDx = clientX - joystickCenter.current.x;
    const rawDy = clientY - joystickCenter.current.y;
    const dist = Math.hypot(rawDx, rawDy);
    const clampedDist = Math.min(dist, MAX_JOYSTICK_RADIUS);
    const angle = Math.atan2(rawDy, rawDx);

    const stickX = Math.cos(angle) * clampedDist;
    const stickY = Math.sin(angle) * clampedDist;
    setJoystickPos({ x: stickX, y: stickY });

    // Invert Y so dragging upward moves forward
    const normX = stickX / MAX_JOYSTICK_RADIUS;
    const normY = -stickY / MAX_JOYSTICK_RADIUS;
    world.current?.setJoystickInput(normX, normY);
  };

  const handleJoystickDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    joystickActive.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    joystickCenter.current = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
    updateJoystick(e.clientX, e.clientY);
  };

  const handleJoystickMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!joystickActive.current) return;
    e.preventDefault();
    e.stopPropagation();
    updateJoystick(e.clientX, e.clientY);
  };

  const handleJoystickUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!joystickActive.current) return;
    e.preventDefault();
    e.stopPropagation();
    joystickActive.current = false;
    setJoystickPos({ x: 0, y: 0 });
    world.current?.setJoystickInput(0, 0);
  };

  const handleJumpPress = (e: React.PointerEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsJumping(true);
    world.current?.jump();
    setTimeout(() => setIsJumping(false), 200);
  };

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
        if (typeof navState.isRunning === "boolean") {
          setIsRunning(navState.isRunning);
        }
      },
      (barType) => {
        setInventory((prev) => {
          const next = { ...prev, [barType]: prev[barType] + 1 };
          localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(next));
          return next;
        });
        const name =
          barType === "gold"
            ? "Gold Bar (+100 OP)"
            : barType === "silver"
            ? "Silver Bar (+25 OP)"
            : "Bronze Bar (+5 OP)";
        const icon = barType === "gold" ? "🥇" : barType === "silver" ? "🥈" : "🪙";
        showToast(`${icon} Found ${name}!`);
      },
      (booth) => {
        setNearBooth(booth);
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

    // Keyboard shortcut for toggling map (M key or Escape) and Exchange (E key)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "m" || e.key === "M") {
        setShowFullMap((prev) => !prev);
      } else if (e.key === "Escape") {
        setShowFullMap(false);
        setShowExchangeModal(false);
      } else if (e.key === "e" || e.key === "E") {
        setShowExchangeModal((prev) => !prev);
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
          <span className="heading-divider">·</span>
          <button
            type="button"
            className={`heading-speed-badge ${isRunning ? "running" : "walking"}`}
            title="Click or press R to toggle Fast Run mode"
            onClick={() => {
              const next = world.current?.toggleRunning();
              if (typeof next === "boolean") setIsRunning(next);
            }}
          >
            {isRunning ? "⚡ RUN (FAST)" : "WALK (NORMAL)"}
          </button>
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
                  </span>
                )}
                <div className="tick-line" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TOP-RIGHT COMPACT CURRENCY & BARS HUD (smaller, sleek) */}
      <div className="top-right-currency-hud">
        <div
          className="currency-pill-card"
          onClick={() => setShowExchangeModal(true)}
          title="Click to open OP Token Exchange"
        >
          {/* OP Token Native Currency */}
          <div className="currency-item op-token-item">
            <span className="token-icon">💎</span>
            <span className="token-amount">{inventory.opTokens}</span>
            <span className="token-ticker">OP</span>
          </div>

          <div className="currency-divider" />

          {/* Gold Bar */}
          <div className="currency-item bar-item gold" title="Gold Bars (100 OP value each)">
            <span className="bar-icon">🥇</span>
            <span className="bar-count">{inventory.gold}</span>
          </div>

          {/* Silver Bar */}
          <div className="currency-item bar-item silver" title="Silver Bars (25 OP value each)">
            <span className="bar-icon">🥈</span>
            <span className="bar-count">{inventory.silver}</span>
          </div>

          {/* Bronze Bar */}
          <div className="currency-item bar-item bronze" title="Bronze Bars (5 OP value each)">
            <span className="bar-icon">🪙</span>
            <span className="bar-count">{inventory.bronze}</span>
          </div>
        </div>

        {/* Proximity Prompt if standing near an Exchange Merchant Booth */}
        {nearBooth && (
          <button
            type="button"
            className="near-exchange-prompt-btn"
            onClick={() => setShowExchangeModal(true)}
            title="Press E to trade"
          >
            <span className="exchange-pulse-dot" />
            <span className="exchange-prompt-key">E</span>
            <span className="exchange-prompt-text">{nearBooth.name}</span>
          </button>
        )}
      </div>

      {/* FLOATING PICKUP TOAST NOTICE */}
      {toastMessage && (
        <div className="pickup-toast">
          {toastMessage}
        </div>
      )}

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
            <div className="relief-road-line" title="Highland Highway" />
            <div className="relief-city-dot" title="Pinehaven City" />
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
                <h2>STARTER ISLAND · EXPEDITION MAP</h2>
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
                  <span className="topo-label beach">GOLDEN BEACH & DUNES</span>
                </div>

                {/* Inland Forest & Highlands */}
                <div className="topo-glade">
                  <span className="topo-label glade">STARTER GLADE</span>
                </div>
                <div className="topo-forest">
                  <span className="topo-label forest">TOWERING PINE HIGHLANDS</span>
                </div>
                <div className="topo-ridge">
                  <span className="topo-label ridge">MOUNTAIN RIDGE</span>
                </div>

                {/* Visual Road Ribbon Overlay (parallel to beach along Z) */}
                <div className="topo-road-ribbon" title="Highland Highway" />

                {/* Pinehaven City District Zone */}
                <div className="topo-city-zone" title="Pinehaven City District">
                  <span className="topo-label city">PINEHAVEN CITY</span>
                </div>

                {/* Grid Overlay */}
                <div className="topo-grid" />

                {/* Points of Interest (POI) Pins */}
                <div className="map-poi poi-beach" style={{ left: "26%", top: "50%" }}>
                  <span className="poi-dot dot-beach" />
                  <span className="poi-name">West Sea Shore</span>
                </div>
                <div className="map-poi poi-spawn" style={{ left: "50%", top: "50%" }}>
                  <span className="poi-dot dot-spawn" />
                  <span className="poi-name">Starter Glade (Spawn)</span>
                </div>
                <div className="map-poi poi-pines" style={{ left: "68%", top: "35%" }}>
                  <span className="poi-dot dot-pines" />
                  <span className="poi-name">Alpine Pine Grove</span>
                </div>
                <div className="map-poi poi-road" style={{ left: "75.5%", top: "35%" }}>
                  <span className="poi-dot dot-road" />
                  <span className="poi-name">Highland Highway</span>
                </div>
                <div className="map-poi poi-city" style={{ left: "77%", top: "68%" }}>
                  <span className="poi-dot dot-city" />
                  <span className="poi-name">Pinehaven City</span>
                </div>
                <div className="map-poi poi-ridge" style={{ left: "84%", top: "75%" }}>
                  <span className="poi-dot dot-ridge" />
                  <span className="poi-name">Eastern Ridge</span>
                </div>

                {/* OP Token Exchange Booth POIs */}
                <div className="map-poi poi-exchange" style={{ left: "74.5%", top: "70%" }}>
                  <span className="poi-dot dot-exchange" />
                  <span className="poi-name">Pinehaven Exchange 💱</span>
                </div>
                <div className="map-poi poi-exchange" style={{ left: "74.6%", top: "37%" }}>
                  <span className="poi-dot dot-exchange" />
                  <span className="poi-name">Highway Exchange 💱</span>
                </div>
                <div className="map-poi poi-exchange" style={{ left: "37.5%", top: "53%" }}>
                  <span className="poi-dot dot-exchange" />
                  <span className="poi-name">West Beach Exchange 💱</span>
                </div>
                <div className="map-poi poi-exchange" style={{ left: "53.5%", top: "53%" }}>
                  <span className="poi-dot dot-exchange" />
                  <span className="poi-name">Glade Exchange 💱</span>
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
                  <span className="legend-swatch swatch-road" /> Highland Road
                </span>
                <span className="legend-item">
                  <span className="legend-swatch swatch-city" /> Pinehaven City
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
        <span>WASD / Stick to move · R or Shift / RUN for fast run · Space / ▲ to jump · Drag to orbit</span>
        <button type="button" onClick={leave}>
          Sign out
        </button>
      </aside>

      {/* 5. RIGHT-SIDE TOUCH JOYSTICK & ACTIONS HUD */}
      <div className="right-touch-hud">
        {/* Action Buttons: Run & Jump */}
        <div className="touch-actions-row">
          <button
            type="button"
            className={`touch-action-btn touch-run-btn ${isRunning ? "active" : ""}`}
            id="touch-run-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const next = world.current?.toggleRunning();
              if (typeof next === "boolean") setIsRunning(next);
            }}
            title="Toggle Fast Run (R / Shift / Click)"
          >
            <span className="btn-icon">⚡</span>
            <span className="btn-label">{isRunning ? "RUNNING" : "RUN"}</span>
            <span className="btn-sublabel">{isRunning ? "15.5 m/s" : "FAST"}</span>
          </button>

          <button
            type="button"
            className={`touch-action-btn touch-jump-btn ${isJumping ? "active" : ""}`}
            id="touch-jump-btn"
            onPointerDown={handleJumpPress}
            title="Jump (Spacebar)"
          >
            <span className="jump-arrow">▲</span>
            <span className="jump-label">JUMP</span>
          </button>
        </div>

        {/* Virtual Movement Joystick */}
        <div
          className="touch-joystick-card"
          id="touch-joystick-card"
          onPointerDown={handleJoystickDown}
          onPointerMove={handleJoystickMove}
          onPointerUp={handleJoystickUp}
          onPointerCancel={handleJoystickUp}
          title="Virtual Movement Joystick"
        >
          <div className="joystick-base">
            <span className="joystick-cardinal dir-n">W</span>
            <span className="joystick-cardinal dir-s">S</span>
            <span className="joystick-cardinal dir-w">A</span>
            <span className="joystick-cardinal dir-e">D</span>
            <div className="joystick-inner-ring" />
            <div
              className="joystick-thumb"
              style={{
                transform: `translate(${joystickPos.x}px, ${joystickPos.y}px)`,
              }}
            >
              <div className="thumb-grip" />
            </div>
          </div>
          <span className="joystick-hint">MOVE JOYSTICK</span>
        </div>
      </div>

      {/* 6. OP TOKEN EXCHANGE MODAL */}
      {showExchangeModal && (
        <div className="exchange-modal-overlay" onClick={() => setShowExchangeModal(false)}>
          <div className="exchange-modal" onClick={(e) => e.stopPropagation()}>
            <div className="exchange-header">
              <div className="exchange-title-group">
                <span className="exchange-badge">NATIVE CURRENCY TRADING</span>
                <h2>OP Token Exchange</h2>
                <p className="exchange-subtitle">
                  {nearBooth ? nearBooth.name : "Merchant Kiosk"} · Convert raw precious metal bars into island OP Tokens.
                </p>
              </div>
              <button
                className="exchange-close-btn"
                onClick={() => setShowExchangeModal(false)}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            {/* Current Balances Header */}
            <div className="exchange-balance-banner">
              <div className="balance-item op-balance">
                <span className="balance-label">CURRENT BALANCE</span>
                <span className="balance-val">💎 {inventory.opTokens} <small>OP</small></span>
              </div>
              <div className="balance-divider" />
              <div className="balance-bars-row">
                <span className="bar-tag gold">🥇 {inventory.gold} Gold</span>
                <span className="bar-tag silver">🥈 {inventory.silver} Silver</span>
                <span className="bar-tag bronze">🪙 {inventory.bronze} Bronze</span>
              </div>
            </div>

            {/* Trading Rows for each Bar Type */}
            <div className="exchange-cards-grid">
              {/* Gold Bar Row */}
              <div className="exchange-trade-card gold-card">
                <div className="trade-card-header">
                  <div className="card-icon gold">🥇</div>
                  <div className="card-info">
                    <h4>Gold Ingot</h4>
                    <span className="rate-hint">Rate: 1 Bar = <strong>100 OP</strong></span>
                  </div>
                  <div className="card-held">You have: <strong>{inventory.gold}</strong></div>
                </div>
                <div className="trade-actions-btns">
                  <button
                    type="button"
                    disabled={inventory.gold < 1}
                    onClick={() => exchangeBars("gold", 1)}
                    className="trade-btn"
                  >
                    Sell 1 (+100 OP)
                  </button>
                  <button
                    type="button"
                    disabled={inventory.gold < 1}
                    onClick={() => exchangeBars("gold")}
                    className="trade-btn all"
                  >
                    Sell All ({inventory.gold * 100} OP)
                  </button>
                </div>
              </div>

              {/* Silver Bar Row */}
              <div className="exchange-trade-card silver-card">
                <div className="trade-card-header">
                  <div className="card-icon silver">🥈</div>
                  <div className="card-info">
                    <h4>Silver Ingot</h4>
                    <span className="rate-hint">Rate: 1 Bar = <strong>25 OP</strong></span>
                  </div>
                  <div className="card-held">You have: <strong>{inventory.silver}</strong></div>
                </div>
                <div className="trade-actions-btns">
                  <button
                    type="button"
                    disabled={inventory.silver < 1}
                    onClick={() => exchangeBars("silver", 1)}
                    className="trade-btn"
                  >
                    Sell 1 (+25 OP)
                  </button>
                  <button
                    type="button"
                    disabled={inventory.silver < 1}
                    onClick={() => exchangeBars("silver")}
                    className="trade-btn all"
                  >
                    Sell All ({inventory.silver * 25} OP)
                  </button>
                </div>
              </div>

              {/* Bronze Bar Row */}
              <div className="exchange-trade-card bronze-card">
                <div className="trade-card-header">
                  <div className="card-icon bronze">🪙</div>
                  <div className="card-info">
                    <h4>Bronze Ingot</h4>
                    <span className="rate-hint">Rate: 1 Bar = <strong>5 OP</strong></span>
                  </div>
                  <div className="card-held">You have: <strong>{inventory.bronze}</strong></div>
                </div>
                <div className="trade-actions-btns">
                  <button
                    type="button"
                    disabled={inventory.bronze < 1}
                    onClick={() => exchangeBars("bronze", 1)}
                    className="trade-btn"
                  >
                    Sell 1 (+5 OP)
                  </button>
                  <button
                    type="button"
                    disabled={inventory.bronze < 1}
                    onClick={() => exchangeBars("bronze")}
                    className="trade-btn all"
                  >
                    Sell All ({inventory.bronze * 5} OP)
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Action: Convert All Bars */}
            <div className="exchange-footer-actions">
              <button
                type="button"
                className="exchange-all-btn"
                disabled={inventory.gold === 0 && inventory.silver === 0 && inventory.bronze === 0}
                onClick={() => exchangeBars("all")}
              >
                <span>⚡ EXCHANGE ALL INVENTORY</span>
                <span className="exchange-all-value">
                  +{inventory.gold * 100 + inventory.silver * 25 + inventory.bronze * 5} OP TOKENS
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// Automatically reload the page when hot modules update
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}
