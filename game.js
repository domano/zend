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
            LAVA: 'SOLIDIFY' // Water + Lava = lava solidifies to stone
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
            GAS: 'EXPLODE' // Fire + Gas = explosion
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
            METAL: 'CONDENSE' // Steam + Metal = steam condenses on cold metal
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
            METAL: 'MELT_METAL' // Lava + Metal = metal melts
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
            STEAM: 'SEPARATE' // Gas + Steam = separate (both rise)
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
            LAVA: 'MELT_METAL', // Metal + Lava = metal melts
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
            METAL: 'IMPACT_SHATTER' // Glass + Metal = glass shatters from high impact
        },
        ignitionThreshold: 200, // Glass doesn't burn
        heatRate: 0.5, // Slow to heat up
        impactShatterThreshold: 3.0 // Minimum impact velocity to shatter
    }
};

// Current selected material (default to SAND)
let currentMaterial = MATERIALS.SAND.id;

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
    
    // Use a small canvas to generate the particle texture
    const textureSize = Math.max(16, PARTICLE_RADIUS * 2 + 2); // Ensure minimum size
    const graphics = scene.add.graphics();
    
    // Draw a filled circle with material color
    graphics.fillStyle(material.color, 1);
    graphics.fillCircle(textureSize / 2, textureSize / 2, PARTICLE_RADIUS);
    
    // Generate texture from graphics
    graphics.generateTexture(textureKey, textureSize, textureSize);
    
    // Destroy the graphics object as we only needed it to generate the texture
    graphics.destroy();
    
    return textureKey;
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
        // Prevent default browser behaviors
        if (pointer.event && pointer.event.preventDefault) {
            pointer.event.preventDefault();
        }
        placeSand(pointer.x, pointer.y);
    });
    
    this.input.on('pointermove', (pointer) => {
        if (pointer.isDown) {
            placeSand(pointer.x, pointer.y);
        }
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
    // Use key codes directly: 49='1', 50='2', 51='3', 52='4', 53='5', 54='6', 55='7', 56='8'
    // 81='Q', 87='W', 69='E', 82='R', 84='T', 89='Y'
    this.input.keyboard.on('keydown', (event) => {
        if (event.keyCode === 49 || event.key === '1') {
            selectMaterial('SAND');
        } else if (event.keyCode === 50 || event.key === '2') {
            selectMaterial('WATER');
        } else if (event.keyCode === 51 || event.key === '3') {
            selectMaterial('FIRE');
        } else if (event.keyCode === 52 || event.key === '4') {
            selectMaterial('ACID');
        } else if (event.keyCode === 53 || event.key === '5') {
            selectMaterial('ICE');
        } else if (event.keyCode === 54 || event.key === '6') {
            selectMaterial('OIL');
        } else if (event.keyCode === 55 || event.key === '7') {
            selectMaterial('STEAM');
        } else if (event.keyCode === 56 || event.key === '8') {
            selectMaterial('LAVA');
        } else if (event.keyCode === 81 || event.key === 'q' || event.key === 'Q') {
            selectMaterial('WOOD');
        } else if (event.keyCode === 87 || event.key === 'w' || event.key === 'W') {
            selectMaterial('STONE');
        } else if (event.keyCode === 69 || event.key === 'e' || event.key === 'E') {
            selectMaterial('GAS');
        } else if (event.keyCode === 82 || event.key === 'r' || event.key === 'R') {
            selectMaterial('METAL');
        } else if (event.keyCode === 84 || event.key === 't' || event.key === 'T') {
            selectMaterial('SMOKE');
        } else if (event.keyCode === 89 || event.key === 'y' || event.key === 'Y') {
            selectMaterial('GLASS');
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
    // Don't place near boundaries (scale with game dimensions)
    const margin = 25;
    if (x < margin || x > gameWidth - margin || y < margin || y > gameHeight - margin) {
        return;
    }
    
    // Create local particle with currently selected material
    const material = MATERIALS[currentMaterial] || MATERIALS.SAND;
    const particle = createParticle(x, y, currentMaterial);
    
    if (!particle) {
        return;
    }
    
    // Add to batch buffer with material type
    if (socket && socket.connected) {
        sandPlacementBuffer.push({ 
            x, 
            y, 
            materialType: currentMaterial,
            color: material.color // Keep for backward compatibility
        });
        
        // Flush buffer if it reaches threshold
        if (sandPlacementBuffer.length >= BATCH_SIZE) {
            flushSandBatch();
        } else if (!batchTimer) {
            // Schedule flush if not already scheduled
            batchTimer = setTimeout(flushSandBatch, BATCH_INTERVAL);
        }
    }
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
        previousVelocityY: 0 // Track previous velocity for impact detection
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
            
            // Mark particles for removal
            if (removeA && !particlesToRemove.has(particleA)) {
                particlesToRemove.add(particleA);
            }
            if (removeB && !particlesToRemove.has(particleB)) {
                particlesToRemove.add(particleB);
            }
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
    }
}

// Steam effect for water + fire
function createSteamEffect(x, y) {
    if (!currentScene) return;
    
    const steamCount = 5;
    for (let i = 0; i < steamCount; i++) {
        const offsetX = (Math.random() - 0.5) * 20;
        const offsetY = (Math.random() - 0.5) * 20;
        const steam = currentScene.add.circle(x + offsetX, y + offsetY, 2, 0xffffff, 0.6);
        
        // Animate steam rising
        currentScene.tweens.add({
            targets: steam,
            y: y - 40 - Math.random() * 20,
            x: x + offsetX + (Math.random() - 0.5) * 15,
            alpha: 0,
            scale: 1.5,
            duration: 400 + Math.random() * 200,
            ease: 'Power2',
            onComplete: () => {
                steam.destroy();
            }
        });
    }
}

// Smoke effect for fire extinguished
function createSmokeEffect(x, y) {
    if (!currentScene) return;
    
    const smokeCount = 3;
    for (let i = 0; i < smokeCount; i++) {
        const offsetX = (Math.random() - 0.5) * 15;
        const offsetY = (Math.random() - 0.5) * 15;
        const smoke = currentScene.add.circle(x + offsetX, y + offsetY, 3, 0x555555, 0.7);
        
        // Animate smoke rising and fading
        currentScene.tweens.add({
            targets: smoke,
            y: y - 30 - Math.random() * 15,
            x: x + offsetX + (Math.random() - 0.5) * 10,
            alpha: 0,
            scale: 2,
            duration: 300 + Math.random() * 150,
            ease: 'Power2',
            onComplete: () => {
                smoke.destroy();
            }
        });
    }
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
    
    const sparkCount = 2;
    for (let i = 0; i < sparkCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 2;
        const offsetX = Math.cos(angle) * 5;
        const offsetY = Math.sin(angle) * 5;
        const spark = currentScene.add.circle(x + offsetX, y + offsetY, 1, 0xffaa00, 0.8);
        
        // Animate spark
        currentScene.tweens.add({
            targets: spark,
            x: x + offsetX + Math.cos(angle) * 10,
            y: y + offsetY + Math.sin(angle) * 10,
            alpha: 0,
            scale: 0.5,
            duration: 150 + Math.random() * 100,
            ease: 'Power2',
            onComplete: () => {
                spark.destroy();
            }
        });
    }
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
    
    // Create visual explosion effects with more particles and colors
    const explosionCount = 20;
    for (let i = 0; i < explosionCount; i++) {
        const angle = (Math.PI * 2 / explosionCount) * i + Math.random() * 0.3;
        const speed = 3 + Math.random() * 5;
        const offsetX = Math.cos(angle) * 3;
        const offsetY = Math.sin(angle) * 3;
        
        // Vary colors for more dramatic effect
        const colors = [0xff6600, 0xff4400, 0xffaa00, 0xff0000];
        const color = colors[Math.floor(Math.random() * colors.length)];
        const spark = currentScene.add.circle(x + offsetX, y + offsetY, 2, color, 0.9);
        
        // Animate explosion outward
        currentScene.tweens.add({
            targets: spark,
            x: x + Math.cos(angle) * speed * 20,
            y: y + Math.sin(angle) * speed * 20,
            alpha: 0,
            scale: 0.3,
            duration: 350 + Math.random() * 250,
            ease: 'Power2',
            onComplete: () => {
                spark.destroy();
            }
        });
    }
    
    // Create shockwave ring effect
    const shockwave = currentScene.add.circle(x, y, 5, 0xffff00, 0.5);
    currentScene.tweens.add({
        targets: shockwave,
        scale: 8,
        alpha: 0,
        duration: 400,
        ease: 'Power2',
        onComplete: () => {
            shockwave.destroy();
        }
    });
    
    // Create flash effect
    const flash = currentScene.add.circle(x, y, 40, 0xffff00, 0.7);
    currentScene.tweens.add({
        targets: flash,
        alpha: 0,
        scale: 2.5,
        duration: 120,
        ease: 'Power2',
        onComplete: () => {
            flash.destroy();
        }
    });
    
    // Camera shake effect
    if (currentScene.cameras && currentScene.cameras.main) {
        currentScene.cameras.main.shake(200, 0.005);
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
    
    currentMaterial = materialId;
    
    // Update UI buttons
    const materialButtons = document.querySelectorAll('.material-btn');
    materialButtons.forEach(btn => {
        if (btn.dataset.material === materialId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
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
    
    // Material selector buttons
    const materialButtons = document.querySelectorAll('.material-btn');
    materialButtons.forEach(btn => {
        if (!btn.hasAttribute('data-handler-attached')) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const materialId = btn.dataset.material;
                if (materialId) {
                    selectMaterial(materialId);
                }
            });
            btn.setAttribute('data-handler-attached', 'true');
        }
    });
}

// Initialize UI - run immediately if DOM is ready, otherwise wait
function initializeUI() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeUI);
        return;
    }
    updateParticleCount();
    updateConnectionStatus(false);
    setupUIHandlers();
    // Initialize material selector to default (SAND)
    selectMaterial('SAND');
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


