// Phaser + Matter.js Sand Game

// Calculate responsive dimensions
function getGameDimensions() {
    const BASE_WIDTH = 800;
    const BASE_HEIGHT = 600;
    const ASPECT_RATIO = BASE_WIDTH / BASE_HEIGHT;
    
    // Get viewport dimensions (accounting for UI space)
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    
    // Reserve space for UI (top and bottom bars)
    const uiTopSpace = window.innerWidth <= 768 ? 120 : 80;
    const uiBottomSpace = window.innerWidth <= 768 ? 100 : 60;
    const availableHeight = vh - uiTopSpace - uiBottomSpace;
    const availableWidth = vw - 40; // 20px padding on each side
    
    // Calculate dimensions maintaining aspect ratio
    let gameWidth = availableWidth;
    let gameHeight = gameWidth / ASPECT_RATIO;
    
    // If height is too large, scale by height instead
    if (gameHeight > availableHeight) {
        gameHeight = availableHeight;
        gameWidth = gameHeight * ASPECT_RATIO;
    }
    
    // On desktop, scale up if screen is larger than base size
    if (window.innerWidth > 1200 && gameWidth > BASE_WIDTH) {
        // Allow scaling up on large screens
        gameWidth = Math.min(gameWidth, BASE_WIDTH * 1.5);
        gameHeight = gameWidth / ASPECT_RATIO;
    } else {
        // Limit to base size on smaller screens
        gameWidth = Math.min(gameWidth, BASE_WIDTH);
        gameHeight = Math.min(gameHeight, BASE_HEIGHT);
    }
    
    // Ensure minimum size
    gameWidth = Math.max(gameWidth, 320);
    gameHeight = Math.max(gameHeight, 240);
    
    return {
        width: Math.floor(gameWidth),
        height: Math.floor(gameHeight)
    };
}

let gameDimensions = getGameDimensions();

