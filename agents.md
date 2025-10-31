# LLM Agent Guide - Multiplayer Sand Game

This guide provides essential context for LLM agents working on this multiplayer sand simulation game project.

## Project Overview

A multiplayer 2D pixel sand simulation game where players can place sand particles in a shared canvas. The game uses:
- **Client-side physics**: Matter.js handles all physics calculations in the browser
- **Real-time multiplayer**: Socket.IO syncs player actions across connected clients
- **Modern web stack**: Phaser.js for game rendering, Express for the server

## Architecture

### Technology Stack
- **Frontend**: 
  - Phaser.js 3.80.1 (game engine/rendering)
  - Matter.js 0.19.0 (physics engine)
  - Socket.IO Client 4.7.2 (WebSocket communication)
- **Backend**: 
  - Node.js 18+
  - Express 4.18.2 (HTTP server)
  - Socket.IO 4.7.2 (WebSocket server)
- **Deployment**: 
  - Fly.io (platform)
  - Docker (containerization)

### How It Works

1. **Client-side physics**: All physics calculations happen in the browser using Matter.js. This ensures smooth gameplay and reduces server load.
2. **Multiplayer sync**: When a player places sand, the client sends a `placeSand` event to the server via Socket.IO. The server broadcasts this to all other clients, who then render the particle locally.
3. **Server role**: The server is minimal - it only handles WebSocket message routing. No game state is stored server-side.

## File Structure

```
/
├── index.html          # Main HTML page with CDN script tags
├── game.js             # Phaser + Matter.js game logic (client-side)
├── server/
│   ├── server.js       # Express + Socket.IO server (Node.js)
│   ├── package.json    # Backend dependencies
│   └── node_modules/   # Installed dependencies
├── public/             # Static assets directory (optional)
├── Dockerfile          # Container build configuration
├── fly.toml            # Fly.io deployment configuration
├── README.md           # User-facing documentation
└── agents.md           # This file (LLM agent guide)
```

### Key Files Explained

#### `index.html`
- Entry point, loads game scripts from CDN
- Minimal HTML structure with game container
- Loads: Phaser.js, Matter.js, Socket.IO Client, and `game.js`

#### `game.js`
- Main game logic (224 lines)
- Phaser game configuration and scene setup
- Matter.js physics engine integration
- Socket.IO client connection and event handlers
- Particle management (max 500 particles per client)
- Input handling (click/drag to place sand)

#### `server/server.js`
- Express server serving static files
- Routes: `/` serves `index.html`, `/game.js` serves `game.js`
- Socket.IO server with two events:
  - `connection`: Logs new player connections
  - `placeSand`: Broadcasts sand placement to other clients
  - `disconnect`: Logs player disconnections

#### `Dockerfile`
- Multi-stage build using Node.js 18 Alpine
- Copies `server/package*.json` first for dependency caching
- Installs production dependencies only
- Copies server and frontend files
- Runs `node server/server.js` on port 3000

#### `fly.toml`
- App name: `sand-game`
- Region: `iad` (US East)
- VM size: `shared-cpu-1x` with 256MB memory (smallest instance)
- Auto-scaling: machines stop when idle, start on traffic
- Health checks: GET `/` every 30 seconds

## Development Workflow

### Local Development

1. **Install dependencies**:
   ```bash
   cd server
   npm install
   ```

2. **Start server**:
   ```bash
   npm start
   # or
   node server.js
   ```

3. **Access game**: Open `http://localhost:3000` in browser

### Important Patterns

#### Client-Side Physics
- All physics calculations use Matter.js in the browser
- Server does NOT simulate physics
- Each client maintains its own physics world
- When a particle is placed locally, it's added to the local Matter.js world
- When receiving `sandPlaced` event, the particle is added to local world

#### Multiplayer Sync
- Client emits `placeSand` with `{x, y, color}` coordinates
- Server broadcasts to all OTHER clients (not sender)
- Receiving clients create particle in their local physics world
- No conflict resolution needed - all clients see the same sequence

#### Performance Considerations
- Maximum 500 particles per client
- Automatic cleanup of out-of-bounds particles
- Matter.js sleeping disabled for better responsiveness
- Server is stateless - scales horizontally easily

## Common Modification Tasks

### Adding New Particle Types
1. Add color constant in `game.js`
2. Modify `createSandParticle()` or create new creation function
3. Update Socket.IO event data structure if needed
4. No server changes required (unless adding new events)

### Changing Physics Parameters
- Edit `game.js` - all physics in `matterEngine` object
- Gravity: `config.physics.matter.gravity`
- Particle properties: radius, density, friction in `createSandParticle()`

