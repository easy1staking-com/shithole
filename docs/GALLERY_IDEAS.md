# The Dump — 3D gallery ideas & potential (parked 2026-07-22)

Saved from a dev-session discussion after the first walkable prototype
shipped (`/market/gallery`, commits `5a1d64f`..`4f0f11a`). Come back to
this when picking the next gallery iteration.

## Comps to study

- **oncyber.io** — category king for walkable NFT galleries (browser,
  wallet-connected, buy-plaques). See their showcase spaces (e.g.
  /batcave) for the polish bar: baked lighting, Blender architecture,
  ambient audio.
- **spatial.io** — NFT galleries with full-body avatars + multiplayer.
- Decentraland / Voxels — land-parcel flavor, dated, less relevant.
- Codrops react-three-fiber tag + threejs.org showcase — craft ceiling.
- bruno-simon.com — the canonical "browser can do THIS" portfolio.

## Our edge (the thesis)

oncyber wins on polish forever; nobody else does **"the building is the
dataset"** — architecture that encodes on-chain reality:
pool doors, the sewer, rooms that grow with listings, decay tied to
collection death. Keep mining that vein.

## Tiered backlog

### Cheap wins (days)
- [ ] Bloom post-processing — make the neon actually glow
      (@react-three/postprocessing).
- [ ] Ambient audio: dripping water, electrical hum, distant radio per
      room; footsteps; door creaks.
- [ ] Grime textures on walls/floor (replace flat colors).
- [ ] Dust motes in the light cones (cheap particles).
- [ ] A rat that scurries across the corridor (low-poly model on a
      path — peak brand).

### Medium (a week-ish each)
- [ ] Per-collection set-dressing: Snekkies swamp, sewer with knee-high
      fog planes + green caustics.
- [ ] Blender-modeled hub replacing the procedural cylinder.
- [ ] Minimap / teleport-to-room HUD menu.
- [ ] Jump/crouch; physics props to kick around (react-three-rapier).

### Big swings (weeks)
- [ ] Multiplayer presence — other wallets as ghost avatars (WebSocket
      server; simplest viable version is genuinely doable).
- [ ] Live auction rooms — timed drops happening in-world.
- [ ] WebXR — walk the dump in a headset (r3f supports it; input rework).
- [ ] Generative decay — a collection with zero volume for a year
      literally crumbles.

## Still open (prototype polish)

- Name decision: "the dump" (working title) vs deadverse / staleverse /
  septic system / rugtropolis. One constant: `GALLERY_NAME` in
  `web/src/components/market/gallery/rooms.ts`.
- Codex review pass over the gallery code before it rides to main.
- Mobile/touch controls (deliberately deferred — desktop first).
- 6 pools have no logo (dead metadata): A3C, BAIDU, BONE, QCPOL, SALT,
  WEED — see `web/src/lib/market/poolLogos.json` provenance notes.