const config = {
    type: Phaser.AUTO,
    width: gameDimensions.width,
    height: gameDimensions.height,
    parent: 'game-container',
    backgroundColor: '#2c3e50',
    physics: {
        default: 'matter',
        matter: {
            gravity: { y: 0.8 },
            debug: false,
            enableSleeping: true
        }
    },
    scene: {
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);
let matterEngine;
let particles = [];
let socket;
let currentScene = null;
let pendingSyncData = null;
const PARTICLE_RADIUS = 3;
const PARTICLE_COLOR = 0xf39c12; // Orange sand color (legacy default)
let particleTextureKey = 'sandParticleTexture'; // Key for the reusable texture

// Material System
const MATERIALS = {
    SAND: {
        id: 'SAND',
        name: 'Sand',
        color: 0xf39c12, // Orange
        density: 0.0016, // Heavier, sinks in water
        friction: 0.5,
        restitution: 0.3,
        physics: {
            // Sand falls normally
        },
        reactions: {
            // Sand is neutral, no reactions
        }
    },
    WATER: {
        id: 'WATER',
        name: 'Water',
        color: 0x3498db, // Blue
        density: 0.001, // Standard water density
        friction: 0.1, // Low friction = flows easier
        restitution: 0.1, // Water doesn't bounce
        physics: {
            // Water flows faster
        },
        reactions: {
            FIRE: 'EXTINGUISH', // Water + Fire = water puts out fire
            ICE: 'FREEZE', // Water + Ice = water freezes to ice
            LAVA: 'SOLIDIFY', // Water + Lava = lava solidifies to stone
            GAS: 'FOAMIFY',
            PLASMA: 'STEAM',
            GLOW_GLASS: 'SHIMMER'
        },
        viscosity: 0.1 // Flows freely
    },
    FIRE: {
        id: 'FIRE',
        name: 'Fire',
        color: 0xe74c3c, // Red
        density: 0.0001, // Very light = rises quickly
        friction: 0.02,
        restitution: 0.4,
        physics: {
            // Fire rises (negative gravity effect)
            gravityScale: -0.8 // Strong upward force
        },
        reactions: {
            WATER: 'EXTINGUISH', // Fire + Water = water puts out fire
            ICE: 'MELT', // Fire + Ice = ice melts to water
            OIL: 'IGNITE', // Fire + Oil = oil ignites (spreads)
            WOOD: 'BURN', // Fire + Wood = wood burns
            GAS: 'EXPLODE', // Fire + Gas = explosion
            SAND: 'GLASSIFY', // Fire + Sand = glass
            GLASS: 'ENERGIZE',
            CRYSTAL: 'ENERGIZE',
            FOAM: 'EVAPORATE'
        },
        spreadReactions: {
            OIL: 'IGNITE', // Fire spreads to nearby oil
            WOOD: 'BURN', // Fire spreads to nearby wood
            GAS: 'EXPLODE' // Fire spreads to nearby gas (explodes)
        },
        heatOutput: 15, // Fire outputs heat to nearby materials
        ignitionThreshold: 0, // Fire doesn't need to ignite
        heatRate: 0
    },
    ACID: {
        id: 'ACID',
        name: 'Acid',
        color: 0x2ecc71, // Green
        density: 0.0008,
        friction: 0.15,
        restitution: 0.25,
        physics: {
            // Acid flows moderately
        },
        reactions: {
            STONE: 'CORRODE', // Acid + Stone = stone dissolves slowly
            METAL: 'CORRODE', // Acid + Metal = metal corrodes
            WOOD: 'CORRODE', // Acid + Wood = wood dissolves
            ICE: 'CORRODE', // Acid + Ice = ice melts
            OIL: 'DISSOLVE', // Acid + Oil = oil disappears, acid remains
            LAVA: 'SEPARATE' // Acid + Lava = acid evaporates
        },
        viscosity: 0.15 // Flows like water
    },
    ICE: {
        id: 'ICE',
        name: 'Ice',
        color: 0x87ceeb, // Sky blue/light blue
        density: 0.0009, // Slightly lighter than water
        friction: 0.6,
        restitution: 0.3,
        physics: {
            // Ice falls normally
        },
        reactions: {
            WATER: 'FREEZE', // Ice + Water = water freezes to ice
            FIRE: 'MELT', // Ice + Fire = ice melts to water
            LAVA: 'MELT', // Ice + Lava = ice melts, cools lava
            STEAM: 'CONDENSE', // Ice + Steam = steam condenses to water
            ACID: 'CORRODE' // Ice + Acid = ice melts
        }
    },
    OIL: {
        id: 'OIL',
        name: 'Oil',
        color: 0x1a1a1a, // Dark gray/black
        density: 0.0008, // Floats on water
        friction: 0.05, // Very low friction, flows fast
        restitution: 0.1, // Oil doesn't bounce
        physics: {
            // Oil flows fast
        },
        reactions: {
            FIRE: 'IGNITE', // Oil + Fire = oil converts to fire
            ACID: 'DISSOLVE', // Oil + Acid = oil disappears, acid remains
            WATER: 'SEPARATE' // Oil + Water = separate (oil floats)
        },
        viscosity: 0.3, // Flows slower than water
        ignitionThreshold: 50, // Oil ignites easily
        heatRate: 4 // Heats up quickly
    },
    STEAM: {
        id: 'STEAM',
        name: 'Steam',
        color: 0xe0e0e0, // Light gray/white
        density: 0.00005, // Very light, rises quickly
        friction: 0.01,
        restitution: 0.3,
        physics: {
            // Steam rises (negative gravity effect like fire)
            gravityScale: -0.7 // Strong upward force
        },
        reactions: {
            ICE: 'CONDENSE', // Steam + Ice = steam condenses to water
            METAL: 'CONDENSE', // Steam + Metal = steam condenses on cold metal
            GLASS: 'CRYSTALLIZE'
        }
    },
    LAVA: {
        id: 'LAVA',
        name: 'Lava',
        color: 0xff4500, // Orange-red
        density: 0.0015, // Heavier than sand
        friction: 0.4,
        restitution: 0.2,
        physics: {
            // Lava flows slowly, very viscous
        },
        reactions: {
            WATER: 'SOLIDIFY', // Lava + Water = lava solidifies to stone
            ICE: 'SOLIDIFY', // Lava + Ice = lava solidifies to stone, ice melts
            GLASS: 'MELT_GLASS', // Lava + Glass = glass melts
            METAL: 'PLASMAFY', // Lava + Metal = plasma burst
            SAND: 'GLASSIFY'
        },
        viscosity: 0.6, // Very viscous, flows slowly
        ignitionThreshold: 100, // Lava is already hot
        heatOutput: 15, // Lava heats nearby materials
        heatRate: 5 // Heats nearby materials quickly
    },
    WOOD: {
        id: 'WOOD',
        name: 'Wood',
        color: 0x8b4513, // Brown
        density: 0.0007, // Medium density, floats on water
        friction: 0.4,
        restitution: 0.3,
        physics: {
            // Wood falls normally
        },
        reactions: {
            FIRE: 'BURN', // Wood + Fire = wood burns to fire and creates smoke
            ACID: 'CORRODE', // Wood + Acid = wood disappears, acid remains
            WATER: 'SEPARATE' // Wood + Water = separate (floats)
        },
        ignitionThreshold: 60, // Wood ignites relatively easily
        heatRate: 3 // Heats up at moderate rate
    },
    STONE: {
        id: 'STONE',
        name: 'Stone',
        color: 0x708090, // Gray
        density: 0.0025, // Very heavy
        friction: 0.7,
        restitution: 0.4, // Stones bounce more
        physics: {
            // Stone falls and is heavy
        },
        reactions: {
            LAVA: 'SEPARATE', // Stone + Lava = separate (stone sinks, can melt slowly)
            ACID: 'CORRODE' // Stone + Acid = acid dissolves stone slowly
        },
        ignitionThreshold: 200, // Stone doesn't ignite (fire-resistant)
        heatRate: 0.1 // Very slow to heat up
    },
    GAS: {
        id: 'GAS',
        name: 'Gas',
        color: 0xffff00, // Yellow
        density: 0.00003, // Very light, rises quickly
        friction: 0.01,
        restitution: 0.5,
        physics: {
            // Gas rises (negative gravity effect)
            gravityScale: -0.9 // Very strong upward force
        },
        reactions: {
            FIRE: 'EXPLODE', // Gas + Fire = big explosion, spreads fire widely
            STEAM: 'SEPARATE', // Gas + Steam = separate (both rise)
            WATER: 'FOAMIFY',
            GLOW_GLASS: 'SHIMMER'
        },
        ignitionThreshold: 20, // Gas ignites very easily
        heatRate: 10 // Heats up very quickly
    },
    METAL: {
        id: 'METAL',
        name: 'Metal',
        color: 0xc0c0c0, // Silver
        density: 0.003, // Heaviest common material
        friction: 0.6,
        restitution: 0.5, // Metal bounces well
        physics: {
            // Metal falls quickly
        },
        reactions: {
            LAVA: 'PLASMAFY', // Metal + Lava = plasma burst
            ACID: 'CORRODE', // Metal + Acid = metal corrodes
            WATER: 'OXIDIZE', // Metal + Water = slow corrosion (small chance)
            STEAM: 'CONDENSE' // Metal + Steam = steam condenses on metal
        },
        ignitionThreshold: 150, // Metal doesn't burn but can melt
        heatRate: 2, // Conducts heat (spreads heat to nearby materials faster)
        heatConductor: true // Metal conducts heat to nearby materials
    },
    SMOKE: {
        id: 'SMOKE',
        name: 'Smoke',
        color: 0x404040, // Dark gray
        density: 0.00004, // Very light, rises
        friction: 0.01,
        restitution: 0.3,
        physics: {
            // Smoke rises (negative gravity effect)
            gravityScale: -0.6 // Moderate upward force
        },
        reactions: {
            WATER: 'SEPARATE', // Smoke + Water = separate (smoke rises)
            STEAM: 'SEPARATE' // Smoke + Steam = separate (both rise)
        },
        ignitionThreshold: 1000, // Smoke doesn't ignite
        heatRate: -1 // Smoke actually cools things slightly
    },
    GLASS: {
        id: 'GLASS',
        name: 'Glass',
        color: 0xadd8e6, // Light blue/transparent-looking
        density: 0.0012, // Medium density
        friction: 0.3,
        restitution: 0.6, // Glass is very bouncy before breaking
        physics: {
            // Glass falls normally
        },
        reactions: {
            ACID: 'SEPARATE', // Glass + Acid = separate (glass is acid-resistant)
            LAVA: 'MELT_GLASS', // Glass + Lava = glass melts
            STONE: 'IMPACT_SHATTER', // Glass + Stone = glass shatters from high impact
            METAL: 'IMPACT_SHATTER', // Glass + Metal = glass shatters from high impact
            STEAM: 'CRYSTALLIZE', // Glass + Steam = energised crystal structures
            FIRE: 'ENERGIZE' // Fire + Glass = energises glass toward glow state
        },
        ignitionThreshold: 200, // Glass doesn't burn
        heatRate: 0.5, // Slow to heat up
        impactShatterThreshold: 3.0 // Minimum impact velocity to shatter
    },
    GLOW_GLASS: {
        id: 'GLOW_GLASS',
        name: 'Glow Glass',
        color: 0xfff3a5, // Warm golden glow
        density: 0.001,
        friction: 0.25,
        restitution: 0.7,
        physics: {
            // Slightly lighter, gentle float
        },
        reactions: {
            WATER: 'SHIMMER', // Water cools glow glass making shimmer particles
            FIRE: 'PLASMAFY', // Extreme heat can turn glow glass into plasma
            LAVA: 'PLASMAFY'
        },
        heatOutput: 4,
        heatRate: 2,
        lightEmission: 0.8,
        ignitionThreshold: 60
    },
    CRYSTAL: {
        id: 'CRYSTAL',
        name: 'Crystal',
        color: 0xb39ddb, // Soft violet crystal color
        density: 0.0014,
        friction: 0.45,
        restitution: 0.8,
        physics: {
            // Crystal shards bounce and shimmer
        },
        reactions: {
            FIRE: 'ENERGIZE',
            LAVA: 'ENERGIZE',
            ACID: 'DISSOLVE'
        },
        ignitionThreshold: 140,
        heatRate: 1,
        shatterThreshold: 4.5
    },
    PLASMA: {
        id: 'PLASMA',
        name: 'Plasma',
        color: 0xff66ff, // Neon pink/purple
        density: 0.00002,
        friction: 0.01,
        restitution: 0.9,
        physics: {
            gravityScale: -0.95 // Plasma rises aggressively
        },
        reactions: {
            WATER: 'STEAM',
            GAS: 'EXPLODE',
            METAL: 'ENERGIZE',
            STEAM: 'AURORA_EVENT'
        },
        heatOutput: 20,
        heatRate: 8,
        ignitionThreshold: 0
    },
    FOAM: {
        id: 'FOAM',
        name: 'Foam',
        color: 0xe8f6ff,
        density: 0.0004,
        friction: 0.08,
        restitution: 0.2,
        physics: {
            gravityScale: -0.1
        },
        reactions: {
            FIRE: 'EVAPORATE',
            ACID: 'DISSOLVE',
            LAVA: 'EVAPORATE'
        },
        viscosity: 0.05,
        ignitionThreshold: 25,
        heatRate: 2
    },
    AURORA: {
        id: 'AURORA',
        name: 'Aurora',
        color: 0xb38bff,
        density: 0.00005,
        friction: 0.03,
        restitution: 0.85,
        physics: {
            gravityScale: -0.75
        },
        reactions: {
            WATER: 'SHIMMER',
            STEAM: 'SHIMMER',
            GAS: 'SHIMMER',
            PLASMA: 'ENERGIZE'
        },
        heatOutput: 10,
        heatRate: 6,
        lightEmission: 1,
        ignitionThreshold: 0,
        eventMaterial: true
    }
};

const MATERIAL_METADATA = {
    SAND: { order: 10, shortcut: '1', tier: 'base' },
    WATER: { order: 20, shortcut: '2', tier: 'base' },
    FIRE: { order: 30, shortcut: '3', tier: 'base' },
    ACID: { order: 40, shortcut: '4', tier: 'base' },
    ICE: { order: 50, shortcut: '5', tier: 'base' },
    OIL: { order: 60, shortcut: '6', tier: 'base' },
    STEAM: { order: 70, shortcut: '7', tier: 'base' },
    LAVA: { order: 80, shortcut: '8', tier: 'base' },
    WOOD: { order: 90, shortcut: 'Q', tier: 'base' },
    STONE: { order: 100, shortcut: 'W', tier: 'base' },
    GAS: { order: 110, shortcut: 'E', tier: 'base' },
    METAL: { order: 120, shortcut: 'R', tier: 'base' },
    SMOKE: { order: 130, shortcut: 'T', tier: 'base' },
    GLASS: { order: 140, shortcut: 'Y', tier: 'base' },
    GLOW_GLASS: { order: 210, shortcut: 'U', tier: 'advanced', unlockReaction: 'GLASSIFY', unlockThreshold: 3 },
    CRYSTAL: { order: 220, shortcut: 'I', tier: 'advanced', unlockReaction: 'CRYSTALLIZE', unlockThreshold: 4 },
    PLASMA: { order: 230, shortcut: 'O', tier: 'advanced', unlockReaction: 'PLASMAFY', unlockThreshold: 2 },
    FOAM: { order: 240, shortcut: 'P', tier: 'advanced', unlockReaction: 'FOAMIFY', unlockThreshold: 5 },
    AURORA: { order: 250, shortcut: 'J', tier: 'event', unlockReaction: 'AURORA_EVENT', unlockThreshold: 1, eventDuration: 120000 }
};

const BASE_MATERIALS = Object.entries(MATERIAL_METADATA)
    .filter(([, meta]) => meta.tier === 'base')
    .map(([id]) => id);

let unlockedMaterials = new Set(BASE_MATERIALS);
let materialUnlockCounters = {};
let materialUnlockExpiry = {};
let materialUnlockTimeouts = {};
let eventTimerInterval = null;

const REACTION_UNLOCKS = {
    GLASSIFY: ['GLOW_GLASS'],
    CRYSTALLIZE: ['CRYSTAL'],
    PLASMAFY: ['PLASMA'],
    FOAMIFY: ['FOAM'],
    AURORA_EVENT: ['AURORA']
};

const COMMUNITY_GOALS = [
    { id: 'steam_burst', label: 'Trigger 10 Steam reactions', reaction: 'STEAM', target: 10 },
    { id: 'glassworks', label: 'Perform 6 Glassify reactions', reaction: 'GLASSIFY', target: 6 },
    { id: 'foam_party', label: 'Whip up 8 Foamify reactions', reaction: 'FOAMIFY', target: 8 },
    { id: 'plasma_show', label: 'Ignite 4 Plasmafy reactions', reaction: 'PLASMAFY', target: 4 },
    { id: 'aurora_dance', label: 'Summon 3 Aurora events', reaction: 'AURORA_EVENT', target: 3 }
];

let communityProgress = COMMUNITY_GOALS.reduce((acc, goal) => {
    acc[goal.id] = 0;
    return acc;
}, {});

function adjustColor(colorInt, percent) {
    const r = (colorInt >> 16) & 0xff;
    const g = (colorInt >> 8) & 0xff;
    const b = colorInt & 0xff;
    const factor = Math.min(1, Math.max(-1, percent));
    const adjust = (channel) => {
        if (factor >= 0) {
            return Math.min(255, Math.round(channel + (255 - channel) * factor));
        }
        return Math.max(0, Math.round(channel + channel * factor));
    };
    return (adjust(r) << 16) | (adjust(g) << 8) | adjust(b);
}

function colorToCss(colorInt, alpha = 1) {
    const r = (colorInt >> 16) & 0xff;
    const g = (colorInt >> 8) & 0xff;
    const b = colorInt & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Current selected material (default to SAND)
let currentMaterial = MATERIALS.SAND.id;

// Creative tool state
let currentTool = 'brush';
let brushSize = 8;
let isPointerDown = false;
let pointerStart = null;
let lastBrushPoint = null;
let pointerLatest = null;

const TOOL_SHORTCUTS = {
    B: 'brush',
    L: 'line',
    C: 'circle',
    V: 'rectangle',
    F: 'fan',
    D: 'dropper'
};

// Reaction FX systems
let effectManagers = {};
let effectEmitters = {};
let effectTexturesReady = false;
let reactionAudioContext = null;

// Reaction tracking
let recentReactions = [];

// Unlock notification pulse timer
let unlockPulseTimers = {};

const EFFECT_TEXTURE_SPECS = {
    spark: { key: 'fx_spark', inner: 0xfff3a5, outer: 0xff7b47, radius: 18 },
    smoke: { key: 'fx_smoke', inner: 0x666666, outer: 0x222222, radius: 24 },
    steam: { key: 'fx_steam', inner: 0xffffff, outer: 0xcce6ff, radius: 22 },
    foam: { key: 'fx_foam', inner: 0xffffff, outer: 0xaee6ff, radius: 20 },
    plasma: { key: 'fx_plasma', inner: 0xffb7ff, outer: 0x8e44ad, radius: 26 },
    crystal: { key: 'fx_crystal', inner: 0xdcd6ff, outer: 0x6c5ce7, radius: 24 },
    shimmer: { key: 'fx_shimmer', inner: 0xffffd2, outer: 0xf5a623, radius: 16 },
    aurora: { key: 'fx_aurora', inner: 0xcdb5ff, outer: 0x3ad6ff, radius: 30 }
};

const EFFECT_EMITTER_CONFIGS = {
    spark: {
        texture: 'fx_spark',
        settings: {
            speed: { min: 70, max: 220 },
            scale: { start: 0.35, end: 0 },
            alpha: { start: 0.9, end: 0 },
            lifespan: { min: 250, max: 450 },
            angle: { min: 0, max: 360 },
            gravityY: 80
        }
    },
    smoke: {
        texture: 'fx_smoke',
        settings: {
            speed: { min: 15, max: 40 },
            scale: { start: 0.45, end: 0.9 },
            alpha: { start: 0.6, end: 0 },
            lifespan: { min: 600, max: 900 },
            angle: { min: 0, max: 360 },
            gravityY: -20
        }
    },
    steam: {
        texture: 'fx_steam',
        settings: {
            speed: { min: 25, max: 60 },
            scale: { start: 0.5, end: 1 },
            alpha: { start: 0.55, end: 0 },
            lifespan: { min: 400, max: 700 },
            gravityY: -60
        }
    },
    foam: {
        texture: 'fx_foam',
        settings: {
            speed: { min: 15, max: 35 },
            scale: { start: 0.35, end: 0 },
            alpha: { start: 0.8, end: 0 },
            lifespan: { min: 450, max: 650 },
            gravityY: -25
        }
    },
    plasma: {
        texture: 'fx_plasma',
        settings: {
            speed: { min: 120, max: 260 },
            scale: { start: 0.55, end: 0.15 },
            alpha: { start: 0.95, end: 0 },
            lifespan: { min: 300, max: 500 },
            angle: { min: 0, max: 360 },
            gravityY: -120,
            blendMode: Phaser.BlendModes.ADD
        }
    },
    crystal: {
        texture: 'fx_crystal',
        settings: {
            speed: { min: 40, max: 120 },
            scale: { start: 0.45, end: 0.1 },
            alpha: { start: 0.9, end: 0 },
            lifespan: { min: 500, max: 800 },
            angle: { min: -30, max: 30 },
            gravityY: 30
        }
    },
    shimmer: {
        texture: 'fx_shimmer',
        settings: {
            speed: { min: 20, max: 60 },
            scale: { start: 0.6, end: 0 },
            alpha: { start: 0.85, end: 0 },
            lifespan: { min: 350, max: 520 },
            angle: { min: 0, max: 360 },
            gravityY: -10,
            blendMode: Phaser.BlendModes.ADD
        }
    },
    aurora: {
        texture: 'fx_aurora',
        settings: {
            speed: { min: 40, max: 120 },
            scale: { start: 0.75, end: 0.2 },
            alpha: { start: 0.9, end: 0 },
            lifespan: { min: 600, max: 900 },
            angle: { min: -30, max: 30 },
            gravityY: -40,
            blendMode: Phaser.BlendModes.ADD
        }
    }
};

// Store original game dimensions for boundary calculations
let gameWidth = gameDimensions.width;
let gameHeight = gameDimensions.height;

// Client-side batching for sand placement
let sandPlacementBuffer = [];
const BATCH_SIZE = 50;
const BATCH_INTERVAL = 100; // ms
let batchTimer = null;

// Chunked sync state
let syncChunks = [];
let syncTotalChunks = 0;
let syncReceivedChunks = 0;
let isReceivingSync = false;

// Batch particle creation queue
let particleCreationQueue = [];
let isCreatingParticles = false;
const PARTICLES_PER_FRAME = 50; // Create particles in batches to avoid frame drops

// Connect to Socket.IO server
const serverUrl = window.location.origin;
socket = io(serverUrl);

socket.on('connect', () => {
    console.log('Connected to server');
    updateConnectionStatus(true);
});

socket.on('disconnect', () => {
    // Flush any pending batches before disconnect
    flushSandBatch();
    updateConnectionStatus(false);
});

socket.on('sandPlaced', (data) => {
    // Create sand particle from another player (legacy single particle)
    if (currentScene) {
        const materialId = data.materialType || 'SAND';
        const material = MATERIALS[materialId] || MATERIALS.SAND;
        createParticle(data.x, data.y, material.id);
    }
});

socket.on('sandBatch', (batch) => {
    // Handle batch of particles from server
    if (currentScene && Array.isArray(batch)) {
        batch.forEach(particle => {
            const materialId = particle.materialType || 'SAND';
            const material = MATERIALS[materialId] || MATERIALS.SAND;
            createParticle(particle.x, particle.y, material.id);
        });
    }
});

socket.on('syncSand', (particles) => {
    // Legacy sync - handle as single chunk
    // Store sync data if scene isn't ready yet, otherwise apply immediately
    if (currentScene) {
        particles.forEach(particle => {
            const materialId = particle.materialType || 'SAND';
            const material = MATERIALS[materialId] || MATERIALS.SAND;
            createParticle(particle.x, particle.y, material.id);
        });
    } else {
        pendingSyncData = particles;
    }
});

socket.on('syncSandChunk', (data) => {
    // Handle chunked sync
    if (!data.chunk || !Array.isArray(data.chunk)) {
        return;
    }
    
    // Initialize sync if first chunk
    if (data.chunkIndex === 0) {
        syncChunks = [];
        syncTotalChunks = data.totalChunks || 1;
        syncReceivedChunks = 0;
        isReceivingSync = true;
    }
    
    // Store chunk
    syncChunks[data.chunkIndex] = data.chunk;
    syncReceivedChunks++;
    
    // If this is the last chunk, process all chunks
    if (data.isLast || syncReceivedChunks >= syncTotalChunks) {
        isReceivingSync = false;
        
        // Flatten all chunks into single array
        const allParticles = [];
        for (let i = 0; i < syncChunks.length; i++) {
            if (syncChunks[i]) {
                allParticles.push(...syncChunks[i]);
            }
        }
        
        // Queue particles for batch creation
        if (currentScene) {
            queueParticlesForCreation(allParticles);
        } else {
            // Store for when scene is ready
            pendingSyncData = allParticles;
        }
        
        // Reset sync state
        syncChunks = [];
        syncTotalChunks = 0;
        syncReceivedChunks = 0;
    }
});

socket.on('worldReset', () => {
    // Clear all particles from the scene
    console.log('Resetting world state');
    resetWorldState();
});

function queueParticlesForCreation(particles) {
    // Add particles to creation queue
    particles.forEach(particle => {
        particleCreationQueue.push({
            x: particle.x,
            y: particle.y,
            materialType: particle.materialType || 'SAND'
        });
    });
    
    // Start creation process if not already running
    if (!isCreatingParticles && particleCreationQueue.length > 0) {
        createParticlesBatch();
    }
}

function createParticlesBatch() {
    if (!currentScene || particleCreationQueue.length === 0) {
        isCreatingParticles = false;
        return;
    }
    
    isCreatingParticles = true;
    const count = Math.min(PARTICLES_PER_FRAME, particleCreationQueue.length);
    
    // Create batch of particles
    for (let i = 0; i < count; i++) {
        const particle = particleCreationQueue.shift();
        if (particle) {
            createParticle(particle.x, particle.y, particle.materialType || 'SAND');
        }
    }
    
    // Schedule next batch if queue not empty
    if (particleCreationQueue.length > 0) {
        requestAnimationFrame(createParticlesBatch);
    } else {
        isCreatingParticles = false;
    }
}

// Create particle texture for a specific material
function createParticleTexture(scene, materialId) {
    const material = MATERIALS[materialId] || MATERIALS.SAND;
    const textureKey = `particleTexture_${materialId}`;
    
    // Check if texture already exists
    if (scene.textures.exists(textureKey)) {
        return textureKey;
    }

    const textureSize = Math.max(28, PARTICLE_RADIUS * 6);
    if (scene.textures.exists(textureKey)) {
        scene.textures.remove(textureKey);
    }

    const canvasTexture = scene.textures.createCanvas(textureKey, textureSize, textureSize);
    const ctx = canvasTexture.context;
    const center = textureSize / 2;
    ctx.clearRect(0, 0, textureSize, textureSize);

    const innerColor = adjustColor(material.color, 0.25);
    const midColor = material.color;
    const outerColor = adjustColor(material.color, -0.3);

    const gradient = ctx.createRadialGradient(center, center, textureSize * 0.08, center, center, center);
    gradient.addColorStop(0, colorToCss(innerColor, 1));
    gradient.addColorStop(0.55, colorToCss(midColor, 0.95));
    gradient.addColorStop(1, colorToCss(outerColor, 0.6));

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, center - 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Rim lighting
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = colorToCss(adjustColor(material.color, 0.35), 0.4);
    ctx.beginPath();
    ctx.arc(center, center, center - 2.5, 0, Math.PI * 2);
    ctx.stroke();

    // Noise sparkle / bubbles
    const sparkleCount = material.lightEmission ? 8 : 4;
    for (let i = 0; i < sparkleCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (center - 4);
        const px = center + Math.cos(angle) * radius;
        const py = center + Math.sin(angle) * radius;
        const sparkleRadius = material.viscosity ? 1.2 + Math.random() * 0.8 : 1 + Math.random() * 0.6;
        const sparkleGradient = ctx.createRadialGradient(px, py, 0, px, py, sparkleRadius);
        sparkleGradient.addColorStop(0, colorToCss(adjustColor(material.color, 0.5), material.lightEmission ? 0.95 : 0.8));
        sparkleGradient.addColorStop(0.7, colorToCss(adjustColor(material.color, 0.2), material.lightEmission ? 0.4 : 0.3));
        sparkleGradient.addColorStop(1, colorToCss(adjustColor(material.color, -0.4), 0));
        ctx.fillStyle = sparkleGradient;
        ctx.beginPath();
        ctx.arc(px, py, sparkleRadius, 0, Math.PI * 2);
        ctx.fill();
    }

    // Add subtle directional streaks for flowing materials
    if (material.viscosity !== undefined) {
        ctx.strokeStyle = colorToCss(adjustColor(material.color, -0.15), 0.15);
        ctx.lineWidth = 1;
        const streaks = Math.max(2, Math.round(4 - material.viscosity * 8));
        for (let s = 0; s < streaks; s++) {
            const angle = Math.random() * Math.PI * 2;
            const startRadius = center * 0.1;
            const endRadius = center * (0.4 + Math.random() * 0.5);
            ctx.beginPath();
            ctx.moveTo(center + Math.cos(angle) * startRadius, center + Math.sin(angle) * startRadius);
            ctx.lineTo(center + Math.cos(angle) * endRadius, center + Math.sin(angle) * endRadius);
            ctx.stroke();
        }
    }

    // Heat glow overlay for high temperature materials
    if (material.heatOutput || material.heatRate > 4) {
        const glowGradient = ctx.createRadialGradient(center, center, center * 0.2, center, center, center);
        glowGradient.addColorStop(0, colorToCss(adjustColor(material.color, 0.6), 0.4));
        glowGradient.addColorStop(1, colorToCss(adjustColor(material.color, 0.2), 0));
        ctx.fillStyle = glowGradient;
        ctx.beginPath();
        ctx.arc(center, center, center - 1, 0, Math.PI * 2);
        ctx.fill();
    }

    if (material.eventMaterial) {
        for (let b = 0; b < 3; b++) {
            const angle = (Math.PI * 2 / 3) * b + Math.random() * 0.35;
            const gradient = ctx.createLinearGradient(
                center + Math.cos(angle) * center,
                center + Math.sin(angle) * center,
                center - Math.cos(angle) * center,
                center - Math.sin(angle) * center
            );
            gradient.addColorStop(0, 'rgba(58, 214, 255, 0)');
            gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.35)');
            gradient.addColorStop(1, 'rgba(58, 214, 255, 0)');
            ctx.strokeStyle = gradient;
            ctx.lineWidth = 1.5 + Math.random();
            ctx.beginPath();
            ctx.arc(center, center, center - 3, angle - 0.7, angle + 0.7);
            ctx.stroke();
        }
    }

    canvasTexture.refresh();
    return textureKey;
}

function ensureEffectSystems(scene) {
    if (!scene) {
        return;
    }
    if (!effectTexturesReady) {
        Object.values(EFFECT_TEXTURE_SPECS).forEach(spec => {
            createEffectTexture(scene, spec);
        });
        effectTexturesReady = true;
    }
    Object.entries(EFFECT_EMITTER_CONFIGS).forEach(([key, config]) => {
        if (!effectManagers[key]) {
            effectManagers[key] = scene.add.particles(config.texture);
        }
        if (!effectEmitters[key]) {
            const emitterManager = effectManagers[key];
            let emitter;
            const emitterConfig = {
                ...config.settings,
                on: false
            };
            if (emitterManager.addEmitter) {
                emitter = emitterManager.addEmitter(emitterConfig);
            } else if (emitterManager.emitters && emitterManager.emitters.add) {
                emitter = emitterManager.emitters.add(emitterConfig);
            }
            if (!emitter) {
                console.warn('Unable to create particle emitter for effect', key);
                return;
            }
            effectEmitters[key] = emitter;
        }
    });
}

function createEffectTexture(scene, spec) {
    if (!scene || !spec) {
        return;
    }
    if (scene.textures.exists(spec.key)) {
        scene.textures.remove(spec.key);
    }
    const size = Math.max(16, spec.radius * 2);
    const texture = scene.textures.createCanvas(spec.key, size, size);
    const ctx = texture.context;
    const center = size / 2;
    ctx.clearRect(0, 0, size, size);
    const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, colorToCss(spec.inner, 1));
    gradient.addColorStop(0.6, colorToCss(spec.inner, 0.6));
    gradient.addColorStop(1, colorToCss(spec.outer, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(center, center, center, 0, Math.PI * 2);
    ctx.fill();
    texture.refresh();
}

function getEffectEmitter(effectKey) {
    if (!currentScene) {
        return null;
    }
    ensureEffectSystems(currentScene);
    return effectEmitters[effectKey] || null;
}

function emitEffectBurst(effectKey, quantity, x, y) {
    const emitter = getEffectEmitter(effectKey);
    if (emitter) {
        emitter.explode(quantity, x, y);
    }
}

function create() {
    currentScene = this;
    matterEngine = this.matter.world;
    gameWidth = this.scale.width;
    gameHeight = this.scale.height;
    
    console.log('Scene created, setting up boundaries and input...');
    
    // Create particle textures for all materials
    Object.keys(MATERIALS).forEach(materialId => {
        createParticleTexture(this, materialId);
    });
    console.log('Particle textures created for all materials');

    ensureEffectSystems(this);
    
    // Apply pending sync data if any (queue for batch creation)
    if (pendingSyncData) {
        queueParticlesForCreation(pendingSyncData);
        pendingSyncData = null;
    }
    
    // Create world boundaries with visual representation (scale with game size)
    const boundaryColor = 0x34495e;
    const boundaryWidth = 20;
    
    // Bottom boundary
    const bottomGraphics = this.add.graphics();
    bottomGraphics.fillStyle(boundaryColor, 1);
    bottomGraphics.fillRect(-gameWidth/2, -10, gameWidth, boundaryWidth);
    bottomGraphics.x = gameWidth / 2;
    bottomGraphics.y = gameHeight;
    this.matter.add.gameObject(bottomGraphics);
    bottomGraphics.setRectangle(gameWidth, boundaryWidth, { isStatic: true });
    
    // Left boundary
    const leftGraphics = this.add.graphics();
    leftGraphics.fillStyle(boundaryColor, 1);
    leftGraphics.fillRect(-10, -gameHeight/2, boundaryWidth, gameHeight);
    leftGraphics.x = 0;
    leftGraphics.y = gameHeight / 2;
    this.matter.add.gameObject(leftGraphics);
    leftGraphics.setRectangle(boundaryWidth, gameHeight, { isStatic: true });
    
    // Right boundary
    const rightGraphics = this.add.graphics();
    rightGraphics.fillStyle(boundaryColor, 1);
    rightGraphics.fillRect(-10, -gameHeight/2, boundaryWidth, gameHeight);
    rightGraphics.x = gameWidth;
    rightGraphics.y = gameHeight / 2;
    this.matter.add.gameObject(rightGraphics);
    rightGraphics.setRectangle(boundaryWidth, gameHeight, { isStatic: true });
    
    // Top boundary
    const topGraphics = this.add.graphics();
    topGraphics.fillStyle(boundaryColor, 1);
    topGraphics.fillRect(-gameWidth/2, -10, gameWidth, boundaryWidth);
    topGraphics.x = gameWidth / 2;
    topGraphics.y = 0;
    this.matter.add.gameObject(topGraphics);
    topGraphics.setRectangle(gameWidth, boundaryWidth, { isStatic: true });
    
    // Enable input
    this.input.setDefaultCursor('pointer');
    
    // Prevent default touch behaviors on mobile
    this.input.addPointer();
    if (this.input.touch) {
        this.input.touch.preventDefault = true;
    }
    
    // Mouse/touch input with optimized touch handling
    this.input.on('pointerdown', (pointer) => {
        handlePointerDown(pointer);
    });
    
    this.input.on('pointermove', (pointer) => {
        handlePointerMove(pointer);
    });

    this.input.on('pointerup', (pointer) => {
        handlePointerUp(pointer);
    });

    this.input.on('pointerupoutside', (pointer) => {
        handlePointerUp(pointer);
    });
    
    // Keyboard input for reset (Delete or Backspace key)
    this.input.keyboard.on('keydown-DELETE', () => {
        console.log('Reset triggered by Delete key');
        handleReset();
    });
    this.input.keyboard.on('keydown-BACKSPACE', () => {
        console.log('Reset triggered by Backspace key');
        handleReset();
    });
    
    // Keyboard shortcuts for material selection (1-8, Q, W, E, R, T, Y)
    this.input.keyboard.on('keydown', (event) => {
        const key = (event.key || '').toUpperCase();
        if (!key) {
            return;
        }

        if (TOOL_SHORTCUTS[key]) {
            selectTool(TOOL_SHORTCUTS[key]);
            return;
        }

        const entry = Object.entries(MATERIAL_METADATA).find(([, meta]) => meta.shortcut && meta.shortcut.toUpperCase() === key);
        if (entry) {
            selectMaterial(entry[0]);
        }
    });
    
    // Ensure UI handlers are setup (they may have been set up already)
    if (document.getElementById('reset-btn') && !document.getElementById('reset-btn').hasAttribute('data-handler-attached')) {
        setupUIHandlers();
        document.getElementById('reset-btn').setAttribute('data-handler-attached', 'true');
    }
    
    // Cleanup particles that are out of bounds
    this.matter.world.on('afterupdate', () => {
        cleanupParticles(this);
        updateParticleCount();
    });
    
    // Collision detection for chemical reactions
    // Use both collisionStart and collisionActive to catch all collisions
    this.matter.world.on('collisionStart', (event) => {
        if (event && event.pairs && event.pairs.length > 0) {
            handleCollisions(event.pairs);
        }
    });
    
    // Also check active collisions periodically (for more reliable detection)
    this.matter.world.on('collisionActive', (event) => {
        if (event && event.pairs && event.pairs.length > 0) {
            handleCollisions(event.pairs);
        }
    });
    
    // Alternative: use Matter.Engine events directly as backup
    try {
        const engine = this.matter.world.engine;
        if (engine && typeof Matter !== 'undefined' && Matter.Events) {
            Matter.Events.on(engine, 'collisionStart', (event) => {
                if (event && event.pairs && event.pairs.length > 0) {
                    handleCollisions(event.pairs);
                }
            });
        }
    } catch (e) {
        console.log('Could not set up Matter.Engine collision events:', e);
    }
    
    // Proximity-based reaction check as backup (runs periodically)
    this.time.addEvent({
        delay: 100, // Check every 100ms
        callback: checkProximityReactions,
        loop: true
    });
    
    // Heat update system for gradual fire spreading (runs every frame)
    this.time.addEvent({
        delay: 50, // Update heat every 50ms for smoother progression
        callback: updateHeatSystem,
        loop: true
    });
    
    console.log('Scene setup complete');
}

function update() {
    // Sync sprite positions and rotations from Matter.js physics bodies
    // This enables efficient batched rendering while maintaining accurate physics
    for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        if (particle.body && particle.sprite) {
            const body = particle.body;
            const sprite = particle.sprite;
            const material = MATERIALS[particle.materialType] || MATERIALS.SAND;
            
            // Update sprite position from physics body
            sprite.x = body.position.x;
            sprite.y = body.position.y;
            
            // Update sprite rotation from physics body (optional, for visual accuracy)
            sprite.rotation = body.angle;
            
            // Apply special physics (e.g., Fire rises with negative gravity)
            if (material.physics && material.physics.gravityScale !== undefined) {
                // Apply upward force for fire - directly manipulate velocity
                const gravityScale = material.physics.gravityScale;
                // Negative value means upward
                // Directly set velocity for more reliable movement
                const upwardVelocity = gravityScale * 3; // Strong upward velocity
                
                // Direct velocity manipulation works more reliably
                if (body.velocity) {
                    body.velocity.y = Math.min(body.velocity.y, upwardVelocity);
                    // Add slight horizontal drift
                    body.velocity.x += (Math.random() - 0.5) * 0.3;
                }
                
                // Also try applying force if Matter is available
                try {
                    if (typeof Matter !== 'undefined' && Matter.Body && Matter.Body.applyForce) {
                        Matter.Body.applyForce(body, body.position, {
                            x: (Math.random() - 0.5) * 0.02,
                            y: gravityScale * 0.3 // Strong upward force
                        });
                    }
                } catch (e) {
                    // Fallback to velocity only
                }
            }
            
            // Liquid spreading mechanics - very subtle natural spreading
            const isLiquid = material.viscosity !== undefined;
            if (isLiquid && body.velocity) {
                const currentVelocityY = body.velocity.y;
                const previousVelocityY = particle.previousVelocityY || 0;
                const timeSinceCreation = Date.now() - (particle.creationTime || 0);
                
                // Detect strong impact for splash effects only
                const velocityDecrease = previousVelocityY - currentVelocityY;
                const hasStrongImpact = previousVelocityY > 8 && velocityDecrease > 5;
                
                // Create splash effect for high-velocity impacts only (visual effect, no force)
                if (hasStrongImpact && timeSinceCreation > 100 && Math.random() < 0.03) {
                    createSplashEffect(body.position.x, body.position.y, particle.materialType);
                }
                
                // Store current velocity for next frame
                particle.previousVelocityY = currentVelocityY;
                
                // Apply viscosity damping to horizontal movement
                if (body.velocity && material.viscosity > 0.15) {
                    body.velocity.x *= (1 - material.viscosity * 0.01);
                }
            }
            
            // Density-based buoyancy forces
            // Check nearby particles for density differences
            if (i % 3 === 0) { // Only check every 3rd particle per frame for performance
                const BUOYANCY_RADIUS = 15;
                const nearbyParticles = [];
                
                // Find nearby particles
                for (let j = 0; j < particles.length; j++) {
                    if (i === j || !particles[j].body || !particles[j].body.position) continue;
                    
                    const dx = particles[j].body.position.x - body.position.x;
                    const dy = particles[j].body.position.y - body.position.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    if (distance < BUOYANCY_RADIUS) {
                        nearbyParticles.push(particles[j]);
                    }
                }
                
                // Apply buoyancy based on density differences
                if (nearbyParticles.length > 0) {
                    let densityDifference = 0;
                    nearbyParticles.forEach(nearby => {
                        const nearbyMaterial = MATERIALS[nearby.materialType];
                        if (nearbyMaterial && nearbyMaterial.density) {
                            densityDifference += (nearbyMaterial.density - material.density);
                        }
                    });
                    
                    // Apply buoyancy force if there's a density difference
                    if (Math.abs(densityDifference) > 0.0001) {
                        const buoyancyForce = densityDifference * 0.00005;
                        try {
                            if (typeof Matter !== 'undefined' && Matter.Body && Matter.Body.applyForce) {
                                Matter.Body.applyForce(body, body.position, {
                                    x: 0,
                                    y: -buoyancyForce // Negative = upward
                                });
                            }
                        } catch (e) {
                            // Fallback to velocity
                            if (body.velocity) {
                                body.velocity.y -= buoyancyForce * 100;
                            }
                        }
                    }
                }
            }
        }
    }
}

function placeSand(x, y) {
    return placeMaterialAt(x, y, currentMaterial);
}

function placeMaterialAt(x, y, materialId, options = {}) {
    if (!currentScene) {
        return null;
    }
    const margin = options.margin ?? 25;
    if (!isWithinPlacementBounds(x, y, margin)) {
        return null;
    }

    const targetMaterial = MATERIALS[materialId] || MATERIALS.SAND;
    const particle = createParticle(x, y, targetMaterial.id);

    if (!particle) {
        return null;
    }

    if (options.skipNetwork !== true) {
        queueMaterialForNetwork(x, y, targetMaterial.id);
    }

    return particle;
}

function queueMaterialForNetwork(x, y, materialId) {
    if (!socket || !socket.connected) {
        return;
    }
    const material = MATERIALS[materialId] || MATERIALS.SAND;
    sandPlacementBuffer.push({
        x,
        y,
        materialType: materialId,
        color: material.color
    });

    if (sandPlacementBuffer.length >= BATCH_SIZE) {
        flushSandBatch();
    } else if (!batchTimer) {
        batchTimer = setTimeout(flushSandBatch, BATCH_INTERVAL);
    }
}

function spawnMaterialCluster(points, materialId, options = {}) {
    if (!Array.isArray(points)) {
        return [];
    }
    const created = [];
    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        if (!point) continue;
        const particle = placeMaterialAt(point.x, point.y, materialId, options);
        if (particle) {
            created.push(particle);
        }
    }
    return created;
}

