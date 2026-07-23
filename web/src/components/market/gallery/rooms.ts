import {
  listPools,
  type Pool,
} from "@/lib/market/poolTraits";
import poolLogos from "@/lib/market/poolLogos.json";
import {
  supportedCollections,
  type SupportedCollection,
} from "@/lib/market/supportedCollections";

/**
 * Room graph + procedural layout for the 3D gallery ("the dump").
 *
 * Topology:
 *   hub (one door per supported collection)
 *   ├─ collection room            — plain collections: all listings, one room
 *   └─ pool lobby (poolDoors)     — CashGrab: 12 rug-pool doors + the sewer
 *      ├─ pool room per ticker    — listings matching ≥1 of the pool's traits
 *      └─ the sewer               — listings matching no pool
 *
 * All geometry is deterministic from the entry counts, so rooms grow as
 * listings appear. Coordinates: y-up, ground at y=0, eye at {@link EYE}.
 */

/** Working title — rename in ONE place when the community picks a name. */
export const GALLERY_NAME = "the dump";
export const GALLERY_TAGLINE = "a walkable landfill for dead NFTs";

export const EYE = 1.6;

export type GalleryEntry = {
  /** txHash:outputIndex — stable identity for focus + React keys. */
  key: string;
  unit: string;
  policy: string;
  detailHref: string;
  name: string;
  priceText: string;
  /** Extra plaque line, e.g. "bundle · 3". */
  sub: string | null;
  /** Rug-pool tickers this NFT matches (empty until metadata loads). */
  poolTickers: string[];
  /** True once CIP-25 metadata resolved (pool assignment is final). */
  metaLoaded: boolean;
  /** Image URL candidates in gateway-rotation order. */
  candidates: string[];
  seed: string;
};

export type RoomRef =
  | { kind: "hub" }
  | { kind: "collection"; policy: string }
  | { kind: "poolLobby"; policy: string }
  | { kind: "pool"; policy: string; ticker: string }
  | { kind: "sewer"; policy: string }
  | { kind: "arcade" };

export function roomKey(r: RoomRef): string {
  switch (r.kind) {
    case "hub":
      return "hub";
    case "collection":
      return `col:${r.policy}`;
    case "poolLobby":
      return `lobby:${r.policy}`;
    case "pool":
      return `pool:${r.policy}:${r.ticker}`;
    case "sewer":
      return `sewer:${r.policy}`;
    case "arcade":
      return "arcade";
  }
}

export type RoomBounds =
  | { kind: "circle"; radius: number }
  | { kind: "rect"; minX: number; maxX: number; minZ: number; maxZ: number };

export type DoorSpec = {
  id: string;
  target: RoomRef;
  label: string;
  sub: string;
  /** CSS color for the lintel glow. */
  color: string;
  /** Same-origin logo path (vendored pool logos) — emblem on the door. */
  logo?: string | null;
  /** Rug-pool doors carry a delegation lever for this ticker. */
  lever?: { ticker: string };
  position: [number, number, number];
  rotationY: number;
};

export type FramePlacement = {
  entry: GalleryEntry;
  position: [number, number, number];
  rotationY: number;
  /** Uniform scale — the entrance hero frame is slightly larger. */
  scale?: number;
};

/** Axis-aligned interior obstacle (freestanding partition walls). */
export type Blocker = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

/** Per-room atmosphere — fog, light tint, floor treatment. */
export type RoomTheme = {
  fog: string;
  fogDensity: number;
  /** Flicker-light color. */
  light: string;
  /** Reflective puddle floor (the sewer). */
  wetFloor: boolean;
  /** Dust-mote color. */
  sparkles: string;
};

export const DEFAULT_THEME: RoomTheme = {
  fog: "#08080a",
  fogDensity: 0.045,
  light: "#e8e3d0",
  wetFloor: false,
  sparkles: "#8a8578",
};