### Adding New Multiplayer Events
1. Client: Add socket event listener in `game.js`
2. Client: Emit new event with `socket.emit('eventName', data)`
3. Server: Add `socket.on('eventName', handler)` in `server/server.js`
4. Server: Broadcast with `socket.broadcast.emit()` or `io.emit()`

### Modifying Server Routes
- Add routes in `server/server.js` before Socket.IO setup
- Use `app.get()`, `app.post()`, etc. as needed
- Static files served from `public/` directory

## Deployment Instructions

### Prerequisites
- Fly.io CLI installed (`flyctl`)
- Authenticated with Fly.io account

### Quick Deploy

1. **Authenticate** (if not already):
   ```bash
   fly auth login
   ```

2. **Create app** (if first time):
   ```bash
   fly apps create sand-game --org personal
   ```

3. **Deploy**:
   ```bash
   fly deploy
   ```

4. **Verify**:
   ```bash
   fly status
   fly scale show  # Should show shared-cpu-1x with 256mb
   ```

### App Details
- **URL**: https://sand-game.fly.dev/
- **Instance**: `shared-cpu-1x` (1 shared CPU, 256MB memory)
- **Region**: `iad` (US East)
- **Auto-scaling**: Machines stop when idle, start on traffic

### Useful Deployment Commands
```bash
fly logs              # View application logs
fly open              # Open app in browser
fly scale show        # Check instance configuration
fly apps restart      # Restart machines
```

## Important Constraints

1. **No server-side game state**: Server is purely a message router
2. **Client-side physics**: All physics runs in browser - don't add server-side simulation
3. **Stateless design**: Each request/connection is independent
4. **Port 3000**: Hardcoded in server, configured in `fly.toml` and `Dockerfile`
5. **CDN dependencies**: Frontend libraries loaded from CDN in `index.html`
6. **Production deps only**: Dockerfile uses `--only=production` flag

## Code Patterns to Follow

### Socket.IO Pattern
```javascript
// Client emits
socket.emit('eventName', { data: 'value' });

// Server receives and broadcasts
socket.on('eventName', (data) => {
    socket.broadcast.emit('eventToOthers', data);
});

// Clients listen
socket.on('eventToOthers', (data) => {
    // Handle received data
});
```

### Phaser/Matter.js Pattern
```javascript
// Access Matter.js world
matterEngine = this.matter.world;

// Create physics body
const body = matterEngine.add.circle(x, y, radius, {
    frictionAir: 0.01,
    restitution: 0.3
});
```

### File Serving Pattern
```javascript
// Static files
app.use(express.static(publicPath));

// Specific files
app.get('/game.js', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'game.js'));
});
```

## Testing Considerations

- Test locally before deploying
- Multiple browser tabs/windows to test multiplayer
- Check browser console for Socket.IO connection logs
- Verify particles appear on other clients
- Monitor Fly.io logs for server-side issues

## When Making Changes

### Frontend Changes (`game.js`, `index.html`)
- Test locally
- No server restart needed if only client code changes
- Deploy with `fly deploy`

### Backend Changes (`server/server.js`)
- Test locally with `npm start`
- Restart server to see changes
- Deploy with `fly deploy`

### Configuration Changes (`fly.toml`, `Dockerfile`)
- Test Docker build locally: `docker build -t sand-game .`
- Deploy with `fly deploy`
- Check `fly scale show` after deployment to verify VM config

### Dependency Changes (`server/package.json`)
- Update in `server/` directory
- Run `npm install` locally to test
- Deploy with `fly deploy` (will rebuild Docker image)

## Troubleshooting

### Particles not appearing for other players
- Check Socket.IO connection in browser console
- Verify server logs show connection events
- Ensure `socket.broadcast.emit()` is used (not `io.emit()` which includes sender)

### Server not starting
- Check `PORT` environment variable (defaults to 3000)
- Verify `server/node_modules` exists and dependencies installed
- Check Fly.io logs: `fly logs`

### Deployment failures
- Verify `fly.toml` syntax is valid
- Check Dockerfile builds locally
- Ensure all required files are in repository

### Memory issues on Fly.io
- Current: 256MB (smallest instance)
- Increase if needed: `fly scale memory 512`
- Update `fly.toml` to match

## Notes for LLM Agents

- **Keep it simple**: Server should remain stateless message router
- **Client-side is king**: All game logic runs in browser
- **No database**: This is a real-time only game with no persistence
- **CDN dependencies**: Don't bundle frontend libs - they're loaded from CDN
- **Small instance**: Optimize for 256MB memory limit
- **Auto-scaling**: Code should handle cold starts gracefully