function isWithinPlacementBounds(x, y, margin = 25) {
    return x >= margin && x <= gameWidth - margin && y >= margin && y <= gameHeight - margin;
}

function flushSandBatch() {
    if (sandPlacementBuffer.length === 0 || !socket || !socket.connected) {
        if (batchTimer) {
            clearTimeout(batchTimer);
            batchTimer = null;
        }
        return;
    }
    
    // Send batch with compression
    const batch = [...sandPlacementBuffer];
    sandPlacementBuffer = [];
    
    socket.compress(true).emit('sandBatch', batch);
    
    if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
    }
}

function createParticle(x, y, materialId) {
    if (!currentScene) {
        return null;
    }
    
    const material = MATERIALS[materialId] || MATERIALS.SAND;
    
    // Ensure texture exists
    const textureKey = createParticleTexture(currentScene, materialId);
    if (!currentScene.textures.exists(textureKey)) {
        createParticleTexture(currentScene, materialId);
    }
    
    // Create sprite from texture for efficient batching
    const sprite = currentScene.add.sprite(x, y, textureKey);

    let glowTween = null;
    if (material.lightEmission || material.eventMaterial) {
        sprite.setBlendMode(Phaser.BlendModes.ADD);
        const tweenDuration = 680 + Math.random() * 520;
        glowTween = currentScene.tweens.add({
            targets: sprite,
            alpha: { from: 1, to: 0.55 },
            scale: { from: 1, to: 1.08 },
            duration: tweenDuration,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
            delay: Math.random() * 360
        });
    }
    
    // Create separate Matter.js physics body with material-specific properties
    const bodyOptions = {
        restitution: material.restitution,
        friction: material.friction,
        density: material.density
    };
    
    // Apply special physics for materials like Fire (negative gravity)
    if (material.physics && material.physics.gravityScale !== undefined) {
        // Matter.js doesn't support per-body gravity directly, so we'll handle this in update loop
    }
    
    const body = currentScene.matter.add.circle(x, y, PARTICLE_RADIUS, bodyOptions);
    
    // Disable sleeping for fire particles so they stay active
    if (material.physics && material.physics.gravityScale !== undefined) {
        // Use Matter.Body methods directly if available
        if (typeof Matter !== 'undefined' && Matter.Body) {
            Matter.Body.set(body, 'sleepThreshold', 0); // Never sleep
            Matter.Body.set(body, 'frictionAir', 0.001); // Very low air resistance
            Matter.Body.setStatic(body, false); // Ensure it's dynamic
        } else {
            body.sleepThreshold = 0;
            body.frictionAir = 0.001;
        }
    }
    
    // Store particle data with separate body and sprite
    const particle = {
        body: body,
        sprite: sprite,
        materialType: materialId,
        color: material.color, // Keep for backward compatibility
        heatLevel: 0, // Initialize heat level for gradual fire spreading
        creationTime: Date.now(), // Track when particle was created
        previousVelocityY: 0, // Track previous velocity for impact detection
        glowTween
    };
    
    particles.push(particle);
    
    return particle;
}

