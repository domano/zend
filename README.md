# Multiplayer Sand Game

A multiplayer 2D pixel sand simulation game where players can place sand particles in a shared canvas. Built with Phaser.js, Matter.js, and Socket.IO.

## Tech Stack

- **Frontend**: Phaser.js (Canvas/WebGL), Matter.js (Physics)
- **Backend**: Node.js, Express, Socket.IO
- **Hosting**: Fly.io

## Local Development

### Prerequisites

- Node.js 18+ installed
- npm or yarn

### Setup

1. Install dependencies:
```bash
cd server
npm install
```

2. Start the server:
```bash
npm start
```

3. Open your browser to `http://localhost:3000`

### Development Mode

The server will serve the static files and handle WebSocket connections. The game runs entirely in the browser using client-side physics.

## Deployment to Fly.io

### Initial Setup

1. Install Fly.io CLI if you haven't already:
```bash
curl -L https://fly.io/install.sh | sh
```

2. Login to Fly.io:
```bash
fly auth login
```

3. Launch the app (from project root):
```bash
fly launch
```

Follow the prompts to:
- Create a new app or use an existing one
- Select a region (e.g., `iad` for US East)
- Set up Postgres if needed (not required for this game)
- Deploy immediately

The `fly.toml` file is pre-configured with:
- Internal port: 3000
- Health checks
- Auto-scaling (starts/stops machines based on traffic)

### Deploy Updates

After making changes, deploy with:
```bash
fly deploy
```

### View Logs

```bash
fly logs
```

### Open App

```bash
fly open
```

## How It Works

- **Physics**: Matter.js handles all physics calculations client-side
- **Multiplayer**: Socket.IO syncs player actions (sand placement) across all connected clients
- **Performance**: Each client manages up to 500 particles, with automatic cleanup of out-of-bounds particles

## Game Controls

- **Click/Drag**: Place sand particles at cursor position
- Particles fall with gravity and interact with boundaries

## File Structure

```
/
├── index.html          # Main HTML page
├── game.js             # Phaser + Matter.js game logic
├── server/
│   ├── server.js       # Express + Socket.IO server
│   └── package.json    # Backend dependencies
├── public/             # Static assets (optional)
├── Dockerfile            # Docker config for Fly.io
└── fly.toml          # Fly.io deployment config
```

