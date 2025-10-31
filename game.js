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
        density: 0.001,
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
        density: 0.0005, // Lower density = floats/flows faster
        friction: 0.1, // Low friction = flows easier
        restitution: 0.2,
        physics: {
            // Water flows faster
        },
        reactions: {
            FIRE: 'EVAPORATE' // Water + Fire = both disappear
        }
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
            WATER: 'EVAPORATE', // Fire + Water = both disappear
            SAND: 'IGNITE' // Fire + Sand = sand catches fire (spreads)
        },
        spreadReactions: {
            SAND: 'IGNITE' // Fire spreads to nearby sand
        }
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
            SAND: 'CORRODE' // Acid + Sand = sand disappears, acid remains
        }
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
    
    // Keyboard input for reset (R key)
    this.input.keyboard.on('keydown-R', () => {
        console.log('Reset triggered by R key');
        handleReset();
    });
    
    // Keyboard shortcuts for material selection (1-4)
    // Use key codes directly: 49='1', 50='2', 51='3', 52='4'
    this.input.keyboard.on('keydown', (event) => {
        if (event.keyCode === 49 || event.key === '1') {
            selectMaterial('SAND');
        } else if (event.keyCode === 50 || event.key === '2') {
            selectMaterial('WATER');
        } else if (event.keyCode === 51 || event.key === '3') {
            selectMaterial('FIRE');
        } else if (event.keyCode === 52 || event.key === '4') {
            selectMaterial('ACID');
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
        color: material.color // Keep for backward compatibility
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
    
    // Track particles to remove and animations to create
    const particlesToRemove = new Set();
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
        let reactionName = null;
        
        // Check if materialA has a reaction with materialB
        if (materialA.reactions && materialA.reactions[materialB.id]) {
            reactionType = materialA.reactions[materialB.id];
            reactionName = `${materialA.name}+${materialB.name}`;
            
            switch (reactionType) {
                case 'EVAPORATE':
                    // Both disappear
                    removeA = true;
                    removeB = true;
                    break;
                        case 'EXTINGUISH':
                            // Only materialA disappears (fire gets extinguished)
                            removeA = true;
                            break;
                        case 'CORRODE':
                            // Only materialB disappears (sand gets corroded by acid)
                            removeB = true;
                            break;
                        case 'IGNITE':
                            // Fire ignites sand - convert sand to fire
                            if (particleA.materialType === 'FIRE' && particleB.materialType === 'SAND') {
                                // Convert particleB to fire
                                convertParticleMaterial(particleB, 'FIRE', particleB.body.position.x, particleB.body.position.y);
                                createSparkEffect(particleB.body.position.x, particleB.body.position.y);
                            }
                            // Don't remove particles, just convert
                            break;
            }
        }
        
        // Check if materialB has a reaction with materialA (check reverse)
        if (!removeA && !removeB && materialB.reactions && materialB.reactions[materialA.id]) {
            reactionType = materialB.reactions[materialA.id];
            reactionName = `${materialB.name}+${materialA.name}`;
            
            switch (reactionType) {
                case 'EVAPORATE':
                    removeA = true;
                    removeB = true;
                    break;
                        case 'EXTINGUISH':
                            // Only materialB disappears (fire gets extinguished)
                            removeB = true;
                            break;
                        case 'CORRODE':
                            // Only materialA disappears (sand gets corroded by acid)
                            removeA = true;
                            break;
                        case 'IGNITE':
                            // Fire ignites sand - convert sand to fire
                            if (particleB.materialType === 'FIRE' && particleA.materialType === 'SAND') {
                                // Convert particleA to fire
                                convertParticleMaterial(particleA, 'FIRE', particleA.body.position.x, particleA.body.position.y);
                                createSparkEffect(particleA.body.position.x, particleA.body.position.y);
                            }
                            // Don't remove particles, just convert
                            break;
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
            
            // Mark particles for removal
            if (removeA && !particlesToRemove.has(particleA)) {
                particlesToRemove.add(particleA);
            }
            if (removeB && !particlesToRemove.has(particleB)) {
                particlesToRemove.add(particleB);
            }
        }
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

// Track particles that have already been processed for spreading this frame
const processedSpreadParticles = new Set();

// Proximity-based reaction check (backup system)
function checkProximityReactions() {
    if (!currentScene || particles.length < 2) {
        return;
    }
    
    const REACTION_DISTANCE = 8; // Distance threshold for reactions
    const FIRE_SPREAD_DISTANCE = 12; // Fire spreads to sand within this distance
    const particlesToRemove = new Set();
    const particlesToConvert = []; // Particles to convert (e.g., sand -> fire)
    const animationsToCreate = [];
    
    // Clear processed spread particles periodically
    processedSpreadParticles.clear();
    
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
            
            // Check for fire spread (fire ignites nearby sand)
            const materialA = MATERIALS[particleA.materialType];
            const materialB = MATERIALS[particleB.materialType];
            
            if (!materialA || !materialB) continue;
            
            // Fire spreads to sand
            if (particleA.materialType === 'FIRE' && particleB.materialType === 'SAND' && distance < FIRE_SPREAD_DISTANCE) {
                if (!processedSpreadParticles.has(particleB)) {
                    particlesToConvert.push({
                        particle: particleB,
                        newMaterial: 'FIRE',
                        x: particleB.body.position.x,
                        y: particleB.body.position.y
                    });
                    processedSpreadParticles.add(particleB);
                }
            } else if (particleB.materialType === 'FIRE' && particleA.materialType === 'SAND' && distance < FIRE_SPREAD_DISTANCE) {
                if (!processedSpreadParticles.has(particleA)) {
                    particlesToConvert.push({
                        particle: particleA,
                        newMaterial: 'FIRE',
                        x: particleA.body.position.x,
                        y: particleA.body.position.y
                    });
                    processedSpreadParticles.add(particleA);
                }
            }
            
            // If particles are close enough, check for other reactions
            if (distance < REACTION_DISTANCE) {
                // Check if materials react
                let reactionType = null;
                let removeA = false;
                let removeB = false;
                
                // Check materialA reactions
                if (materialA.reactions && materialA.reactions[materialB.id]) {
                    reactionType = materialA.reactions[materialB.id];
                    switch (reactionType) {
                        case 'EVAPORATE':
                            removeA = true;
                            removeB = true;
                            break;
                        case 'EXTINGUISH':
                            removeA = true;
                            break;
                        case 'CORRODE':
                            removeB = true;
                            break;
                        case 'IGNITE':
                            // Fire ignites sand - convert sand to fire
                            if (particleA.materialType === 'FIRE' && particleB.materialType === 'SAND') {
                                if (!processedSpreadParticles.has(particleB)) {
                                    particlesToConvert.push({
                                        particle: particleB,
                                        newMaterial: 'FIRE',
                                        x: particleB.body.position.x,
                                        y: particleB.body.position.y
                                    });
                                    processedSpreadParticles.add(particleB);
                                }
                            }
                            break;
                    }
                }
                
                // Check materialB reactions
                if (!removeA && !removeB && materialB.reactions && materialB.reactions[materialA.id]) {
                    reactionType = materialB.reactions[materialA.id];
                    switch (reactionType) {
                        case 'EVAPORATE':
                            removeA = true;
                            removeB = true;
                            break;
                        case 'EXTINGUISH':
                            removeB = true;
                            break;
                        case 'CORRODE':
                            removeA = true;
                            break;
                        case 'IGNITE':
                            // Fire ignites sand - convert sand to fire
                            if (particleB.materialType === 'FIRE' && particleA.materialType === 'SAND') {
                                if (!processedSpreadParticles.has(particleA)) {
                                    particlesToConvert.push({
                                        particle: particleA,
                                        newMaterial: 'FIRE',
                                        x: particleA.body.position.x,
                                        y: particleA.body.position.y
                                    });
                                    processedSpreadParticles.add(particleA);
                                }
                            }
                            break;
                    }
                }
                
                // Process reaction if detected (excluding IGNITE which is handled above)
                if (removeA || removeB) {
                    const reactionX = (particleA.body.position.x + particleB.body.position.x) / 2;
                    const reactionY = (particleA.body.position.y + particleB.body.position.y) / 2;
                    
                    animationsToCreate.push({
                        type: reactionType,
                        x: reactionX,
                        y: reactionY
                    });
                    
                    if (removeA) particlesToRemove.add(particleA);
                    if (removeB) particlesToRemove.add(particleB);
                    
                    // Only process one reaction per particle pair
                    break;
                }
            }
        }
    }
    
    // Convert particles (sand -> fire for fire spread)
    particlesToConvert.forEach(conversion => {
        convertParticleMaterial(conversion.particle, conversion.newMaterial, conversion.x, conversion.y);
        // Create small spark effect
        createSparkEffect(conversion.x, conversion.y);
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