// Legacy function name for backward compatibility
function createSandParticle(x, y, color) {
    // If color matches a material, use that material, otherwise default to SAND
    let materialId = 'SAND';
    for (const [id, mat] of Object.entries(MATERIALS)) {
        if (mat.color === color) {
            materialId = id;
            break;
        }
    }
    return createParticle(x, y, materialId);
}

function generateBrushPoints(x, y, radius, densityMultiplier = 1) {
    const points = [];
    const safeRadius = Math.max(1, radius);
    const baseDensity = Math.max(4, Math.round((safeRadius * safeRadius) / 14));
    const total = Math.min(120, Math.round(baseDensity * densityMultiplier));
    for (let i = 0; i < total; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * safeRadius;
        points.push({
            x: x + Math.cos(angle) * distance,
            y: y + Math.sin(angle) * distance
        });
    }
    return points;
}

function applyBrushStroke(from, to, forceStart = false) {
    if (!from || !to) {
        return;
    }
    const distance = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
    const step = Math.max(6, brushSize * 0.7);
    const steps = Math.max(1, Math.floor(distance / step));
    for (let i = 0; i <= steps; i++) {
        if (!forceStart && steps === 0 && i > 0) {
            continue;
        }
        const t = steps === 0 ? 1 : i / steps;
        const px = Phaser.Math.Linear(from.x, to.x, t);
        const py = Phaser.Math.Linear(from.y, to.y, t);
        const points = generateBrushPoints(px, py, brushSize, 0.85);
        spawnMaterialCluster(points, currentMaterial);
    }
    lastBrushPoint = { x: to.x, y: to.y };
}

function createLinePoints(start, end, spacing) {
    const points = [];
    const distance = Phaser.Math.Distance.Between(start.x, start.y, end.x, end.y);
    const steps = Math.max(1, Math.floor(distance / spacing));
    for (let i = 0; i <= steps; i++) {
        const t = steps === 0 ? 1 : i / steps;
        const x = Phaser.Math.Linear(start.x, end.x, t);
        const y = Phaser.Math.Linear(start.y, end.y, t);
        points.push({ x, y });
    }
    return points;
}

function createRectanglePoints(start, end, spacing) {
    const points = [];
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    for (let x = minX; x <= maxX; x += spacing) {
        for (let y = minY; y <= maxY; y += spacing) {
            points.push({ x, y });
        }
    }
    return points;
}

function createCirclePoints(center, edgePoint, spacing) {
    const radius = Phaser.Math.Distance.Between(center.x, center.y, edgePoint.x, edgePoint.y);
    const points = [];
    const stepAngle = spacing / (radius + 0.0001);
    for (let angle = 0; angle < Math.PI * 2; angle += stepAngle) {
        const x = center.x + Math.cos(angle) * radius;
        const y = center.y + Math.sin(angle) * radius;
        points.push({ x, y });
    }
    const ringCount = Math.max(1, Math.floor(radius / spacing));
    for (let r = radius - spacing; r > spacing; r -= spacing) {
        for (let angle = 0; angle < Math.PI * 2; angle += stepAngle * 1.8) {
            const x = center.x + Math.cos(angle) * r;
            const y = center.y + Math.sin(angle) * r;
            points.push({ x, y });
        }
    }
    return points;
}

function applyFanEffect(start, end) {
    if (!start || !end) {
        return;
    }
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.max(10, Math.sqrt(dx * dx + dy * dy));
    const dirX = dx / distance;
    const dirY = dy / distance;
    const radius = Math.max(80, brushSize * 4);
    const baseStrength = 0.0008 + Math.min(0.0022, distance / 180000);
    particles.forEach(particle => {
        if (!particle.body || !particle.body.position) return;
        const px = particle.body.position.x;
        const py = particle.body.position.y;
        const pdx = px - start.x;
        const pdy = py - start.y;
        const dist = Math.sqrt(pdx * pdx + pdy * pdy);
        if (dist > radius || dist === 0) return;
        const falloff = 1 - dist / radius;
        const force = baseStrength * falloff * (particle.materialType === 'SMOKE' ? 0.4 : 1);
        try {
            if (typeof Matter !== 'undefined' && Matter.Body && Matter.Body.applyForce) {
                Matter.Body.applyForce(particle.body, particle.body.position, {
                    x: dirX * force,
                    y: dirY * force
                });
            } else if (particle.body.velocity) {
                particle.body.velocity.x += dirX * force * 1800;
                particle.body.velocity.y += dirY * force * 1800;
            }
        } catch (e) {
            // ignore errors
        }
    });
    emitEffectBurst('smoke', 10, start.x, start.y);
    playReactionSound('fan', 0.4);
}

function sampleMaterialAt(x, y) {
    let closest = null;
    let closestDist = Infinity;
    const searchRadius = 24;
    for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        if (!particle.body || !particle.body.position) continue;
        const px = particle.body.position.x;
        const py = particle.body.position.y;
        const dx = px - x;
        const dy = py - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist && dist <= searchRadius) {
            closest = particle;
            closestDist = dist;
        }
    }
    if (closest) {
        selectMaterial(closest.materialType);
        pingMaterialButton(closest.materialType);
        createShimmerEffect(closest.body.position.x, closest.body.position.y);
    }
}

function handlePointerDown(pointer) {
    if (pointer.event && pointer.event.preventDefault) {
        pointer.event.preventDefault();
    }
    resumeAudioContext();
    pointerStart = { x: pointer.x, y: pointer.y };
    pointerLatest = { x: pointer.x, y: pointer.y };
    isPointerDown = true;
    lastBrushPoint = null;

    if (currentTool === 'dropper') {
        sampleMaterialAt(pointer.x, pointer.y);
        isPointerDown = false;
        pointerStart = null;
        return;
    }

    if (currentTool === 'brush') {
        applyBrushStroke(pointerStart, pointerStart, true);
    }
}

function handlePointerMove(pointer) {
    if (!isPointerDown) {
        return;
    }
    pointerLatest = { x: pointer.x, y: pointer.y };
    if (currentTool === 'brush') {
        const from = lastBrushPoint || pointerStart || pointerLatest;
        applyBrushStroke(from, pointerLatest, !lastBrushPoint);
    }
}

function handlePointerUp(pointer) {
    const endPoint = { x: pointer.x, y: pointer.y };
    if (currentTool === 'brush') {
        if (isPointerDown && pointerStart) {
            const from = lastBrushPoint || pointerStart;
            applyBrushStroke(from, endPoint, true);
        }
    } else if (currentTool === 'line' && pointerStart) {
        const spacing = Math.max(6, brushSize * 0.75);
        const linePoints = createLinePoints(pointerStart, endPoint, spacing);
        spawnMaterialCluster(linePoints, currentMaterial);
    } else if (currentTool === 'rectangle' && pointerStart) {
        const spacing = Math.max(6, brushSize * 0.8);
        const rectPoints = createRectanglePoints(pointerStart, endPoint, spacing);
        spawnMaterialCluster(rectPoints, currentMaterial);
    } else if (currentTool === 'circle' && pointerStart) {
        const spacing = Math.max(5, brushSize * 0.6);
        const circlePoints = createCirclePoints(pointerStart, endPoint, spacing);
        spawnMaterialCluster(circlePoints, currentMaterial);
    } else if (currentTool === 'fan' && pointerStart) {
        applyFanEffect(pointerStart, endPoint);
    }

    pointerStart = null;
    pointerLatest = null;
    lastBrushPoint = null;
    isPointerDown = false;
}

function selectTool(toolId) {
    if (!toolId || currentTool === toolId) {
        return;
    }
    currentTool = toolId;
    updateToolButtons();
}

