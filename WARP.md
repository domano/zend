# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

A multiplayer 2D pixel sand simulation game where players place particles in a shared canvas. The architecture uses **client-side physics** (Matter.js) with **real-time multiplayer sync** (Socket.IO).

### Key Architecture Principle
All physics calculations run in the browser—the server is a stateless message router. Each client maintains its own Matter.js physics world and syncs particle placements with other clients.

## Common Commands

### Local Development
```bash
cd server && npm install      # Install dependencies
npm start                      # Run server (port 3000)
```

### Deployment
```bash
fly deploy                     # Deploy to Fly.io
fly logs                       # View production logs
fly open                       # Open app in browser
```

## Architecture & File Structure

### Frontend (`game.js`, `index.html`)
- **game.js** (224 lines): Phaser game scene, Matter.js physics engine, Socket.IO client
- Responsive canvas sizing (`getGameDimensions()`) that scales based on viewport
- Material system with predefined types (SAND, WATER, FIRE, ACID) each with physics properties
- Particle batching for performance (50 particles per frame, 100ms batch intervals)
- State syncing with server using chunked transfers (200 particles per chunk)

### Backend (`server/server.js`)
- Express server serving static files from root and `public/`
- Socket.IO server with event handlers:
  - `connection`: Sends chunked state sync to new players
  - `placeSand`: Legacy single particle placement (buffered)
  - `sandBatch`: Batch particle placement (buffered)
  - `resetWorld`: Clears server state, broadcasts to all clients
- Server-side particle buffering (50 particles, 100ms interval) before broadcasting

### Deployment Files
- **Dockerfile**: Multi-stage Alpine Node.js 18 build, serves via `node server/server.js`
- **fly.toml**: Fly.io config with shared-cpu-1x/256MB VM, Frankfurt region, HTTP health checks
- **package.json**: Node 18+, dependencies: express, socket.io

## Performance Patterns

1. **Client-side batching**: Sand placements batched client-side before sending to server
2. **Server-side batching**: Server batches incoming placements before broadcasting
3. **Chunked state sync**: New players receive existing particles in 200-particle chunks (50ms delay between chunks)
4. **Particle creation queuing**: Client creates 50 particles per frame from queue to prevent frame drops
5. **Matter.js sleeping disabled** for responsive gameplay

## Socket.IO Event Flow

**Client → Server:**
- `placeSand`: Single particle `{x, y, materialType}`
- `sandBatch`: Array of particles `[{x, y, materialType}, ...]`
- `resetWorld`: Clears all state

**Server → Clients:**
- `sandPlaced`: Single particle (legacy)
- `sandBatch`: Array of particles (current)
- `syncSandChunk`: Chunked state `{chunk, chunkIndex, totalChunks, isLast}`
- `worldReset`: Clear all particles

## Material System

Located in `game.js` (lines 82-145), `MATERIALS` object defines particle types with properties:
- `color`: Hex color code
- `density`: Physics mass scaling
- `friction`, `restitution`: Physics parameters
- `reactions`: Particle-to-particle interactions (e.g., FIRE + WATER = EVAPORATE)
- `gravityScale`: Optional gravity override (used by FIRE for rising effect)

## Common Modification Tasks

### Add new particle type
1. Add entry to `MATERIALS` object in `game.js` with color, density, friction, restitution
2. Define any `reactions` with existing materials
3. No server changes needed

### Adjust physics
- `gravity.y` in Phaser config (line 61)
- Particle properties in `MATERIALS` entries
- `PARTICLES_PER_FRAME` for creation batching (line 169)

### Change batch sizes
- Client: `BATCH_SIZE` and `BATCH_INTERVAL` (lines 156-157)
- Server: Same constants (lines 33-34)
- Chunk size: `SYNC_CHUNK_SIZE` (line 39, server) and `PARTICLES_PER_FRAME` (line 169, client)

### Add new Socket.IO event
1. Client: Emit with `socket.emit('eventName', data)` in game.js
2. Server: Add handler in `io.on('connection')` block (server.js line 97+)
3. Server: Broadcast with `io.emit()` or `socket.broadcast.emit()`
4. Client: Add listener with `socket.on('eventName', handler)` in game.js

## Game Responsiveness

Canvas scales via `getGameDimensions()` with:
- Aspect ratio preservation (800:600)
- Mobile vs desktop UI spacing detection
- Minimum 320x240, maximum 1200x900 (on large screens)

Resize handling via Phaser's built-in responsiveness—no manual listener needed.

## Troubleshooting

**Particles not syncing to other players**: Check browser console for Socket.IO connection; verify server broadcasts to all clients (not just sender)

**Frame drops**: Increase `PARTICLES_PER_FRAME` or reduce `BATCH_SIZE` to lower per-frame load

**High memory on Fly.io**: Current VM is 256MB—increase with `fly scale memory 512` if needed; update `fly.toml` to match

**Server won't start**: Verify Node 18+, check `server/node_modules` exists, review `fly logs` output