const SEWER_THEME: RoomTheme = {
  fog: "#06100a",
  fogDensity: 0.06,
  light: "#b7e0c0",
  wetFloor: true,
  sparkles: "#5adb8a",
};

export type RoomModel = {
  key: string;
  ref: RoomRef;
  title: string;
  subtitle: string | null;
  theme: RoomTheme;
  bounds: RoomBounds;
  wallHeight: number;
  spawn: { position: [number, number, number]; yaw: number };
  doors: DoorSpec[];
  frames: FramePlacement[];
  /** Interior partitions — rendered as walls, collide like walls. */
  blockers: Blocker[];
  lights: [number, number, number][];
  accent: string;
  /** Big neon sign text (hub only). */
  sign: string | null;
  /** The rug-pool lobby's undead delegation evangelist. */
  zombie?: boolean;
  /** Arcade cabinets (the game room). */
  cabinets?: CabinetSpec[];
};

export type CabinetSpec = {
  game: "snek" | "flappy" | "breakout";
  position: [number, number, number];
  rotationY: number;
};

/* ------------------------------------------------------------------ */
/* Domain: who hangs where                                             */
/* ------------------------------------------------------------------ */

export type GalleryData = {
  collections: SupportedCollection[];
  /** All whitelisted entries, keyed by lowercase policy id. */
  byPolicy: Map<string, GalleryEntry[]>;
};

export function groupByPolicy(entries: GalleryEntry[]): Map<string, GalleryEntry[]> {
  const m = new Map<string, GalleryEntry[]>();
  for (const e of entries) {
    const k = e.policy.toLowerCase();
    const xs = m.get(k);
    if (xs) xs.push(e);
    else m.set(k, [e]);
  }
  // Deterministic hang order so slots don't shuffle between renders.
  for (const xs of m.values()) xs.sort((a, b) => (a.key < b.key ? -1 : 1));
  return m;
}

function collectionEntries(data: GalleryData, policy: string): GalleryEntry[] {
  return data.byPolicy.get(policy.toLowerCase()) ?? [];
}

function poolEntries(data: GalleryData, policy: string, ticker: string): GalleryEntry[] {
  return collectionEntries(data, policy).filter((e) =>
    e.poolTickers.includes(ticker),
  );
}

function sewerEntries(data: GalleryData, policy: string): GalleryEntry[] {
  // Only metadata-resolved entries can be declared poolless — unresolved
  // ones would jump rooms when their traits arrive.
  return collectionEntries(data, policy).filter(
    (e) => e.metaLoaded && e.poolTickers.length === 0,
  );
}

/** Vendored (same-origin) pool logo path, or null — see poolLogos.json. */
function logoFor(ticker: string): string | null {
  const hit = (
    poolLogos as { pools: Array<{ ticker: string; localPath: string | null }> }
  ).pools.find((p) => p.ticker === ticker);
  return hit?.localPath ?? null;
}