function updateToolButtons() {
    const toolButtons = document.querySelectorAll('.tool-btn');
    toolButtons.forEach(btn => {
        if (btn.dataset.tool === currentTool) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function updateBrushSizeUI() {
    const display = document.getElementById('brush-size-value');
    if (display) {
        display.textContent = brushSize.toString();
    }
}

function resumeAudioContext() {
    if (reactionAudioContext && reactionAudioContext.state === 'suspended') {
        reactionAudioContext.resume().catch(() => {});
    }
}

// Track reactions to prevent duplicate processing
const processedReactions = new Set();
let reactionFrameCounter = 0;

// Handle collisions and trigger reactions
function handleCollisions(pairs) {
    if (!pairs || pairs.length === 0) {
        return;
    }
    
    // Clear processed reactions every few frames to allow reactions again
    reactionFrameCounter++;
    if (reactionFrameCounter % 10 === 0) {
        processedReactions.clear();
    }
    
    // Track particles to remove, convert, create and animations to create
    const particlesToRemove = new Set();
    const particlesToConvert = [];
    const particlesToCreate = [];
    const animationsToCreate = [];
    
        pairs.forEach(pair => {
        // Handle different collision pair structures
        let bodyA = pair.bodyA;
        let bodyB = pair.bodyB;
        
        // Matter.js collision pairs have bodyA and bodyB
        if (!bodyA || !bodyB) {
            return; // Invalid collision pair
        }
        
        // Find particles for these bodies
        const particleA = particles.find(p => {
            if (!p.body) return false;
            return p.body === bodyA || p.body.id === bodyA.id;
        });
        const particleB = particles.find(p => {
            if (!p.body) return false;
            return p.body === bodyB || p.body.id === bodyB.id;
        });
        
        if (!particleA || !particleB) {
            return; // One or both aren't particles (could be boundary collision)
        }
        
        // Calculate impact velocity for impact-based reactions
        let impactVelocity = 0;
        if (bodyA.velocity && bodyB.velocity) {
            const velocityDiff = {
                x: bodyA.velocity.x - bodyB.velocity.x,
                y: bodyA.velocity.y - bodyB.velocity.y
            };
            impactVelocity = Math.sqrt(velocityDiff.x * velocityDiff.x + velocityDiff.y * velocityDiff.y);
        }
        
        // Create unique reaction key to prevent duplicate processing
        const reactionKey = `${particleA.materialType}-${particleB.materialType}-${Math.floor(particleA.body.position.x)}-${Math.floor(particleA.body.position.y)}`;
        if (processedReactions.has(reactionKey)) {
            return; // Already processed this reaction
        }
        
        const materialA = MATERIALS[particleA.materialType];
        const materialB = MATERIALS[particleB.materialType];
        
        if (!materialA || !materialB) {
            return;
        }
        
        // Check for reactions - check both directions (A reacts with B, B reacts with A)
        let reactionType = null;
        let removeA = false;
        let removeB = false;
        let convertA = null; // Material ID to convert particleA to
        let convertB = null; // Material ID to convert particleB to
        let createMaterial = null; // Material ID to create
        let reactionName = null;
        let reactionLogged = false;
        
        // Check if materialA has a reaction with materialB
        if (materialA.reactions && materialA.reactions[materialB.id]) {
            reactionType = materialA.reactions[materialB.id];
            reactionName = `${materialA.name}+${materialB.name}`;
            
            switch (reactionType) {
                case 'EVAPORATE':
                    // Both disappear, create steam
                    removeA = true;
                    removeB = true;
                    createMaterial = 'STEAM';
                    break;
                case 'EXTINGUISH':
                    // Water extinguishes fire - fire disappears
                    if (particleA.materialType === 'FIRE') {
                        removeA = true;
                    } else if (particleB.materialType === 'FIRE') {
                        removeB = true;
                    }
                    break;
                case 'CORRODE':
                    // Acid corrodes material slowly (probabilistic)
                    if (Math.random() < 0.3) { // 30% chance per collision
                        removeB = true;
                    }
                    break;
                case 'DISSOLVE':
                    // Only materialB disappears (gets dissolved)
                    removeB = true;
                    break;
                case 'IGNITE':
                    // Convert material to fire
                    if (particleA.materialType === 'FIRE') {
                        convertB = 'FIRE';
                    } else if (particleB.materialType === 'FIRE') {
                        convertA = 'FIRE';
                    } else if (particleA.materialType === 'OIL' || particleB.materialType === 'OIL') {
                        // Oil ignites to fire
                        if (particleA.materialType === 'OIL') {
                            convertA = 'FIRE';
                        } else {
                            convertB = 'FIRE';
                        }
                    }
                    break;
                case 'GLASSIFY':
                    if (particleA.materialType === 'SAND') {
                        convertA = 'GLASS';
                    }
                    if (particleB.materialType === 'SAND') {
                        convertB = 'GLASS';
                    }
                    break;
                case 'CRYSTALLIZE':
                    if (particleA.materialType === 'GLASS' || particleA.materialType === 'GLOW_GLASS') {
                        convertA = 'CRYSTAL';
                    }
                    if (particleB.materialType === 'GLASS' || particleB.materialType === 'GLOW_GLASS') {
                        convertB = 'CRYSTAL';
                    }
                    break;
                case 'PLASMAFY':
                    if (particleA.materialType !== 'PLASMA') {
                        convertA = 'PLASMA';
                    }
                    if (particleB.materialType !== 'PLASMA') {
                        convertB = 'PLASMA';
                    }
                    break;
                case 'AURORA_EVENT':
                    if (particleA.materialType !== 'AURORA') {
                        convertA = 'AURORA';
                    }
                    if (particleB.materialType !== 'AURORA') {
                        convertB = 'AURORA';
                    }
                    break;
                case 'FOAMIFY':
                    if (particleA.materialType === 'WATER' || particleA.materialType === 'GAS' || particleA.materialType === 'STEAM') {
                        convertA = 'FOAM';
                    }
                    if (particleB.materialType === 'WATER' || particleB.materialType === 'GAS' || particleB.materialType === 'STEAM') {
                        convertB = 'FOAM';
                    }
                    break;
                case 'ENERGIZE':
                    if (particleA.materialType === 'GLASS' || particleA.materialType === 'CRYSTAL') {
                        convertA = 'GLOW_GLASS';
                    }
                    if (particleB.materialType === 'GLASS' || particleB.materialType === 'CRYSTAL') {
                        convertB = 'GLOW_GLASS';
                    }
                    break;
                case 'SHIMMER':
                    // Visual-only, handled later
                    break;
                case 'MELT':
                    // Ice melts to water
                    if (particleA.materialType === 'ICE') {
                        convertA = 'WATER';
                    } else if (particleB.materialType === 'ICE') {
                        convertB = 'WATER';
                    }
                    break;
                case 'FREEZE':
                    // Water freezes to ice
                    if (particleA.materialType === 'WATER') {
                        convertA = 'ICE';
                    } else if (particleB.materialType === 'WATER') {
                        convertB = 'ICE';
                    }
                    break;
                case 'CONDENSE':
                    // Steam condenses to water
                    if (particleA.materialType === 'STEAM') {
                        convertA = 'WATER';
                    } else if (particleB.materialType === 'STEAM') {
                        convertB = 'WATER';
                    }
                    break;
                case 'SOLIDIFY':
                    // Lava solidifies to stone when touching water/ice
                    if (particleA.materialType === 'LAVA') {
                        convertA = 'STONE'; // Lava becomes stone
                        if (particleB.materialType === 'WATER') {
                            createMaterial = 'STEAM'; // Create steam
                        }
                    } else if (particleB.materialType === 'LAVA') {
                        convertB = 'STONE'; // Lava becomes stone
                        if (particleA.materialType === 'WATER') {
                            createMaterial = 'STEAM'; // Create steam
                        }
                    }
                    break;
                case 'STEAM':
                    // Creates steam, remove reacting material
                    if (particleA.materialType === 'WATER') {
                        removeA = true;
                        createMaterial = 'STEAM';
                    } else if (particleB.materialType === 'WATER') {
                        removeB = true;
                        createMaterial = 'STEAM';
                    } else if (particleA.materialType === 'ICE' || particleB.materialType === 'ICE') {
                        // ICE + LAVA creates steam, both disappear
                        removeA = true;
                        removeB = true;
                        createMaterial = 'STEAM';
                    }
                    break;
                case 'SEPARATE':
                    // No reaction, just physical separation (oil floats on water)
                    // Skip processing
                    return;
                case 'BURN':
                    // Wood burns to fire and creates smoke
                    if (particleA.materialType === 'WOOD') {
                        removeA = true;
                        convertA = 'FIRE';
                        particlesToCreate.push({ material: 'SMOKE', x: particleA.body.position.x, y: particleA.body.position.y });
                    } else if (particleB.materialType === 'WOOD') {
                        removeB = true;
                        convertB = 'FIRE';
                        particlesToCreate.push({ material: 'SMOKE', x: particleB.body.position.x, y: particleB.body.position.y });
                    }
                    break;
                case 'EXPLODE':
                    // Gas explodes with fire - create large fire spread
                    removeA = true;
                    removeB = true;
                    const explodeX = (particleA.body.position.x + particleB.body.position.x) / 2;
                    const explodeY = (particleA.body.position.y + particleB.body.position.y) / 2;
                    // Create multiple fire particles in explosion
                    for (let k = 0; k < 5; k++) {
                        const angle = Math.random() * Math.PI * 2;
                        const radius = Math.random() * 20;
                        particlesToCreate.push({
                            material: 'FIRE',
                            x: explodeX + Math.cos(angle) * radius,
                            y: explodeY + Math.sin(angle) * radius
                        });
                    }
                    createExplosionEffect(explodeX, explodeY);
                    break;
                case 'MELT_METAL':
                    // Metal melts with lava
                    if (particleA.materialType === 'METAL') {
                        removeA = true;
                    } else if (particleB.materialType === 'METAL') {
                        removeB = true;
                    }
                    break;
                case 'SHATTER':
                    // Glass shatters
                    if (particleA.materialType === 'GLASS') {
                        removeA = true;
                        createShatterEffect(particleA.body.position.x, particleA.body.position.y);
                    } else if (particleB.materialType === 'GLASS') {
                        removeB = true;
                        createShatterEffect(particleB.body.position.x, particleB.body.position.y);
                    }
                    break;
                case 'EXTINGUISH_PARTIAL':
                    // Smoke partially extinguishes fire - small chance to remove fire
                    if (particleA.materialType === 'SMOKE' && particleB.materialType === 'FIRE' && Math.random() < 0.3) {
                        removeB = true;
                    } else if (particleB.materialType === 'SMOKE' && particleA.materialType === 'FIRE' && Math.random() < 0.3) {
                        removeA = true;
                    }
                    break;
                case 'IMPACT_SHATTER':
                    // Glass shatters on high-velocity impact
                    const shatterThreshold = materialA.impactShatterThreshold || materialB.impactShatterThreshold || 3.0;
                    if (impactVelocity >= shatterThreshold) {
                        if (particleA.materialType === 'GLASS') {
                            removeA = true;
                            createShatterEffect(particleA.body.position.x, particleA.body.position.y);
                        } else if (particleB.materialType === 'GLASS') {
                            removeB = true;
                            createShatterEffect(particleB.body.position.x, particleB.body.position.y);
                        }
                    }
                    break;
                case 'MELT_GLASS':
                    // Glass melts when touching lava
                    if (particleA.materialType === 'GLASS') {
                        removeA = true;
                    } else if (particleB.materialType === 'GLASS') {
                        removeB = true;
                    }
                    break;
                case 'OXIDIZE':
                    // Metal oxidizes slowly in water (small chance)
                    if (Math.random() < 0.05) { // 5% chance per collision
                        if (particleA.materialType === 'METAL') {
                            removeA = true;
                        } else if (particleB.materialType === 'METAL') {
                            removeB = true;
                        }
                    }
                    break;
            }
        }
        
        // Check if materialB has a reaction with materialA (check reverse)
        if (!removeA && !removeB && !convertA && !convertB && materialB.reactions && materialB.reactions[materialA.id]) {
            reactionType = materialB.reactions[materialA.id];
            reactionName = `${materialB.name}+${materialA.name}`;
            
            switch (reactionType) {
                case 'EVAPORATE':
                    // Both disappear, create steam
                    removeA = true;
                    removeB = true;
                    createMaterial = 'STEAM';
                    break;
                case 'EXTINGUISH':
                    // Water extinguishes fire - fire disappears
                    if (particleB.materialType === 'FIRE') {
                        removeB = true;
                    } else if (particleA.materialType === 'FIRE') {
                        removeA = true;
                    }
                    break;
                case 'CORRODE':
                    // Acid corrodes material slowly (probabilistic)
                    if (Math.random() < 0.3) { // 30% chance per collision
                        removeA = true;
                    }
                    break;
                case 'DISSOLVE':
                    // Only materialA disappears (gets dissolved)
                    removeA = true;
                    break;
                case 'IGNITE':
                    // Convert material to fire
                    if (particleB.materialType === 'FIRE') {
                        convertA = 'FIRE';
                    } else if (particleA.materialType === 'FIRE') {
                        convertB = 'FIRE';
                    } else if (particleA.materialType === 'OIL' || particleB.materialType === 'OIL') {
                        // Oil ignites to fire
                        if (particleB.materialType === 'OIL') {
                            convertB = 'FIRE';
                        } else {
                            convertA = 'FIRE';
                        }
                    }
                    break;
                case 'GLASSIFY':
                    if (particleA.materialType === 'SAND') {
                        convertA = 'GLASS';
                    }
                    if (particleB.materialType === 'SAND') {
                        convertB = 'GLASS';
                    }
                    break;
                case 'CRYSTALLIZE':
                    if (particleA.materialType === 'GLASS' || particleA.materialType === 'GLOW_GLASS') {
                        convertA = 'CRYSTAL';
                    }
                    if (particleB.materialType === 'GLASS' || particleB.materialType === 'GLOW_GLASS') {
                        convertB = 'CRYSTAL';
                    }
                    break;
                case 'PLASMAFY':
                    if (particleA.materialType !== 'PLASMA') {
                        convertA = 'PLASMA';
                    }
                    if (particleB.materialType !== 'PLASMA') {
                        convertB = 'PLASMA';
                    }
                    break;
                case 'AURORA_EVENT':
                    if (particleA.materialType !== 'AURORA') {
                        convertA = 'AURORA';
                    }
                    if (particleB.materialType !== 'AURORA') {
                        convertB = 'AURORA';
                    }
                    break;
                case 'FOAMIFY':
                    if (particleA.materialType === 'WATER' || particleA.materialType === 'GAS' || particleA.materialType === 'STEAM') {
                        convertA = 'FOAM';
                    }
                    if (particleB.materialType === 'WATER' || particleB.materialType === 'GAS' || particleB.materialType === 'STEAM') {
                        convertB = 'FOAM';
                    }
                    break;
                case 'ENERGIZE':
                    if (particleA.materialType === 'GLASS' || particleA.materialType === 'CRYSTAL') {
                        convertA = 'GLOW_GLASS';
                    }
                    if (particleB.materialType === 'GLASS' || particleB.materialType === 'CRYSTAL') {
                        convertB = 'GLOW_GLASS';
                    }
                    break;
                case 'SHIMMER':
                    // Visual-only reaction handled later
                    break;
                case 'MELT':
                    // Ice melts to water
                    if (particleB.materialType === 'ICE') {
                        convertB = 'WATER';
                    } else if (particleA.materialType === 'ICE') {
                        convertA = 'WATER';
                    }
                    break;
                case 'FREEZE':
                    // Water freezes to ice
                    if (particleB.materialType === 'WATER') {
                        convertB = 'ICE';
                    } else if (particleA.materialType === 'WATER') {
                        convertA = 'ICE';
                    }
                    break;
                case 'CONDENSE':
                    // Steam condenses to water
                    if (particleB.materialType === 'STEAM') {
                        convertB = 'WATER';
                    } else if (particleA.materialType === 'STEAM') {
                        convertA = 'WATER';
                    }
                    break;
                case 'SOLIDIFY':
                    // Lava solidifies to stone when touching water/ice
                    if (particleB.materialType === 'LAVA') {
                        convertB = 'STONE'; // Lava becomes stone
                        if (particleA.materialType === 'WATER') {
                            createMaterial = 'STEAM'; // Create steam
                        }
                    } else if (particleA.materialType === 'LAVA') {
                        convertA = 'STONE'; // Lava becomes stone
                        if (particleB.materialType === 'WATER') {
                            createMaterial = 'STEAM'; // Create steam
                        }
                    }
                    break;
                case 'STEAM':
                    // Creates steam, remove reacting material
                    if (particleB.materialType === 'WATER') {
                        removeB = true;
                        createMaterial = 'STEAM';
                    } else if (particleA.materialType === 'WATER') {
                        removeA = true;
                        createMaterial = 'STEAM';
                    } else if (particleA.materialType === 'ICE' || particleB.materialType === 'ICE') {
                        // ICE + LAVA creates steam, both disappear
                        removeA = true;
                        removeB = true;
                        createMaterial = 'STEAM';
                    }
                    break;
                case 'SEPARATE':
                    // No reaction, just physical separation (oil floats on water)
                    // Skip processing
                    return;
                case 'BURN':
                    // Wood burns to fire and creates smoke
                    if (particleB.materialType === 'WOOD') {
                        removeB = true;
                        convertB = 'FIRE';
                        particlesToCreate.push({ material: 'SMOKE', x: particleB.body.position.x, y: particleB.body.position.y });
                    } else if (particleA.materialType === 'WOOD') {
                        removeA = true;
                        convertA = 'FIRE';
                        particlesToCreate.push({ material: 'SMOKE', x: particleA.body.position.x, y: particleA.body.position.y });
                    }
                    break;
                case 'EXPLODE':
                    // Gas explodes with fire - create large fire spread
                    removeA = true;
                    removeB = true;
                    const explodeX2 = (particleA.body.position.x + particleB.body.position.x) / 2;
                    const explodeY2 = (particleA.body.position.y + particleB.body.position.y) / 2;
                    // Create multiple fire particles in explosion
                    for (let k = 0; k < 5; k++) {
                        const angle = Math.random() * Math.PI * 2;
                        const radius = Math.random() * 20;
                        particlesToCreate.push({
                            material: 'FIRE',
                            x: explodeX2 + Math.cos(angle) * radius,
                            y: explodeY2 + Math.sin(angle) * radius
                        });
                    }
                    createExplosionEffect(explodeX2, explodeY2);
                    break;
                case 'MELT_METAL':
                    // Metal melts with lava
                    if (particleB.materialType === 'METAL') {
                        removeB = true;
                    } else if (particleA.materialType === 'METAL') {
                        removeA = true;
                    }
                    break;
                case 'SHATTER':
                    // Glass shatters
                    if (particleB.materialType === 'GLASS') {
                        removeB = true;
                        createShatterEffect(particleB.body.position.x, particleB.body.position.y);
                    } else if (particleA.materialType === 'GLASS') {
                        removeA = true;
                        createShatterEffect(particleA.body.position.x, particleA.body.position.y);
                    }
                    break;
                case 'EXTINGUISH_PARTIAL':
                    // Smoke partially extinguishes fire - small chance to remove fire
                    if (particleB.materialType === 'SMOKE' && particleA.materialType === 'FIRE' && Math.random() < 0.3) {
                        removeA = true;
                    } else if (particleA.materialType === 'SMOKE' && particleB.materialType === 'FIRE' && Math.random() < 0.3) {
                        removeB = true;
                    }
                    break;
                case 'IMPACT_SHATTER':
                    // Glass shatters on high-velocity impact
                    const shatterThreshold2 = materialA.impactShatterThreshold || materialB.impactShatterThreshold || 3.0;
                    if (impactVelocity >= shatterThreshold2) {
                        if (particleB.materialType === 'GLASS') {
                            removeB = true;
                            createShatterEffect(particleB.body.position.x, particleB.body.position.y);
                        } else if (particleA.materialType === 'GLASS') {
                            removeA = true;
                            createShatterEffect(particleA.body.position.x, particleA.body.position.y);
                        }
                    }
                    break;
                case 'MELT_GLASS':
                    // Glass melts when touching lava
                    if (particleB.materialType === 'GLASS') {
                        removeB = true;
                    } else if (particleA.materialType === 'GLASS') {
                        removeA = true;
                    }
                    break;
                case 'OXIDIZE':
                    // Metal oxidizes slowly in water (small chance)
                    if (Math.random() < 0.05) { // 5% chance per collision
                        if (particleB.materialType === 'METAL') {
                            removeB = true;
                        } else if (particleA.materialType === 'METAL') {
                            removeA = true;
                        }
                    }
                    break;
            }
        }
        
        // Handle conversions (transformative reactions)
        if (convertA && !particlesToRemove.has(particleA)) {
            processedReactions.add(reactionKey);
            const pos = particleA.body.position;
            particlesToConvert.push({
                particle: particleA,
                newMaterial: convertA,
                x: pos.x,
                y: pos.y
            });
            if (reactionType && !reactionLogged) {
                registerReaction(reactionType, materialA.id, materialB.id, reactionName);
                reactionLogged = true;
            }
        }
        if (convertB && !particlesToRemove.has(particleB)) {
            processedReactions.add(reactionKey);
            const pos = particleB.body.position;
            particlesToConvert.push({
                particle: particleB,
                newMaterial: convertB,
                x: pos.x,
                y: pos.y
            });
            if (reactionType && !reactionLogged) {
                registerReaction(reactionType, materialA.id, materialB.id, reactionName);
                reactionLogged = true;
            }
        }
        
        // Handle creation reactions
        if (createMaterial) {
            processedReactions.add(reactionKey);
            const reactionX = (particleA.body.position.x + particleB.body.position.x) / 2;
            const reactionY = (particleA.body.position.y + particleB.body.position.y) / 2;
            particlesToCreate.push({
                material: createMaterial,
                x: reactionX,
                y: reactionY
            });
            if (reactionType && !reactionLogged) {
                registerReaction(reactionType, materialA.id, materialB.id, reactionName);
                reactionLogged = true;
            }
        }
        
        // If reaction detected, mark for removal and animation
        if (removeA || removeB) {
            processedReactions.add(reactionKey);
            
            // Calculate reaction position (midpoint between particles)
            const reactionX = (particleA.body.position.x + particleB.body.position.x) / 2;
            const reactionY = (particleA.body.position.y + particleB.body.position.y) / 2;
            
            // Create animation based on reaction type
            animationsToCreate.push({
                type: reactionType,
                x: reactionX,
                y: reactionY,
                materialA: materialA.id,
                materialB: materialB.id
            });

            if (reactionType && !reactionLogged) {
                registerReaction(reactionType, materialA.id, materialB.id, reactionName);
                reactionLogged = true;
            }
            
            // Mark particles for removal
            if (removeA && !particlesToRemove.has(particleA)) {
                particlesToRemove.add(particleA);
            }
            if (removeB && !particlesToRemove.has(particleB)) {
                particlesToRemove.add(particleB);
            }
        }

        if (!reactionLogged && reactionType && !removeA && !removeB && !convertA && !convertB && !createMaterial) {
            const reactionX = (particleA.body.position.x + particleB.body.position.x) / 2;
            const reactionY = (particleA.body.position.y + particleB.body.position.y) / 2;
            animationsToCreate.push({
                type: reactionType,
                x: reactionX,
                y: reactionY,
                materialA: materialA.id,
                materialB: materialB.id
            });
            registerReaction(reactionType, materialA.id, materialB.id, reactionName);
            reactionLogged = true;
        }
    });
    
    // Convert particles (transformative reactions)
    particlesToConvert.forEach(conversion => {
        convertParticleMaterial(conversion.particle, conversion.newMaterial, conversion.x, conversion.y);
        if (conversion.newMaterial === 'FIRE') {
            createSparkEffect(conversion.x, conversion.y);
        }
    });
    
    // Create new particles (creation reactions)
    particlesToCreate.forEach(creation => {
        createParticle(creation.x, creation.y, creation.material);
    });
    
    // Create animations before removing particles
    animationsToCreate.forEach(anim => {
        createReactionAnimation(anim.type, anim.x, anim.y, anim.materialA, anim.materialB);
    });
    
    // Remove particles that reacted
    if (particlesToRemove.size > 0) {
        particlesToRemove.forEach(particle => {
            removeParticle(particle);
        });
    }
}

// Create visual animation for reactions
function createReactionAnimation(reactionType, x, y, materialA, materialB) {
    if (!currentScene) {
        return;
    }
    
    switch (reactionType) {
        case 'EVAPORATE':
            // Create steam effect (white particles rising)
            createSteamEffect(x, y);
            break;
        case 'EXTINGUISH':
            // Create smoke/spark effect
            createSmokeEffect(x, y);
            break;
        case 'CORRODE':
            // Create gas bubble effect
            createGasBubbleEffect(x, y);
            break;
        case 'DISSOLVE':
            // Create gas bubble effect (similar to corrode)
            createGasBubbleEffect(x, y);
            break;
        case 'STEAM':
            // Create steam effect
            createSteamEffect(x, y);
            break;
        case 'MELT':
            // Create water droplet effect
            createWaterDropletEffect(x, y);
            break;
        case 'FREEZE':
            // Create frost/ice effect
            createFrostEffect(x, y);
            break;
        case 'CONDENSE':
            // Create water droplet effect
            createWaterDropletEffect(x, y);
            break;
        case 'SOLIDIFY':
            // Create cooling/smoke effect
            createSmokeEffect(x, y);
            break;
        case 'BURN':
            // Create fire/spark effect
            createSparkEffect(x, y);
            createSmokeEffect(x, y);
            break;
        case 'EXPLODE':
            // Create explosion effect
            createExplosionEffect(x, y);
            break;
        case 'MELT_METAL':
            // Create spark/smoke effect
            createSmokeEffect(x, y);
            createSparkEffect(x, y);
            break;
        case 'SHATTER':
            // Create shatter effect
            createShatterEffect(x, y);
            break;
        case 'EXTINGUISH_PARTIAL':
            // Create smoke effect
            createSmokeEffect(x, y);
            break;
        case 'GLASSIFY':
            createGlassifyEffect(x, y);
            break;
        case 'CRYSTALLIZE':
            createCrystalEffect(x, y);
            break;
        case 'AURORA_EVENT':
            createAuroraEffect(x, y);
            break;
        case 'PLASMAFY':
            createPlasmaEffect(x, y);
            break;
        case 'FOAMIFY':
            createFoamEffect(x, y);
            break;
        case 'ENERGIZE':
            createEnergizeEffect(x, y);
            break;
        case 'SHIMMER':
            createShimmerEffect(x, y);
            break;
        case 'SHIMMER_RING':
            createShimmerEffect(x, y);
            break;
    }
}

// Steam effect for water + fire
function createSteamEffect(x, y) {
    if (!currentScene) return;
    emitEffectBurst('steam', 20, x, y);
    playReactionSound('steam', 0.6);
}

// Smoke effect for fire extinguished
function createSmokeEffect(x, y) {
    if (!currentScene) return;
    emitEffectBurst('smoke', 14, x, y);
    playReactionSound('smoke', 0.45);
}

// Gas bubble effect for acid + sand
function createGasBubbleEffect(x, y) {
    if (!currentScene) return;
    
    const bubbleCount = 3;
    for (let i = 0; i < bubbleCount; i++) {
        const offsetX = (Math.random() - 0.5) * 10;
        const bubble = currentScene.add.circle(x + offsetX, y, 2, 0x2ecc71, 0.5);
        
        // Animate bubbles rising
        currentScene.tweens.add({
            targets: bubble,
            y: y - 30 - Math.random() * 20,
            alpha: 0,
            scale: 1.2,
            duration: 350 + Math.random() * 150,
            ease: 'Power1',
            onComplete: () => {
                bubble.destroy();
            }
        });
    }
}

// Water droplet effect for melting and condensing
function createWaterDropletEffect(x, y) {
    if (!currentScene) return;
    
    const dropletCount = 3;
    for (let i = 0; i < dropletCount; i++) {
        const offsetX = (Math.random() - 0.5) * 12;
        const offsetY = (Math.random() - 0.5) * 12;
        const droplet = currentScene.add.circle(x + offsetX, y + offsetY, 2, 0x3498db, 0.7);
        
        // Animate droplets falling and fading
        currentScene.tweens.add({
            targets: droplet,
            y: y + offsetY + 15 + Math.random() * 10,
            x: x + offsetX + (Math.random() - 0.5) * 8,
            alpha: 0,
            scale: 1.3,
            duration: 250 + Math.random() * 100,
            ease: 'Power2',
            onComplete: () => {
                droplet.destroy();
            }
        });
    }
}

// Frost effect for freezing
function createFrostEffect(x, y) {
    if (!currentScene) return;
    
    const frostCount = 4;
    for (let i = 0; i < frostCount; i++) {
        const offsetX = (Math.random() - 0.5) * 15;
        const offsetY = (Math.random() - 0.5) * 15;
        const frost = currentScene.add.circle(x + offsetX, y + offsetY, 1.5, 0x87ceeb, 0.8);
        
        // Animate frost particles spreading outward
        const angle = Math.random() * Math.PI * 2;
        const distance = 8 + Math.random() * 8;
        currentScene.tweens.add({
            targets: frost,
            x: x + offsetX + Math.cos(angle) * distance,
            y: y + offsetY + Math.sin(angle) * distance,
            alpha: 0,
            scale: 1.5,
            duration: 200 + Math.random() * 100,
            ease: 'Power1',
            onComplete: () => {
                frost.destroy();
            }
        });
    }
}

function createFoamEffect(x, y) {
    if (!currentScene) return;
    emitEffectBurst('foam', 24, x, y);
    playReactionSound('foam', 0.5);
}

function createPlasmaEffect(x, y) {
    if (!currentScene) return;
    emitEffectBurst('plasma', 20, x, y);
    emitEffectBurst('spark', 10, x, y);
    playReactionSound('plasma', 0.9);
    if (currentScene.cameras && currentScene.cameras.main) {
        currentScene.cameras.main.flash(120, 255, 120, 255, 180);
    }
}

function createAuroraEffect(x, y) {
    if (!currentScene) return;
    emitEffectBurst('aurora', 28, x, y);
    emitEffectBurst('spark', 12, x, y);
    playReactionSound('aurora', 0.7);
    if (currentScene.cameras && currentScene.cameras.main) {
        currentScene.cameras.main.flash(140, 150, 200, 255, 200);
        currentScene.cameras.main.shake(180, 0.004);
    }
}

function createCrystalEffect(x, y) {
    if (!currentScene) return;
    emitEffectBurst('crystal', 18, x, y);
    playReactionSound('crystal', 0.6);
}

function createGlassifyEffect(x, y) {
    if (!currentScene) return;
    emitEffectBurst('shimmer', 16, x, y);
    emitEffectBurst('spark', 8, x, y);
    playReactionSound('glassify', 0.7);
}

function createEnergizeEffect(x, y) {
    if (!currentScene) return;
    emitEffectBurst('shimmer', 20, x, y);
    playReactionSound('energize', 0.8);
}

function createShimmerEffect(x, y) {
    if (!currentScene) return;
    emitEffectBurst('shimmer', 12, x, y);
    playReactionSound('shimmer', 0.45);
}

function playReactionSound(type, intensity = 1) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
        return;
    }
    try {
        if (!reactionAudioContext) {
            reactionAudioContext = new AudioContextClass();
        }
        const ctx = reactionAudioContext;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        const baseFrequencies = {
            explosion: 180,
            spark: 540,
            steam: 280,
            smoke: 220,
            foam: 260,
            plasma: 720,
            crystal: 420,
            glassify: 480,
            energize: 560,
            shimmer: 640,
            aurora: 500,
            fan: 200
        };

        const waveform = {
            explosion: 'sawtooth',
            spark: 'triangle',
            plasma: 'square',
            crystal: 'triangle',
            glassify: 'sine',
            energize: 'sawtooth',
            shimmer: 'sine',
            aurora: 'triangle',
            fan: 'sine'
        };

        const baseFreq = baseFrequencies[type] || 320;
        const frequency = baseFreq * (1 + (Math.random() - 0.5) * 0.25);
        osc.type = waveform[type] || 'triangle';
        osc.frequency.setValueAtTime(frequency, now);

        gain.gain.setValueAtTime(0.16 * intensity, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.46);
    } catch (e) {
        // Audio might be blocked until user interaction; silently ignore
    }
}

// Track particles that have already been processed for spreading this frame
const processedSpreadParticles = new Set();

// Heat update system for gradual fire spreading
function updateHeatSystem() {
    if (!currentScene || particles.length < 2) {
        return;
    }
    
    const HEAT_RADIUS = 25; // Radius for heat propagation
    const particlesToConvert = []; // Particles that have reached ignition threshold
    
    // Find all heat sources (fire and lava)
    const heatSources = [];
    for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        if (!particle || !particle.body || !particle.body.position) continue;
        
        const material = MATERIALS[particle.materialType];
        if (!material) continue;
        
        // Fire and lava are heat sources
        if (particle.materialType === 'FIRE' || particle.materialType === 'LAVA') {
            heatSources.push(particle);
        }
    }
    
    // For each heat source, heat up nearby flammable materials
    for (let i = 0; i < heatSources.length; i++) {
        const heatSource = heatSources[i];
        const heatSourceMaterial = MATERIALS[heatSource.materialType];
        const heatOutput = heatSourceMaterial.heatOutput || 10;
        const sourceX = heatSource.body.position.x;
        const sourceY = heatSource.body.position.y;
        
        // Check all other particles for heat transfer
        for (let j = 0; j < particles.length; j++) {
            const particle = particles[j];
            if (!particle || !particle.body || !particle.body.position) continue;
            if (particle === heatSource) continue; // Skip self
            
            const material = MATERIALS[particle.materialType];
            if (!material || !material.ignitionThreshold) continue; // Skip materials that don't ignite
            
            // Skip if already fire or lava
            if (particle.materialType === 'FIRE' || particle.materialType === 'LAVA') continue;
            
            // Calculate distance
            const dx = particle.body.position.x - sourceX;
            const dy = particle.body.position.y - sourceY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < HEAT_RADIUS) {
                // Calculate heat transfer based on distance (closer = more heat)
                const distanceFactor = 1 - (distance / HEAT_RADIUS); // 1.0 at distance 0, 0.0 at HEAT_RADIUS
                const heatTransfer = heatOutput * distanceFactor * (material.heatRate || 1);
                
                // Increase heat level
                particle.heatLevel = Math.min(particle.heatLevel + heatTransfer, 100);
                
                // Check if material should ignite
                if (particle.heatLevel >= material.ignitionThreshold && material.ignitionThreshold < 200) {
                    // Mark for conversion to fire
                    if (!particlesToConvert.find(p => p.particle === particle)) {
                        particlesToConvert.push({
                            particle: particle,
                            material: material,
                            x: particle.body.position.x,
                            y: particle.body.position.y
                        });
                    }
                }
            }
        }
    }
    
    // Handle metal heat conduction (metal spreads heat to nearby materials)
    for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        if (!particle || !particle.body || !particle.body.position) continue;
        
        const material = MATERIALS[particle.materialType];
        if (!material || !material.heatConductor) continue; // Only metal conducts heat
        
        // If metal is hot, spread heat to nearby materials
        if (particle.heatLevel > 30) {
            const CONDUCTION_RADIUS = 15;
            const metalX = particle.body.position.x;
            const metalY = particle.body.position.y;
            
            for (let j = 0; j < particles.length; j++) {
                const nearbyParticle = particles[j];
                if (!nearbyParticle || !nearbyParticle.body || !nearbyParticle.body.position) continue;
                if (nearbyParticle === particle) continue;
                
                const nearbyMaterial = MATERIALS[nearbyParticle.materialType];
                if (!nearbyMaterial || !nearbyMaterial.ignitionThreshold) continue;
                if (nearbyParticle.materialType === 'FIRE' || nearbyParticle.materialType === 'LAVA') continue;
                
                const dx = nearbyParticle.body.position.x - metalX;
                const dy = nearbyParticle.body.position.y - metalY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < CONDUCTION_RADIUS) {
                    const distanceFactor = 1 - (distance / CONDUCTION_RADIUS);
                    const heatTransfer = (particle.heatLevel / 10) * distanceFactor * (nearbyMaterial.heatRate || 1);
                    nearbyParticle.heatLevel = Math.min(nearbyParticle.heatLevel + heatTransfer, 100);
                }
            }
        }
    }
    
    // Cool down particles that aren't near heat sources (gradual cooling)
    for (let i = 0; i < particles.length; i++) {
        const particle = particles[i];
        if (!particle || !particle.body) continue;
        
        if (particle.materialType === 'FIRE' || particle.materialType === 'LAVA') continue;
        
        const material = MATERIALS[particle.materialType];
        if (!material || !material.ignitionThreshold) continue;
        
        // Cool down slowly (unless it's smoke which cools things)
        const coolingRate = material.heatRate < 0 ? Math.abs(material.heatRate) : 0.5;
        particle.heatLevel = Math.max(0, particle.heatLevel - coolingRate);
    }
    
    // Convert particles that reached ignition threshold
    particlesToConvert.forEach(conversion => {
        const material = conversion.material;
        const posX = conversion.x;
        const posY = conversion.y;
        
        // Create 2-3 additional fire particles when material ignites
        const fireParticleCount = 2 + Math.floor(Math.random() * 2); // 2 or 3 particles
        
        // Convert the original particle to fire
        convertParticleMaterial(conversion.particle, 'FIRE', posX, posY);
        
        // Create additional fire particles nearby
        for (let k = 0; k < fireParticleCount; k++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 8 + Math.random() * 8; // 8-16 pixels away
            const newX = posX + Math.cos(angle) * radius;
            const newY = posY + Math.sin(angle) * radius;
            
            // Make sure we're within bounds
            if (newX > 30 && newX < gameWidth - 30 && newY > 30 && newY < gameHeight - 30) {
                createParticle(newX, newY, 'FIRE');
                createSparkEffect(newX, newY);
            }
        }
        
        // Create spark effect at original location
        createSparkEffect(posX, posY);
        
        // If wood burned, create smoke particles
        if (conversion.material.id === 'WOOD') {
            for (let k = 0; k < 2; k++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = 5 + Math.random() * 5;
                const smokeX = posX + Math.cos(angle) * radius;
                const smokeY = posY + Math.sin(angle) * radius;
                
                if (smokeX > 30 && smokeX < gameWidth - 30 && smokeY > 30 && smokeY < gameHeight - 30) {
                    createParticle(smokeX, smokeY, 'SMOKE');
                }
            }
        }
    });
}

// Proximity-based reaction check (backup system)
function checkProximityReactions() {
    if (!currentScene || particles.length < 2) {
        return;
    }
    
    const REACTION_DISTANCE = 8; // Distance threshold for reactions
    const particlesToRemove = new Set();
    const particlesToConvert = []; // Particles to convert (e.g., sand -> fire)
    const particlesToCreate = []; // New particles to create
    const animationsToCreate = [];
    
    // Note: Fire spreading is now handled by the gradual heat system (updateHeatSystem)
    // This function handles direct collision-based reactions only
    
    // Check all particle pairs for proximity-based reactions
    for (let i = 0; i < particles.length; i++) {
        const particleA = particles[i];
        if (!particleA || !particleA.body || !particleA.body.position) continue;
        
        for (let j = i + 1; j < particles.length; j++) {
            const particleB = particles[j];
            if (!particleB || !particleB.body || !particleB.body.position) continue;
            
            // Calculate distance between particles
            const dx = particleA.body.position.x - particleB.body.position.x;
            const dy = particleA.body.position.y - particleB.body.position.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            const materialA = MATERIALS[particleA.materialType];
            const materialB = MATERIALS[particleB.materialType];
            
            if (!materialA || !materialB) continue;
            
            // If particles are close enough, check for other reactions
            if (distance < REACTION_DISTANCE) {
                // Check if materials react
                let reactionType = null;
                let removeA = false;
                let removeB = false;
                let convertA = null;
                let convertB = null;
                
                // Check materialA reactions
                if (materialA.reactions && materialA.reactions[materialB.id]) {
                    reactionType = materialA.reactions[materialB.id];
                    switch (reactionType) {
                        case 'EVAPORATE':
                            removeA = true;
                            removeB = true;
                            particlesToCreate.push({ material: 'STEAM', x: (particleA.body.position.x + particleB.body.position.x) / 2, y: (particleA.body.position.y + particleB.body.position.y) / 2 });
                            break;
                        case 'EXTINGUISH':
                            removeA = true;
                            break;
                        case 'EXTINGUISH_PARTIAL':
                            // Smoke partially extinguishes fire - small chance to remove fire
                            if (particleA.materialType === 'SMOKE' && particleB.materialType === 'FIRE' && Math.random() < 0.3) {
                                removeB = true;
                            } else if (particleB.materialType === 'SMOKE' && particleA.materialType === 'FIRE' && Math.random() < 0.3) {
                                removeA = true;
                            }
                            break;
                        case 'CORRODE':
                            removeB = true;
                            break;
                        case 'DISSOLVE':
                            removeB = true;
                            break;
                        case 'BURN':
                            // Wood burns to fire and creates smoke
                            if (particleA.materialType === 'WOOD') {
                                removeA = true;
                                convertA = 'FIRE';
                                particlesToCreate.push({ material: 'SMOKE', x: particleA.body.position.x, y: particleA.body.position.y });
                            } else if (particleB.materialType === 'WOOD') {
                                removeB = true;
                                convertB = 'FIRE';
                                particlesToCreate.push({ material: 'SMOKE', x: particleB.body.position.x, y: particleB.body.position.y });
                            }
                            break;
                        case 'EXPLODE':
                            // Gas explodes with fire - create large fire spread
                            removeA = true;
                            removeB = true;
                            const explodeX = (particleA.body.position.x + particleB.body.position.x) / 2;
                            const explodeY = (particleA.body.position.y + particleB.body.position.y) / 2;
                            // Create multiple fire particles in explosion
                            for (let k = 0; k < 5; k++) {
                                const angle = Math.random() * Math.PI * 2;
                                const radius = Math.random() * 20;
                                particlesToCreate.push({
                                    material: 'FIRE',
                                    x: explodeX + Math.cos(angle) * radius,
                                    y: explodeY + Math.sin(angle) * radius
                                });
                            }
                            createExplosionEffect(explodeX, explodeY);
                            break;
                        case 'MELT_METAL':
                            // Metal melts with lava
                            if (particleA.materialType === 'METAL') {
                                removeA = true;
                            } else if (particleB.materialType === 'METAL') {
                                removeB = true;
                            }
                            break;
                        case 'SHATTER':
                            // Glass shatters
                            if (particleA.materialType === 'GLASS') {
                                removeA = true;
                                // Create small glass fragments (visual effect)
                                createShatterEffect(particleA.body.position.x, particleA.body.position.y);
                            } else if (particleB.materialType === 'GLASS') {
                                removeB = true;
                                createShatterEffect(particleB.body.position.x, particleB.body.position.y);
                            }
                            break;
                        case 'IGNITE':
                            // IGNITE is now handled by heat system, but keep for direct collision reactions
                            // Only handle immediate collisions, not proximity
                            break;
                    }
                }
                
                // Check materialB reactions
                if (!removeA && !removeB && !convertA && !convertB && materialB.reactions && materialB.reactions[materialA.id]) {
                    reactionType = materialB.reactions[materialA.id];
                    switch (reactionType) {
                        case 'EVAPORATE':
                            removeA = true;
                            removeB = true;
                            particlesToCreate.push({ material: 'STEAM', x: (particleA.body.position.x + particleB.body.position.x) / 2, y: (particleA.body.position.y + particleB.body.position.y) / 2 });
                            break;
                        case 'EXTINGUISH':
                            removeB = true;
                            break;
                        case 'EXTINGUISH_PARTIAL':
                            // Smoke partially extinguishes fire
                            if (particleB.materialType === 'SMOKE' && particleA.materialType === 'FIRE' && Math.random() < 0.3) {
                                removeA = true;
                            } else if (particleA.materialType === 'SMOKE' && particleB.materialType === 'FIRE' && Math.random() < 0.3) {
                                removeB = true;
                            }
                            break;
                        case 'CORRODE':
                            removeA = true;
                            break;
                        case 'DISSOLVE':
                            removeA = true;
                            break;
                        case 'BURN':
                            if (particleB.materialType === 'WOOD') {
                                removeB = true;
                                convertB = 'FIRE';
                                particlesToCreate.push({ material: 'SMOKE', x: particleB.body.position.x, y: particleB.body.position.y });
                            } else if (particleA.materialType === 'WOOD') {
                                removeA = true;
                                convertA = 'FIRE';
                                particlesToCreate.push({ material: 'SMOKE', x: particleA.body.position.x, y: particleA.body.position.y });
                            }
                            break;
                        case 'EXPLODE':
                            removeA = true;
                            removeB = true;
                            const explodeX = (particleA.body.position.x + particleB.body.position.x) / 2;
                            const explodeY = (particleA.body.position.y + particleB.body.position.y) / 2;
                            for (let k = 0; k < 5; k++) {
                                const angle = Math.random() * Math.PI * 2;
                                const radius = Math.random() * 20;
                                particlesToCreate.push({
                                    material: 'FIRE',
                                    x: explodeX + Math.cos(angle) * radius,
                                    y: explodeY + Math.sin(angle) * radius
                                });
                            }
                            createExplosionEffect(explodeX, explodeY);
                            break;
                        case 'MELT_METAL':
                            if (particleB.materialType === 'METAL') {
                                removeB = true;
                            } else if (particleA.materialType === 'METAL') {
                                removeA = true;
                            }
                            break;
                        case 'SHATTER':
                            if (particleB.materialType === 'GLASS') {
                                removeB = true;
                                createShatterEffect(particleB.body.position.x, particleB.body.position.y);
                            } else if (particleA.materialType === 'GLASS') {
                                removeA = true;
                                createShatterEffect(particleA.body.position.x, particleA.body.position.y);
                            }
                            break;
                        case 'IGNITE':
                            // IGNITE is now handled by heat system
                            break;
                    }
                }
                
                // Handle conversions
                if (convertA && !particlesToRemove.has(particleA)) {
                    convertParticleMaterial(particleA, convertA, particleA.body.position.x, particleA.body.position.y);
                }
                if (convertB && !particlesToRemove.has(particleB)) {
                    convertParticleMaterial(particleB, convertB, particleB.body.position.x, particleB.body.position.y);
                }
                
                // Process reaction if detected
                if (removeA || removeB || convertA || convertB) {
                    const reactionX = (particleA.body.position.x + particleB.body.position.x) / 2;
                    const reactionY = (particleA.body.position.y + particleB.body.position.y) / 2;
                    
                    if (reactionType) {
                        animationsToCreate.push({
                            type: reactionType,
                            x: reactionX,
                            y: reactionY
                        });
                    }
                    
                    if (removeA) particlesToRemove.add(particleA);
                    if (removeB) particlesToRemove.add(particleB);
                    
                    // Only process one reaction per particle pair
                    break;
                }
            }
        }
    }
    
    // Create new particles (from explosions, etc.)
    particlesToCreate.forEach(creation => {
        if (creation.x > 30 && creation.x < gameWidth - 30 && creation.y > 30 && creation.y < gameHeight - 30) {
            createParticle(creation.x, creation.y, creation.material);
        }
    });
    
    // Create animations
    animationsToCreate.forEach(anim => {
        createReactionAnimation(anim.type, anim.x, anim.y, null, null);
    });
    
    // Remove reacted particles
    if (particlesToRemove.size > 0) {
        particlesToRemove.forEach(particle => {
            removeParticle(particle);
        });
    }
}