/** Deterministic hue from a string — pool doors get stable neon colors. */
export function hueFor(seed: string): number {
  let acc = 0;
  for (let i = 0; i < seed.length; i++) {
    acc = (acc * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return acc % 360;
}

/** Blend two #rrggbb colors — used to tint room light toward accents. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = a.replace("#", "");
  const pb = b.replace("#", "");
  if (pa.length !== 6 || pb.length !== 6) return a;
  let out = "#";
  for (let i = 0; i < 3; i++) {
    const ca = parseInt(pa.slice(i * 2, i * 2 + 2), 16);
    const cb = parseInt(pb.slice(i * 2, i * 2 + 2), 16);
    out += Math.round(ca + (cb - ca) * t)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const DOOR_ARC = 3.2; // wall run consumed by one door in a round room
const FRAME_STEP = 2.4;
const CORRIDOR_W = 9;

function circleRoom(doorCount: number): { radius: number } {
  return { radius: Math.max(6.5, (doorCount * DOOR_ARC) / (2 * Math.PI) + 2.2) };
}

/** Doors evenly around a circle, first door straight ahead of spawn (-z). */
function circleDoors(
  radius: number,
  doors: Array<Pick<DoorSpec, "id" | "target" | "label" | "sub" | "color">>,
): DoorSpec[] {
  const n = doors.length;
  return doors.map((d, i) => {
    const theta = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = radius * Math.cos(theta);
    const z = radius * Math.sin(theta);
    return {
      ...d,
      position: [x, 0, z],
      rotationY: Math.atan2(-Math.cos(theta), -Math.sin(theta)),
    };
  });
}

/**
 * Corridor room: door at x=0 (back the way you came), frames along both
 * long walls, growing +x with the collection.
 */
function corridor(
  entries: GalleryEntry[],
  backDoor: Pick<DoorSpec, "id" | "target" | "label" | "sub" | "color">,
): Pick<
  RoomModel,
  "bounds" | "spawn" | "doors" | "frames" | "blockers" | "lights" | "wallHeight"
> {
  // First entry becomes the HERO: hung on a freestanding partition
  // facing the entrance, so something stares you down the moment you
  // walk in (the far end wall would drown in fog in long rooms).
  const [hero, ...rest] = entries;
  const perWall = Math.ceil(rest.length / 2);
  const startX = 3.2;
  const length = Math.max(11, startX + perWall * FRAME_STEP + 1.5);
  const half = CORRIDOR_W / 2;

  const frames: FramePlacement[] = rest.map((entry, i) => {
    const side = i % 2 === 0 ? -1 : 1; // alternate walls
    const slot = Math.floor(i / 2);
    return {
      entry,
      position: [startX + slot * FRAME_STEP, 1.75, side * (half - 0.06)],
      rotationY: side === -1 ? 0 : Math.PI,
    };
  });

  const blockers: Blocker[] = [];
  if (hero) {
    const px = Math.min(length - 1.8, 8.5); // partition center x
    blockers.push({ minX: px - 0.12, maxX: px + 0.12, minZ: -1.6, maxZ: 1.6 });
    frames.push({
      entry: hero,
      position: [px - 0.17, 1.95, 0],
      rotationY: -Math.PI / 2, // face the entrance
      scale: 1.25,
    });
  }

  const lights: [number, number, number][] = [];
  for (let x = 2.5; x < length && lights.length < 6; x += 6) {
    lights.push([x, 3.6, 0]);
  }

  return {
    bounds: { kind: "rect", minX: 0, maxX: length, minZ: -half, maxZ: half },
    wallHeight: 4,
    spawn: { position: [2.1, EYE, 0], yaw: -Math.PI / 2 },
    doors: [
      {
        ...backDoor,
        position: [0.05, 0, 0],
        rotationY: Math.PI / 2,
      },
    ],
    frames,
    blockers,
    lights,
  };
}

/* ------------------------------------------------------------------ */
/* Room models                                                         */
/* ------------------------------------------------------------------ */

const EXIT_COLOR = "#a1a1aa";

export function buildRoomModel(ref: RoomRef, data: GalleryData): RoomModel {
  switch (ref.kind) {
    case "hub":
      return hubModel(data);
    case "collection":
      return collectionModel(data, ref.policy);
    case "poolLobby":
      return poolLobbyModel(data, ref.policy);
    case "pool":
      return poolModel(data, ref.policy, ref.ticker);
    case "sewer":
      return sewerModel(data, ref.policy);
    case "arcade":
      return arcadeModel();
  }
}

function collectionOf(data: GalleryData, policy: string): SupportedCollection | null {
  return (
    data.collections.find(
      (c) => c.policyId.toLowerCase() === policy.toLowerCase(),
    ) ?? null
  );
}

function hubModel(data: GalleryData): RoomModel {
  const doorDefs: Array<
    Pick<DoorSpec, "id" | "target" | "label" | "sub" | "color">
  > = data.collections.map((c) => {
    const n = collectionEntries(data, c.policyId).length;
    const target: RoomRef = c.poolDoors
      ? { kind: "poolLobby", policy: c.policyId }
      : { kind: "collection", policy: c.policyId };
    return {
      id: `col:${c.policyId}`,
      target,
      label: c.label,
      sub: n === 0 ? "nothing listed" : `${n} listed`,
      color: c.accentColor ?? `hsl(${hueFor(c.policyId)} 80% 60%)`,
    };
  });
  doorDefs.push({
    id: "arcade",
    target: { kind: "arcade" } as RoomRef,
    label: "the arcade",
    sub: "insert nothing",
    color: "#c084fc",
  });
  const { radius } = circleRoom(Math.max(doorDefs.length, 5));
  return {
    key: roomKey({ kind: "hub" }),
    ref: { kind: "hub" },
    title: GALLERY_NAME,
    subtitle: GALLERY_TAGLINE,
    theme: DEFAULT_THEME,
    bounds: { kind: "circle", radius },
    wallHeight: 5.2,
    spawn: { position: [0, EYE, 0], yaw: 0 },
    doors: circleDoors(radius - 0.38, doorDefs),
    frames: [],
    blockers: [],
    lights: [
      [0, 4.2, 0],
      [radius / 2, 3.6, 0],
      [-radius / 2, 3.6, 0],
    ],
    accent: "#eab308",
    sign: GALLERY_NAME,
  };
}

function poolLobbyModel(data: GalleryData, policy: string): RoomModel {
  const col = collectionOf(data, policy);
  const pools: Pool[] = listPools();
  const doorDefs = [
    {
      id: "exit",
      target: { kind: "hub" } as RoomRef,
      label: "exit",
      sub: "back to the dump",
      color: EXIT_COLOR,
    },
    ...pools.map((p) => {
      const n = poolEntries(data, policy, p.ticker).length;
      return {
        id: `pool:${p.ticker}`,
        target: { kind: "pool", policy, ticker: p.ticker } as RoomRef,
        label: p.ticker,
        sub: n === 0 ? "nothing listed" : `${n} listed`,
        color: `hsl(${hueFor(p.ticker)} 85% 62%)`,
        logo: logoFor(p.ticker),
        lever: { ticker: p.ticker },
      };
    }),
    {
      id: "sewer",
      target: { kind: "sewer", policy } as RoomRef,
      label: "the sewer",
      sub: `${sewerEntries(data, policy).length} unsorted`,
      color: "#4ade80",
    },
  ];
  const { radius } = circleRoom(doorDefs.length);
  return {
    key: roomKey({ kind: "poolLobby", policy }),
    ref: { kind: "poolLobby", policy },
    title: `${col?.label ?? "?"} — rug pools`,
    theme: DEFAULT_THEME,
    subtitle: "every door is a stake pool. delegate responsibly.",
    bounds: { kind: "circle", radius },
    wallHeight: 4.6,
    spawn: { position: [0, EYE, 0], yaw: 0 },
    doors: circleDoors(radius - 0.38, doorDefs),
    frames: [],
    blockers: [],
    lights: [
      [0, 4, 0],
      [radius / 2, 3.4, radius / 3],
      [-radius / 2, 3.4, -radius / 3],
    ],
    accent: col?.accentColor ?? "#eab308",
    sign: null,
    zombie: true,
  };
}

function collectionModel(data: GalleryData, policy: string): RoomModel {
  const col = collectionOf(data, policy);
  const entries = collectionEntries(data, policy);
  const base = corridor(entries, {
    id: "exit",
    target: { kind: "hub" },
    label: "exit",
    sub: "back to the dump",
    color: EXIT_COLOR,
  });
  const accent = col?.accentColor ?? "#a1a1aa";
  return {
    key: roomKey({ kind: "collection", policy }),
    ref: { kind: "collection", policy },
    theme: {
      ...DEFAULT_THEME,
      light: mixHex("#e8e3d0", accent, 0.2),
      sparkles: accent,
    },
    title: col?.label ?? "unknown collection",
    subtitle: entries.length === 0 ? "nothing listed — a truly dead room" : null,
    accent: col?.accentColor ?? "#a1a1aa",
    sign: null,
    ...base,
  };
}

function poolModel(data: GalleryData, policy: string, ticker: string): RoomModel {
  const entries = poolEntries(data, policy, ticker);
  const base = corridor(entries, {
    id: "exit",
    target: { kind: "poolLobby", policy },
    label: "exit",
    sub: "back to the pools",
    color: EXIT_COLOR,
  });
  const hue = hueFor(ticker);
  return {
    key: roomKey({ kind: "pool", policy, ticker }),
    ref: { kind: "pool", policy, ticker },
    theme: {
      ...DEFAULT_THEME,
      light: `hsl(${hue} 22% 84%)`,
      sparkles: `hsl(${hue} 60% 62%)`,
    },
    title: `${ticker} den`,
    subtitle:
      entries.length === 0
        ? "no listings match this pool's traits yet"
        : "NFTs matching this pool's curated traits",
    accent: `hsl(${hueFor(ticker)} 85% 62%)`,
    sign: null,
    ...base,
  };
}

function sewerModel(data: GalleryData, policy: string): RoomModel {
  const entries = sewerEntries(data, policy);
  const base = corridor(entries, {
    id: "exit",
    target: { kind: "poolLobby", policy },
    label: "exit",
    sub: "climb out",
    color: EXIT_COLOR,
  });
  return {
    key: roomKey({ kind: "sewer", policy }),
    ref: { kind: "sewer", policy },
    theme: SEWER_THEME,
    title: "the sewer",
    subtitle: "matches no rug pool. nobody wants them. perfect.",
    accent: "#4ade80",
    sign: null,
    ...base,
  };
}

const ARCADE_THEME: RoomTheme = {
  fog: "#0a070f",
  fogDensity: 0.05,
  light: "#d9c6f5",
  wetFloor: false,
  sparkles: "#c084fc",
};

function arcadeModel(): RoomModel {
  const length = 15;
  const half = CORRIDOR_W / 2;
  return {
    key: roomKey({ kind: "arcade" }),
    ref: { kind: "arcade" },
    title: "the arcade",
    subtitle: "high score pays out nothing.",
    theme: ARCADE_THEME,
    bounds: { kind: "rect", minX: 0, maxX: length, minZ: -half, maxZ: half },
    wallHeight: 4,
    spawn: { position: [2.1, EYE, 0], yaw: -Math.PI / 2 },
    doors: [
      {
        id: "exit",
        target: { kind: "hub" },
        label: "exit",
        sub: "back to the dump",
        color: EXIT_COLOR,
        position: [0.05, 0, 0],
        rotationY: Math.PI / 2,
      },
    ],
    frames: [],
    // Cabinet collision — hidden inside the cabinet body so it renders
    // as furniture, not a wall stub.
    blockers: [
      { minX: 8.6, maxX: 9.4, minZ: -4.3, maxZ: -3.7 },
      { minX: 10.3, maxX: 11.1, minZ: -4.3, maxZ: -3.7 },
      { minX: 12.0, maxX: 12.8, minZ: -4.3, maxZ: -3.7 },
    ],
    cabinets: [
      { game: "snek", position: [9, 0, -3.95], rotationY: 0 },
      { game: "flappy", position: [10.7, 0, -3.95], rotationY: 0 },
      { game: "breakout", position: [12.4, 0, -3.95], rotationY: 0 },
    ],
    lights: [
      [3, 3.6, 0],
      [9, 3.6, 0],
      [12.5, 3.6, 0],
    ],
    accent: "#c084fc",
    sign: null,
  };
}

/** Collections whitelist snapshot for the current network. */
export function galleryCollections(): SupportedCollection[] {
  return supportedCollections();
}