// Convert a particle from one material to another
function convertParticleMaterial(particle, newMaterialId, x, y) {
    if (!particle || !currentScene) return;
    
    const newMaterial = MATERIALS[newMaterialId];
    if (!newMaterial) return;
    
    // Remove old particle
    const index = particles.indexOf(particle);
    if (index > -1) {
        particles.splice(index, 1);
    }
    
    // Cleanup old sprite and body
    if (particle.sprite) {
        particle.sprite.destroy();
    }
    if (particle.body && currentScene) {
        currentScene.matter.world.remove(particle.body);
    }
    
    // Create new particle with new material at same position
    const newParticle = createParticle(x, y, newMaterialId);
    
    return newParticle;
}

// Spark effect for fire spreading to sand
function createSparkEffect(x, y) {
    if (!currentScene) return;
    emitEffectBurst('spark', 14, x, y);
    playReactionSound('spark', 0.8);
}

// Explosion effect for gas + fire
function createExplosionEffect(x, y) {
    if (!currentScene) return;
    
    // Apply radial force to nearby particles
    const EXPLOSION_RADIUS = 60;
    const EXPLOSION_FORCE = 0.15;
    
    particles.forEach(particle => {
        if (!particle.body || !particle.body.position) return;
        
        const dx = particle.body.position.x - x;
        const dy = particle.body.position.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < EXPLOSION_RADIUS && distance > 0) {
            // Calculate force inversely proportional to distance
            const forceMagnitude = EXPLOSION_FORCE * (1 - distance / EXPLOSION_RADIUS);
            const forceX = (dx / distance) * forceMagnitude;
            const forceY = (dy / distance) * forceMagnitude;
            
            // Apply force to push particles away
            try {
                if (typeof Matter !== 'undefined' && Matter.Body && Matter.Body.applyForce) {
                    Matter.Body.applyForce(particle.body, particle.body.position, {
                        x: forceX,
                        y: forceY
                    });
                }
            } catch (e) {
                // Fallback to velocity
                if (particle.body.velocity) {
                    particle.body.velocity.x += forceX * 50;
                    particle.body.velocity.y += forceY * 50;
                }
            }
        }
    });
    
    emitEffectBurst('spark', 28, x, y);
    emitEffectBurst('smoke', 18, x, y);
    emitEffectBurst('plasma', 12, x, y);

    playReactionSound('explosion', 1);

    // Create shockwave ring effect
    const shockwave = currentScene.add.circle(x, y, 5, 0xffff99, 0.6);
    currentScene.tweens.add({
        targets: shockwave,
        scale: 8,
        alpha: 0,
        duration: 420,
        ease: 'Power2',
        onComplete: () => {
            shockwave.destroy();
        }
    });
    
    // Create flash overlay
    const flash = currentScene.add.rectangle(x, y, 120, 120, 0xfff2b6, 0.7);
    currentScene.tweens.add({
        targets: flash,
        alpha: 0,
        scaleX: 2.6,
        scaleY: 2.6,
        duration: 160,
        ease: 'Power2',
        onComplete: () => {
            flash.destroy();
        }
    });
    
    // Camera shake effect
    if (currentScene.cameras && currentScene.cameras.main) {
        currentScene.cameras.main.flash(160, 255, 204, 80);
        currentScene.cameras.main.shake(260, 0.008);
    }
}

// Shatter effect for glass breaking
function createShatterEffect(x, y) {
    if (!currentScene) return;
    
    const fragmentCount = 8;
    for (let i = 0; i < fragmentCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 2;
        const fragment = currentScene.add.circle(x, y, 1.5, 0xadd8e6, 0.8);
        
        // Animate fragments flying outward
        currentScene.tweens.add({
            targets: fragment,
            x: x + Math.cos(angle) * speed * 20,
            y: y + Math.sin(angle) * speed * 20,
            alpha: 0,
            scale: 0.5,
            duration: 200 + Math.random() * 150,
            ease: 'Power2',
            onComplete: () => {
                fragment.destroy();
            }
        });
    }
}

// Splash effect for liquid impacts
function createSplashEffect(x, y, materialType) {
    if (!currentScene) return;
    
    const material = MATERIALS[materialType] || MATERIALS.WATER;
    const splashColor = material.color;
    const dropletCount = 8;
    
    for (let i = 0; i < dropletCount; i++) {
        // Create arc pattern - spray upward and outward
        const angle = Math.PI * (0.3 + Math.random() * 0.4); // 30-70 degrees from horizontal
        const side = i < dropletCount / 2 ? 1 : -1; // Half go left, half go right
        const speed = 2 + Math.random() * 3;
        const droplet = currentScene.add.circle(x, y, 1.5, splashColor, 0.7);
        
        const targetX = x + side * Math.cos(angle) * speed * 15;
        const targetY = y - Math.sin(angle) * speed * 20; // Negative = upward
        
        // Animate droplets in parabolic arc
        currentScene.tweens.add({
            targets: droplet,
            x: targetX,
            y: targetY,
            alpha: 0,
            scale: 0.8,
            duration: 300 + Math.random() * 200,
            ease: 'Quad.easeOut',
            onComplete: () => {
                droplet.destroy();
            }
        });
    }
}

function removeParticle(particle) {
    // Remove from particles array
    const index = particles.indexOf(particle);
    if (index > -1) {
        particles.splice(index, 1);
    }
    
    // Cleanup sprite and body
    if (particle.glowTween) {
        try {
            particle.glowTween.stop();
            if (currentScene && currentScene.tweens && currentScene.tweens.remove) {
                currentScene.tweens.remove(particle.glowTween);
            } else if (particle.glowTween.remove) {
                particle.glowTween.remove();
            }
        } catch (e) {
            // Ignore tween cleanup errors
        }
    }
    if (particle.sprite && currentScene) {
        particle.sprite.destroy();
    }
    if (particle.body && currentScene) {
        currentScene.matter.world.remove(particle.body);
    }
}

function cleanupParticles(scene) {
    const bounds = {
        left: -100,
        right: gameWidth + 100,
        top: -100,
        bottom: gameHeight + 100
    };
    
    particles = particles.filter((particle) => {
        const body = particle.body;
        if (!body || !body.position) {
            // Invalid particle, remove it
            if (particle.sprite) {
                particle.sprite.destroy();
            }
            if (particle.body && scene) {
                scene.matter.world.remove(particle.body);
            }
            return false;
        }
        
        const pos = body.position;
        
        // Remove particles that are out of bounds or fallen too far
        if (pos.x < bounds.left || pos.x > bounds.right ||
            pos.y < bounds.top || pos.y > bounds.bottom) {
            
            // Cleanup sprite and physics body
            if (particle.sprite) {
                particle.sprite.destroy();
            }
            if (particle.body && scene) {
                scene.matter.world.remove(particle.body);
            }
            return false;
        }
        
        return true;
    });
}

function resetWorldState() {
    console.log('Resetting world state locally, particles:', particles.length);
    
    // Clear batch buffer
    sandPlacementBuffer = [];
    if (batchTimer) {
        clearTimeout(batchTimer);
        batchTimer = null;
    }
    
    // Clear sync state
    syncChunks = [];
    syncTotalChunks = 0;
    syncReceivedChunks = 0;
    isReceivingSync = false;
    
    // Clear particle creation queue
    particleCreationQueue = [];
    isCreatingParticles = false;
    
    // Destroy all particle sprites and remove physics bodies
    particles.forEach((particle) => {
        if (particle.sprite) {
            particle.sprite.destroy();
        }
        if (particle.body && currentScene) {
            currentScene.matter.world.remove(particle.body);
        }
    });
    
    // Clear particles array
    particles = [];
    
    console.log('World state reset complete');
    updateParticleCount();
}

// UI Update Functions
function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connection-status');
    const indicatorEl = document.getElementById('status-indicator');
    
    if (statusEl) {
        statusEl.textContent = connected ? 'Connected' : 'Disconnected';
    }
    
    if (indicatorEl) {
        indicatorEl.className = connected ? 'status-indicator status-connected' : 'status-indicator status-disconnected';
    }
}

function updateParticleCount() {
    const countEl = document.getElementById('particle-count');
    if (countEl) {
        countEl.textContent = particles.length.toLocaleString();
    }
}

function isMaterialUnlocked(materialId) {
    return unlockedMaterials.has(materialId);
}

function unlockMaterial(materialId, reactionType = null) {
    const meta = MATERIAL_METADATA[materialId] || {};
    const alreadyUnlocked = isMaterialUnlocked(materialId);

    if (!alreadyUnlocked) {
        unlockedMaterials.add(materialId);
    }

    if (meta.eventDuration) {
        scheduleMaterialExpiry(materialId, meta.eventDuration, !alreadyUnlocked);
    }

    if (!alreadyUnlocked) {
        renderMaterialButtons();
        pingMaterialButton(materialId);
        showUnlockToast(materialId, reactionType);
    }

    if (meta.eventDuration) {
        refreshEventTimerBadges();
    }
}

function pingMaterialButton(materialId) {
    const selector = document.getElementById('material-selector');
    if (!selector) {
        return;
    }
    const button = selector.querySelector(`.material-btn[data-material="${materialId}"]`);
    if (!button) {
        return;
    }
    button.classList.add('unlock-pulse');
    if (unlockPulseTimers[materialId]) {
        clearTimeout(unlockPulseTimers[materialId]);
    }
    unlockPulseTimers[materialId] = setTimeout(() => {
        button.classList.remove('unlock-pulse');
    }, 2400);
}

function scheduleMaterialExpiry(materialId, durationMs, justUnlocked = false) {
    if (!durationMs) {
        return;
    }
    if (materialUnlockTimeouts[materialId]) {
        clearTimeout(materialUnlockTimeouts[materialId]);
    }
    const expiresAt = Date.now() + durationMs;
    materialUnlockExpiry[materialId] = expiresAt;
    materialUnlockTimeouts[materialId] = setTimeout(() => {
        lockMaterial(materialId, true);
    }, durationMs);
    ensureEventTimerLoop();
    if (justUnlocked) {
        refreshEventTimerBadges();
    }
}

function ensureEventTimerLoop() {
    if (eventTimerInterval) {
        return;
    }
    eventTimerInterval = setInterval(() => {
        if (Object.keys(materialUnlockExpiry).length === 0) {
            clearInterval(eventTimerInterval);
            eventTimerInterval = null;
            return;
        }
        refreshEventTimerBadges();
    }, 1000);
}

function refreshEventTimerBadges() {
    const selector = document.getElementById('material-selector');
    if (!selector) {
        return;
    }
    const now = Date.now();
    const timerNodes = selector.querySelectorAll('[data-event-timer]');
    timerNodes.forEach(node => {
        const materialId = node.getAttribute('data-event-timer');
        const expiry = materialUnlockExpiry[materialId];
        if (!expiry) {
            node.textContent = '';
            return;
        }
        const remaining = Math.max(0, expiry - now);
        node.textContent = formatDurationMs(remaining);
        const parentButton = node.closest('.material-btn');
        if (parentButton && !parentButton.classList.contains('locked')) {
            const meta = MATERIAL_METADATA[materialId] || {};
            const material = MATERIALS[materialId];
            if (material && meta.tier === 'event') {
                let baseTitle = material.name;
                if (meta.shortcut) {
                    baseTitle += ` (Key: ${meta.shortcut})`;
                }
                parentButton.title = `${baseTitle} • ${formatDurationMs(remaining)} remaining`;
            }
        }
    });
}

function formatDurationMs(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function lockMaterial(materialId, triggeredByExpiry = false) {
    if (!isMaterialUnlocked(materialId) || BASE_MATERIALS.includes(materialId)) {
        return;
    }
    unlockedMaterials.delete(materialId);
    if (materialUnlockTimeouts[materialId]) {
        clearTimeout(materialUnlockTimeouts[materialId]);
        delete materialUnlockTimeouts[materialId];
    }
    delete materialUnlockExpiry[materialId];

    if (currentMaterial === materialId) {
        currentMaterial = MATERIALS.SAND.id;
    }

    renderMaterialButtons();
    selectMaterial(currentMaterial);

    if (triggeredByExpiry) {
        showUnlockToast(materialId, 'EXPIRED');
    }
}

function renderMaterialButtons() {
    const container = document.getElementById('material-selector');
    if (!container) {
        return;
    }
    container.innerHTML = '';
    const entries = Object.keys(MATERIALS).sort((a, b) => {
        const orderA = MATERIAL_METADATA[a]?.order ?? 9999;
        const orderB = MATERIAL_METADATA[b]?.order ?? 9999;
        return orderA - orderB;
    });
    entries.forEach(materialId => {
        const material = MATERIALS[materialId];
        const meta = MATERIAL_METADATA[materialId] || {};
        if (!material) return;
        const button = document.createElement('button');
        button.className = 'material-btn';
        button.dataset.material = materialId;

        if (meta.tier === 'event') {
            button.classList.add('event-material');
        }

        if (!isMaterialUnlocked(materialId)) {
            button.classList.add('locked');
            button.disabled = true;
            const progress = materialUnlockCounters[materialId] || 0;
            const threshold = meta.unlockThreshold || 1;
            if (meta.unlockReaction) {
                button.title = `Unlock via ${meta.unlockReaction} (${progress}/${threshold})`;
            } else {
                button.title = `Discover via experimentation (${progress}/${threshold})`;
            }
            if (meta.tier === 'event') {
                button.title += ' • Limited-time material';
            }
        } else {
            button.disabled = false;
            const shortcutLabel = meta.shortcut ? ` (Key: ${meta.shortcut})` : '';
            button.title = `${material.name}${shortcutLabel}`;
            if (meta.tier === 'event' && materialUnlockExpiry[materialId]) {
                const remaining = Math.max(0, materialUnlockExpiry[materialId] - Date.now());
                button.title += ` • ${formatDurationMs(remaining)} remaining`;
            }
            button.addEventListener('click', (e) => {
                e.preventDefault();
                selectMaterial(materialId);
            });
        }

        const preview = document.createElement('span');
        preview.className = 'material-preview';
        preview.style.background = colorToCss(material.color, 1);

        const label = document.createElement('span');
        label.className = 'material-label';
        label.textContent = material.name;

        button.appendChild(preview);
        button.appendChild(label);

        if (meta.tier === 'event' && isMaterialUnlocked(materialId) && meta.eventDuration) {
            const timer = document.createElement('span');
            timer.className = 'material-event-timer';
            timer.setAttribute('data-event-timer', materialId);
            button.appendChild(timer);
        }

        if (materialId === currentMaterial) {
            button.classList.add('active');
        }

        container.appendChild(button);
    });
    updateToolButtons();
}

function registerReaction(reactionType, materialAId, materialBId, reactionName) {
    if (!reactionType) {
        return;
    }
    recentReactions.unshift({
        type: reactionType,
        materialA: materialAId,
        materialB: materialBId,
        name: reactionName,
        time: Date.now()
    });
    if (recentReactions.length > 25) {
        recentReactions.pop();
    }

    const unlockTargets = REACTION_UNLOCKS[reactionType];
    let requiresRefresh = false;
    if (unlockTargets) {
        unlockTargets.forEach(materialId => {
            const meta = MATERIAL_METADATA[materialId] || {};
            materialUnlockCounters[materialId] = (materialUnlockCounters[materialId] || 0) + 1;
            const threshold = meta.unlockThreshold || 1;
            if (!isMaterialUnlocked(materialId) && materialUnlockCounters[materialId] >= threshold) {
                unlockMaterial(materialId, reactionType);
            } else if (!isMaterialUnlocked(materialId)) {
                pingMaterialButton(materialId);
                requiresRefresh = true;
            }
        });
    }

    if (requiresRefresh) {
        renderMaterialButtons();
    }

    updateCommunityGoalProgress(reactionType);
}

function initializeGoalsUI() {
    const goalList = document.getElementById('goal-list');
    if (!goalList) {
        return;
    }
    goalList.innerHTML = '';
    COMMUNITY_GOALS.forEach(goal => {
        const item = document.createElement('li');
        item.className = 'goal-item';
        item.id = `goal-${goal.id}`;
        item.innerHTML = `
            <div class="goal-title">${goal.label}</div>
            <div class="goal-progress"><div class="goal-progress-bar" id="goal-bar-${goal.id}"></div></div>
            <div class="goal-count"><span id="goal-count-${goal.id}">0</span> / ${goal.target}</div>
        `;
        goalList.appendChild(item);
    });
    updateGoalsUI();
}

function updateCommunityGoalProgress(reactionType) {
    COMMUNITY_GOALS.forEach(goal => {
        if (goal.reaction === reactionType) {
            communityProgress[goal.id] = Math.min(goal.target, (communityProgress[goal.id] || 0) + 1);
        }
    });
    updateGoalsUI();
}

function updateGoalsUI() {
    COMMUNITY_GOALS.forEach(goal => {
        const progressValue = communityProgress[goal.id] || 0;
        const bar = document.getElementById(`goal-bar-${goal.id}`);
        const count = document.getElementById(`goal-count-${goal.id}`);
        const item = document.getElementById(`goal-${goal.id}`);
        const percent = Math.min(100, Math.round((progressValue / goal.target) * 100));
        if (bar) {
            bar.style.width = `${percent}%`;
        }
        if (count) {
            count.textContent = progressValue.toString();
        }
        if (item) {
            if (progressValue >= goal.target) {
                item.classList.add('completed');
            } else {
                item.classList.remove('completed');
            }
        }
    });
}

function showUnlockToast(materialId, reactionType) {
    const material = MATERIALS[materialId];
    if (!material) {
        return;
    }
    let container = document.getElementById('unlock-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'unlock-toast-container';
        container.className = 'unlock-toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'unlock-toast';
    if (reactionType === 'EXPIRED') {
        toast.textContent = `${material.name} faded away. Trigger its combo again to bring it back!`;
    } else {
        const reactionLabel = reactionType ? ` via ${reactionType}` : '';
        toast.textContent = `Unlocked ${material.name}${reactionLabel}!`;
    }
    container.appendChild(toast);
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.parentElement.removeChild(toast);
            }
        }, 400);
    }, 2800);
}

function handleReset() {
    resetWorldState();
    // Notify server to reset for all players
    if (socket && socket.connected) {
        socket.emit('resetWorld');
    }
}

function selectMaterial(materialId) {
    if (!MATERIALS[materialId]) {
        return;
    }
    if (!isMaterialUnlocked(materialId)) {
        return;
    }
    currentMaterial = materialId;
    renderMaterialButtons();
}

function setupUIHandlers() {
    const resetBtn = document.getElementById('reset-btn');
    if (resetBtn && !resetBtn.hasAttribute('data-handler-attached')) {
        resetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            handleReset();
        });
        resetBtn.setAttribute('data-handler-attached', 'true');
    }
    
    const instructionsToggle = document.getElementById('instructions-toggle');
    const instructionsPanel = document.getElementById('instructions-panel');
    if (instructionsToggle && instructionsPanel && !instructionsToggle.hasAttribute('data-handler-attached')) {
        instructionsToggle.addEventListener('click', (e) => {
            e.preventDefault();
            instructionsPanel.classList.toggle('hidden');
            instructionsToggle.textContent = instructionsPanel.classList.contains('hidden') 
                ? 'Show Instructions' 
                : 'Hide Instructions';
        });
        instructionsToggle.setAttribute('data-handler-attached', 'true');
    }

    const missionsToggle = document.getElementById('missions-toggle');
    const goalsPanel = document.getElementById('goals-panel');
    if (missionsToggle && goalsPanel && !missionsToggle.hasAttribute('data-handler-attached')) {
        missionsToggle.addEventListener('click', (e) => {
            e.preventDefault();
            goalsPanel.classList.toggle('hidden');
            missionsToggle.textContent = goalsPanel.classList.contains('hidden')
                ? 'Show Goals'
                : 'Hide Goals';
        });
        missionsToggle.setAttribute('data-handler-attached', 'true');
    }

    setupToolHandlers();
}

function setupToolHandlers() {
    const toolButtons = document.querySelectorAll('.tool-btn');
    toolButtons.forEach(btn => {
        if (!btn.hasAttribute('data-handler-attached')) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const toolId = btn.dataset.tool;
                if (toolId) {
                    selectTool(toolId);
                }
            });
            btn.setAttribute('data-handler-attached', 'true');
        }
    });
    updateToolButtons();

    const brushSlider = document.getElementById('brush-size');
    if (brushSlider && !brushSlider.hasAttribute('data-handler-attached')) {
        brushSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value, 10);
            brushSize = Math.max(2, Math.min(60, value));
            updateBrushSizeUI();
        });
        brushSlider.setAttribute('data-handler-attached', 'true');
    }
    updateBrushSizeUI();
}

// Initialize UI - run immediately if DOM is ready, otherwise wait
function initializeUI() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeUI);
        return;
    }
    renderMaterialButtons();
    updateToolButtons();
    updateBrushSizeUI();
    setupUIHandlers();
    initializeGoalsUI();
    updateParticleCount();
    updateConnectionStatus(false);
    selectMaterial(currentMaterial);
}

// Start initialization
initializeUI();

// Handle window resize
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        // Note: Phaser games typically require recreation for size changes
        // For now, we'll just update the container styling
        // A full resize would require recreating the game instance
    }, 250);
});

// Handle orientation change on mobile
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        window.location.reload();
    }, 500);
});


