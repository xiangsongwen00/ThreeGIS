﻿import * as THREE from 'three';
import { MathProj } from '../math/proj.js';
import { ImageryTiles } from '../maptiles/imageryTiles.js';
import { resolveBaseMapConfig } from '../maptiles/basemaps.js';
import { TerrainTile } from './TerrainTile.js';
import { TerrainEditor } from './TerrainEditor.js';
import { MultipleTerrainEditorEditor } from './MultipleTerrainEditorEditor.js';
import { TerrainMapAtlas } from './TerrainMapAtlas.js';
import { MapDrapeLodVisualizer } from './MapDrapeLodVisualizer.js';

/**
 * Terrain renderer and editor integration.
 *
 * Rendering path: base terrain material imagery + shader atlas patch (no overlay).
 */
export class Terrain {
    /** @type {MathProj|null} */
    proj = null;
    /** @type {THREE.WebGLRenderer|null} */
    renderer = null;
    /** @type {THREE.Group|null} */
    terrainGroup = null;
    /** @type {TerrainMapAtlas|null} */
    mapAtlas = null;
    /** @type {ImageryTiles|null} */
    imageryTilesAtlas = null;
    /** @type {boolean} */
    _terrainImageryDisabled = false;
    /** @type {THREE.Texture|null} */
    _atlasDummyTexture = null;

    // Terrain "switch":
    // - true  => render real elevation from terrain-rgb heightmaps
    // - false => render a flat plane at y=0 (treat terrain as 0)
    terrainEnabled = true;

    /**
     * @param {THREE.Scene} scene
     * @param {Object} config
     * @param {Function} onTerrainLoaded
     */
    constructor(scene, config, onTerrainLoaded) {
        this.scene = scene;
        this.config = { ...(config || {}) };
        this.onTerrainLoaded = onTerrainLoaded;

        this._baseMap = resolveBaseMapConfig(this.config);
        // Apply provider-recommended defaults only when user didn't explicitly set them.
        const applyDefault = (key, value) => {
            if (value === undefined || value === null) return;
            if (this.config[key] === undefined || this.config[key] === null) this.config[key] = value;
        };
        applyDefault('mapMaxConcurrent', this._baseMap?.mapMaxConcurrent);
        applyDefault('mapRateLimitBurst', this._baseMap?.mapRateLimitBurst);
        applyDefault('mapRateLimitWindowMs', this._baseMap?.mapRateLimitWindowMs);
        applyDefault('mapRateLimitCooldownMs', this._baseMap?.mapRateLimitCooldownMs);
        applyDefault('mapRetryCount', this._baseMap?.mapRetryCount);
        applyDefault('mapRetryBaseDelayMs', this._baseMap?.mapRetryBaseDelayMs);
        applyDefault('mapRetryMaxDelayMs', this._baseMap?.mapRetryMaxDelayMs);

        if (this._baseMap?.baseMapType) {
            const url = String(this._baseMap?.mapTileUrl ?? '');
            const needsToken =
                url.includes('{token}') ||
                url.includes('{key}') ||
                url.includes('{apiKey}') ||
                url.includes('{apikey}') ||
                url.includes('{accessToken}') ||
                url.includes('{access_token}');
            if (needsToken && !this._baseMap.templateToken) {
                console.warn(`[Terrain] baseMapType="${this._baseMap.baseMapType}" requires a token; set config.mapToken (or provider token).`);
            }
        }

        // Terrain surface version: increments whenever heightmaps/geometry are updated due to stitching etc.
        this.surfaceVersion = 0;

        // 
        this.tileConfig = {
            zoom: this.config?.terrainZoom ?? 13,
            tileUrl: 'https://tiles1.geovisearth.com/base/v1/terrain-rgb/{z}/{x}/{y}?format=png&tmsIds=w&token=a1b140c94dba53eef3541ed85e72e2df16bfa63d8065f0d8a6e16604a035cbe0',
            // Satellite/imagery drape (XYZ)
            // Max imagery zoom (upper bound). Prefer `config.maxMapZoom`; `config.mapZoom` kept as fallback.
            maxMapZoom: this.config?.maxMapZoom ?? this.config?.mapZoom ?? 18,
            // Effective map tile source (resolved from baseMapType / user mapTileUrl / defaults).
            mapTileUrl: this._baseMap?.mapTileUrl ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
            // URL scheme for `{y}` in mapTileUrl:
            // - 'xyz' (default): y origin at top
            // - 'tms': y origin at bottom (flip y index)
            mapYtype: this._baseMap?.mapYtype ?? (this.config?.mapYtype ?? this.config?.mapYType ?? this.config?.mapTileScheme ?? 'xyz'),
            // Optional: subdomains for `{s}` (e.g. 'abc' or ['a','b','c'] or 'mt0,mt1,mt2,mt3')
            mapSubdomains: this._baseMap?.mapSubdomains ?? (this.config?.mapSubdomains ?? this.config?.mapSubDomains ?? null),
            // Token for providers that require it. Used to fill `{token}` / `{key}` / `{accessToken}` etc.
            mapToken: this._baseMap?.templateToken ?? this.config?.mapToken ?? this.config?.token ?? this.config?.key ?? null,
            // Rate limiting / retries for strict providers (e.g. Tianditu):
            // - "over 100 requests -> pause 1s" by default.
            mapRateLimitBurst: this.config?.mapRateLimitBurst ?? 100,
            mapRateLimitWindowMs: this.config?.mapRateLimitWindowMs ?? 1000,
            mapRateLimitCooldownMs: this.config?.mapRateLimitCooldownMs ?? 1000,
            mapRetryCount: this.config?.mapRetryCount ?? 2,
            mapRetryBaseDelayMs: this.config?.mapRetryBaseDelayMs ?? 250,
            mapRetryMaxDelayMs: this.config?.mapRetryMaxDelayMs ?? 2000,
             // Prevent exploding requests when mapZoom >> terrainZoom (e.g. 18 vs 13 => 32x32 tiles).
             // We only mosaic up to 2 zoom levels by default (max 4x4 tiles per terrain tile).
             mapMaxZoomDiff: this.config?.mapMaxZoomDiff ?? 2,
            tileSize: 256,
            segments: 64,
            editSegments: 256,
            boundarySamplesPerEdge: 50,
            mapDrapeViewportPadTiles :2,
            patchSubdiv: 20,
            // Avoid building walls when height difference is tiny (meters)
            wallMinHeight: 0.01
        };

        // 
        this.initProj();

        // 
        this.initTerrain();

        // Default: enable real terrain elevation.
        this.terrainEnabled = true;

        // 
        this.loadedTiles = 0;
        this.totalTilesToLoad = 0;

        // Pre-compute terrain load radius from configured AOI (meters) at terrain zoom.
        // These locals are referenced by the legacy block below; the results are stored on `this.*`.
        const zoom = this.tileConfig.zoom;
        const tileCenter = this.proj?.lonLatToTile?.(this.config.centerLon, this.config.centerLat, zoom);
        if (!tileCenter) {
            // Fallback to 3x3 if projection is not ready for any reason.
            this._terrainLoadRadiusX = 1;
            this._terrainLoadRadiusY = 1;
            this.loadTerrainTiles();
            return;
        }

        //  1x1
        // rangeEastWest/rangeNorthSouth  2*range
        const bounds0 = this.proj.tileToMercatorBounds(tileCenter.x, tileCenter.y, zoom);
        const tileW = Math.abs(bounds0.max.x - bounds0.min.x);
        const tileH = Math.abs(bounds0.max.y - bounds0.min.y);
        const halfW = tileW * 0.5;
        const halfH = tileH * 0.5;

        const rangeEW = Number.isFinite(this.config?.rangeEastWest) ? this.config.rangeEastWest : null;
        const rangeNS = Number.isFinite(this.config?.rangeNorthSouth) ? this.config.rangeNorthSouth : null;

        // Default: 3x3
        this._terrainLoadRadiusX = 1;
        this._terrainLoadRadiusY = 1;
        if (rangeEW !== null) this._terrainLoadRadiusX = Math.max(0, Math.ceil(Math.max(0, rangeEW - halfW) / tileW));
        if (rangeNS !== null) this._terrainLoadRadiusY = Math.max(0, Math.ceil(Math.max(0, rangeNS - halfH) / tileH));

        // 
        this.loadTerrainTiles();
    }


    _markSurfaceDirty() {
        // Keep it as a monotonically increasing int (wrap is fine).
        this.surfaceVersion = (this.surfaceVersion + 1) | 0;
    }

    /**
     * Initialize projection utilities.
     */
    initProj() {
        this.proj = new MathProj({
            centerLon: this.config.centerLon,
            centerLat: this.config.centerLat
        });
    }

    /**
     * Initialize terrain state (groups, caches, editor, imagery loader).
     */
    initTerrain() {
        // 
        this.terrainGroup = new THREE.Group();
        this.scene.add(this.terrainGroup);

        // 
        this.loadedTilesCount = 0;
        this.totalTilesToLoad = 0;



        // 
        this.tileMap = new Map(); // key -> TerrainTile

        // Satellite imagery: concurrency-limited + LRU cached loader
        this.imageryTiles = new ImageryTiles({
            tileUrl: this.tileConfig.mapTileUrl,
            tileScheme: this.tileConfig.mapYtype,
            subdomains: this.tileConfig.mapSubdomains,
            token: this.tileConfig.mapToken,
            rateLimitBurst: this.tileConfig.mapRateLimitBurst,
            rateLimitWindowMs: this.tileConfig.mapRateLimitWindowMs,
            rateLimitCooldownMs: this.tileConfig.mapRateLimitCooldownMs,
            retryCount: this.tileConfig.mapRetryCount,
            retryBaseDelayMs: this.tileConfig.mapRetryBaseDelayMs,
            retryMaxDelayMs: this.tileConfig.mapRetryMaxDelayMs,
            maxConcurrent: this.config?.mapMaxConcurrent ?? 8,
            maxEntries: this.config?.mapCacheSize ?? 256,
            maxAnisotropy: this.config?.mapMaxAnisotropy ?? 8,
            flipY: true
        });
        this.imageryTiles.setRenderer?.(this.renderer);

        // Dedicated tile loader for atlas patching. This lets atlas use a different URL (e.g. HiDPI tiles)
        // without polluting the base-drape cache keys (ImageryTiles caches by z/x/y only).
        const atlasTileUrl = this.config?.mapDrapeTileUrl ?? this.tileConfig.mapTileUrl;
        this.imageryTilesAtlas = new ImageryTiles({
            tileUrl: atlasTileUrl,
            tileScheme: this.tileConfig.mapYtype,
            subdomains: this.tileConfig.mapSubdomains,
            token: this.tileConfig.mapToken,
            rateLimitBurst: this.tileConfig.mapRateLimitBurst,
            rateLimitWindowMs: this.tileConfig.mapRateLimitWindowMs,
            rateLimitCooldownMs: this.tileConfig.mapRateLimitCooldownMs,
            retryCount: this.tileConfig.mapRetryCount,
            retryBaseDelayMs: this.tileConfig.mapRetryBaseDelayMs,
            retryMaxDelayMs: this.tileConfig.mapRetryMaxDelayMs,
            maxConcurrent: this.config?.mapDrapeMaxConcurrent ?? this.config?.mapMaxConcurrent ?? 8,
            maxEntries: this.config?.mapDrapeCacheSize ?? Math.max(64, (this.config?.mapCacheSize ?? 256) | 0),
            maxAnisotropy: this.config?.mapDrapeAtlasAnisotropy ?? this.config?.mapMaxAnisotropy ?? 8,
            flipY: true
        });
        this.imageryTilesAtlas.setRenderer?.(this.renderer);

        // Single rendering route: terrain material drape + shader atlas (no overlay).
        this.mapAtlas = new TerrainMapAtlas(this);
        this.lodVisualizer = new MapDrapeLodVisualizer(this);

        // Terrain editing tools
        this.editor = new TerrainEditor(this);
        this.multipleEditor = new MultipleTerrainEditorEditor(this);
    }

    metersToUnits(value) {
        return this.proj?.metersToUnits ? this.proj.metersToUnits(value) : Number(value);
    }

    unitsToMeters(value) {
        return this.proj?.unitsToMeters ? this.proj.unitsToMeters(value) : Number(value);
    }

    _scaleHeightmapInPlace(heightmap, scale) {
        const s = Number(scale);
        if (!heightmap || !Number.isFinite(s) || s === 1) return heightmap;
        for (let i = 0; i < heightmap.length; i++) {
            heightmap[i] = heightmap[i] * s;
        }
        return heightmap;
    }

    /**
     * 
     */
    loadTerrainTiles() {
        // Local scene: load ONLY tiles that intersect the configured AOI bounds (centerLon/Lat + ranges in meters).
        const debug = this.config?.terrainDebugLogs ?? false;
        const zoom = this.tileConfig.zoom;

        const ew = Number.isFinite(this.config?.rangeEastWest) ? this.config.rangeEastWest : null;
        const ns = Number.isFinite(this.config?.rangeNorthSouth) ? this.config.rangeNorthSouth : null;
        const c = this.proj?.centerMercator;

        let minX = null, maxX = null, minY = null, maxY = null;

        if (ew !== null && ns !== null && c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
            const west = c.x - ew;
            const east = c.x + ew;
            const south = c.y - ns;
            const north = c.y + ns;
            const nw = this.proj.mercatorToLonLat(west, north);
            const se = this.proj.mercatorToLonLat(east, south);
            const t1 = this.proj.lonLatToTile(nw.lon, nw.lat, zoom);
            const t2 = this.proj.lonLatToTile(se.lon, se.lat, zoom);
            minX = Math.min(t1.x, t2.x);
            maxX = Math.max(t1.x, t2.x);
            minY = Math.min(t1.y, t2.y);
            maxY = Math.max(t1.y, t2.y);

            const pad = Math.max(0, (this.config?.terrainBoundsPaddingTiles ?? 0) | 0);
            minX -= pad;
            maxX += pad;
            minY -= pad;
            maxY += pad;
        } else {
            // Fallback: legacy center-tile radius logic (3x3 or computed radius).
            const { centerLon, centerLat } = this.config;
            const tileCenter = this.proj.lonLatToTile(centerLon, centerLat, zoom);
            const radiusX = Number.isFinite(this._terrainLoadRadiusX) ? this._terrainLoadRadiusX : 1;
            const radiusY = Number.isFinite(this._terrainLoadRadiusY) ? this._terrainLoadRadiusY : 1;
            minX = tileCenter.x - radiusX;
            maxX = tileCenter.x + radiusX;
            minY = tileCenter.y - radiusY;
            maxY = tileCenter.y + radiusY;
        }

        // 
        this.loadedTilesCount = 0;
        this.totalTilesToLoad = (maxX - minX + 1) * (maxY - minY + 1);

        if (debug) {
            console.log('=== Terrain tiles load start ===');
            console.log('terrainZoom:', zoom);
            console.log('AOI(m):', { ew, ns });
            console.log('tileRange:', { minX, maxX, minY, maxY, total: this.totalTilesToLoad });
        }

        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                if (debug) console.log(`Loading tile: ${x}, ${y}, ${zoom}`);
                this.loadTile(x, y, zoom);
            }
        }

        if (debug) console.log('=== Terrain tiles load end ===');
    }

    /**
     * 
     * @param {number} x - X
     * @param {number} y - Y
     * @param {number} z - 
     */
    loadTile(x, y, z) {
        const tileUrl = this.tileConfig.tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y);

        const loader = new THREE.TextureLoader();
        loader.setCrossOrigin?.('anonymous');
        loader.load(tileUrl, (texture) => {
            this.createTerrainFromTexture(texture, x, y, z);
            try {
                texture?.dispose?.();
            } catch {
                // ignore
            }
        }, undefined, (error) => {
            console.error('Failed to load terrain tile:', error);
        });
    }

    loadTileAsync(x, y, z, options = {}) {
        const key = `${z}-${x}-${y}`;
        if (this.tileMap?.has?.(key)) return Promise.resolve(this.tileMap.get(key));

        if (!this._terrainLoadQueue) {
            this._terrainLoadQueue = {
                maxConcurrent: Math.max(1, (this.config?.terrainMaxConcurrent ?? 4) | 0),
                inFlight: 0,
                queue: [],
                drain: () => {
                    while (this._terrainLoadQueue.inFlight < this._terrainLoadQueue.maxConcurrent && this._terrainLoadQueue.queue.length) {
                        const job = this._terrainLoadQueue.queue.shift();
                        this._terrainLoadQueue.inFlight++;
                        Promise.resolve()
                            .then(job.start)
                            .then(job.resolve, job.reject)
                            .finally(() => {
                                this._terrainLoadQueue.inFlight--;
                                this._terrainLoadQueue.drain();
                            });
                    }
                }
            };
        }

        if (!this._terrainPromises) this._terrainPromises = new Map();
        const existing = this._terrainPromises.get(key);
        if (existing) return existing;

        const promise = new Promise((resolve, reject) => {
            this._terrainLoadQueue.queue.push({
                start: () =>
                    new Promise((res, rej) => {
                        const tileUrl = this.tileConfig.tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
                        const loader = new THREE.TextureLoader();
                        loader.setCrossOrigin?.('anonymous');
                        loader.load(tileUrl, res, undefined, rej);
                    }).then((texture) => {
                        const tile = this.createTerrainFromTexture(texture, x, y, z, { dynamic: true, ...options });
                        try {
                            texture?.dispose?.();
                        } catch {
                            // ignore
                        }
                        return tile;
                    }),
                resolve,
                reject
            });
            this._terrainLoadQueue.drain();
        }).finally(() => {
            this._terrainPromises.delete(key);
        });

        this._terrainPromises.set(key, promise);
        return promise;
    }

    disposeTerrainTile(tileKey) {
        const key = String(tileKey || '');
        const tile = this.tileMap?.get?.(key);
        if (!tile) return;

        const mesh = tile.mesh;
        if (mesh?.userData?.backgroundMapCacheKey) this.imageryTiles?.unpin?.(mesh.userData.backgroundMapCacheKey);
        if (mesh?.userData?.mapCacheKey) this.imageryTiles?.unpin?.(mesh.userData.mapCacheKey);

        const label = mesh?.userData?.tileLabel;
        if (label?.parent) {
            label.parent.remove(label);
            try {
                label.material?.map?.dispose?.();
            } catch {
                // ignore
            }
            try {
                label.material?.dispose?.();
            } catch {
                // ignore
            }
        }

        if (mesh?.parent) mesh.parent.remove(mesh);

        try {
            tile.geometry?.dispose?.();
        } catch {
            // ignore
        }

        try {
            if (mesh?.material && mesh.material !== this.sharedMaterial) {
                try {
                    mesh.material.map = null;
                } catch {
                    // ignore
                }
                mesh.material.dispose?.();
            }
        } catch {
            // ignore
        }

        this.tileMap?.delete?.(key);
    }

    clearDynamicTerrainTiles() {
        if (!this.tileMap) return;
        const keys = Array.from(this.tileMap.keys());
        for (const key of keys) this.disposeTerrainTile(key);
    }

    /**
     * Create a terrain tile mesh from a terrain-rgb heightmap texture.
     * @param {THREE.Texture} texture - Terrain-RGB texture
     * @param {number} tileX - Tile X
     * @param {number} tileY - Tile Y
     * @param {number} tileZ - Terrain zoom
     */
    createTerrainFromTexture(texture, tileX, tileY, tileZ, options = {}) {
        const { segments } = this.tileConfig;
        const tileKey0 = `${tileZ}-${tileX}-${tileY}`;
        if (this.tileMap?.has?.(tileKey0)) return this.tileMap.get(tileKey0);

        // 1) Compute this tile's WebMercator bounds (meters).
        const tileBounds = this.proj.tileToMercatorBounds(tileX, tileY, tileZ);

        // 2) Tile size in meters (WebMercator).
        const tileWidthMeters = Math.abs(tileBounds.max.x - tileBounds.min.x);
        const tileHeightMeters = Math.abs(tileBounds.max.y - tileBounds.min.y);
        const tileWidth = this.metersToUnits(tileWidthMeters);
        const tileHeight = this.metersToUnits(tileHeightMeters);

        // 3) Plane geometry in tile local space.
        const geometry = new THREE.PlaneGeometry(tileWidth, tileHeight, segments, segments);

        // 4) Decode heightmap from Terrain-RGB.
        const heightmap = this.buildHeightmapFromTexture(texture, geometry, tileBounds);
        this._scaleHeightmapInPlace(heightmap, this.proj?.unitsPerMeter ?? 1);
        this.applyHeightmapToGeometry(geometry, heightmap);
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        // 5) Shared base material (per-tile map is applied by imagery loader later).
        let material = this.sharedMaterial;
        if (!material) {
            const terrainOpacity = Number.isFinite(this.config?.terrainOpacity) ? this.config.terrainOpacity : 1.0;
            const terrainTransparent = terrainOpacity < 1.0;
            const terrainColor = Number.isFinite(this.config?.terrainColor) ? this.config.terrainColor : 0x8B4513;
            material = new THREE.MeshPhongMaterial({
                color: terrainColor,
                wireframe: false,
                side: THREE.DoubleSide,
                flatShading: false,
                polygonOffset: true,
                polygonOffsetFactor: 0,
                polygonOffsetUnits: 1,

                alphaTest: 0.1,              // 
                fog: false,
                transparent: terrainTransparent,
                opacity: terrainOpacity
            });
            // When terrain is transparent, don't write depth to avoid hiding other scene elements.
            material.depthWrite = !terrainTransparent;
            this.sharedMaterial = material;
        }

        // 6) Build mesh.
        const terrainMesh = new THREE.Mesh(geometry, material);
        terrainMesh.castShadow = false;
        terrainMesh.receiveShadow = false;

        // 7) Place the mesh at the tile center in world space.
        const tileCenterX = (tileBounds.min.x + tileBounds.max.x) / 2;
        const tileCenterY = (tileBounds.min.y + tileBounds.max.y) / 2;

        // 8) WebMercator -> Three world coordinates.
        const tileThreePos = this.proj.mercatorToThree(tileCenterX, tileCenterY);

        // 9) Stabilize the transform (avoid tiny float jitter).
        const preciseX = Number(tileThreePos.x.toFixed(6));
        const preciseY = Number(tileThreePos.y.toFixed(6));
        const preciseZ = Number(tileThreePos.z.toFixed(6));
        terrainMesh.position.set(preciseX, preciseY, preciseZ);

        // 10) Stable sorting order.
        terrainMesh.renderOrder = (tileY + 1000) * 1000 + (tileX + 1000);

        // 11) PlaneGeometry is XY; rotate to XZ (Y-up world).
        terrainMesh.rotation.x = -Math.PI / 2;

        // 12) Finalize.
        terrainMesh.updateMatrixWorld(true);

        // Add to scene group.
        this.terrainGroup.add(terrainMesh);

        // 
        terrainMesh.userData = {
            tileX: tileX,
            tileY: tileY,
            tileZ: tileZ,
            bounds: tileBounds,
            geometry: geometry,
            tileKey: tileKey0,
            dynamic: !!options.dynamic
        };

        const imageryEnabled = this.config?.terrainImageryEnabled !== false;
        const patchOnly = !imageryEnabled && this.config?.mapDrapeShaderPatchEnabled === true && this.config?.mapDrapeSkipTileLoad !== true;
        if (imageryEnabled) {
            // Apply satellite imagery (async) to terrain material.
            // Background imagery is optional (persistent, never evicted).
            this._applyBackgroundImageryToTerrainMesh(terrainMesh, tileX, tileY, tileZ);

            // Terrain material imagery:
            // - Base drape is static (always applied once per tile)
            // - Near-range high-zoom detail is applied by `TerrainMapAtlas.update()` (15-18).
            const baseZoom = Number.isFinite(this.config?.mapDrapeBaseZoom) ? this.config.mapDrapeBaseZoom : tileZ;
            void this._applySatelliteToTerrainMesh(terrainMesh, tileX, tileY, tileZ, {
                mapZoom: baseZoom,
                maxZoomDiff: this.tileConfig?.mapMaxZoomDiff ?? 2,
                force: true
            });
        } else if (patchOnly) {
            this._applyAtlasDummyToMesh(terrainMesh);
        }

        // 
        this.terrainMesh = terrainMesh;

        // Debug info
        if ((this.config?.terrainDebugLogs ?? false) && !options.dynamic) {
            console.log('=== Terrain tile created ===');
            console.log('Tile coords:', tileX, tileY, tileZ);
            console.log('Tile size (meters):', tileWidthMeters, tileHeightMeters);
            console.log('[Terrain]');
            console.log('[Terrain]');
            console.log('====================');
        }


        const counted = options?.counted ?? !options.dynamic;

        // When loading the initial AOI, count only non-dynamic tiles (dynamic = editor patches).
        if (counted) {
            this.loadedTilesCount++;
            if (this.config?.terrainDebugLogs ?? false) {
                console.log(`Loaded tiles: ${this.loadedTilesCount}/${this.totalTilesToLoad}`);
            }
        }

        // 
        const tileKey = `${tileZ}-${tileX}-${tileY}`;
        const tile = new TerrainTile({
            tileX,
            tileY,
            tileZ,
            bounds: tileBounds,
            segments,
            mesh: terrainMesh,
            geometry,
            heightmap,
            baseHeightmap: new Float32Array(heightmap),
            tileWidth,
            tileHeight
        });

        // Cache bounds in local Three.js X/Z coordinates for fast near-range checks.
        // `tileBounds` is WebMercator; our local scene uses `three.z = centerY - mercatorY`.
        if (tileBounds?.min && tileBounds?.max && this.proj?.centerMercator) {
            const cx = this.proj.centerMercator.x;
            const cy = this.proj.centerMercator.y;
            tile.boundsThree = {
                minX: this.metersToUnits(tileBounds.min.x - cx),
                maxX: this.metersToUnits(tileBounds.max.x - cx),
                minZ: this.metersToUnits(cy - tileBounds.max.y),
                maxZ: this.metersToUnits(cy - tileBounds.min.y)
            };
        }
        this.tileMap.set(tileKey, tile);

        // If terrain elevation is currently disabled, keep the newly loaded tile flat.
        if (!this.terrainEnabled) {
            this.updateTileGeometryFast(tile, { computeNormals: true });
            try {
                tile.geometry.computeBoundingBox();
                tile.geometry.computeBoundingSphere();
            } catch {
                // ignore
            }
        }

        // Incremental edge stitching: avoid visible cracks when tiles stream in/out.
        // Keep it lightweight (no full-scene recompute) so LOD streaming stays smooth.
        const incrementalStitch = this.config?.terrainIncrementalStitch ?? true;
        if (incrementalStitch) {
            try {
                this._stitchTileEdgesIncremental(tile);
                // Update edge stitching status after incremental stitch
                tile.markAllEdgesStitched();
            } catch {
                // ignore
            }
        }

        // 
        if (counted && this.loadedTilesCount === this.totalTilesToLoad) {
            console.log('=== All terrain tiles loaded ===');
            this.stitchTileEdges();
            // Update edge stitching status for all tiles after full stitch
            this.tileMap.forEach(t => t.markAllEdgesStitched());
            this.updateAllTileGeometries(true);
            if (this.onTerrainLoaded) {
                this.onTerrainLoaded();
            }
        }

        return tile;
    }

    _getImageryCacheKeyForTerrainTile(tileX, tileY, terrainZoom, mapZoom, tileSize = 256) {
        const scheme = String(this.tileConfig?.mapYtype ?? 'xyz').toLowerCase();
        const z = mapZoom;
        const diff = z - terrainZoom;
        if (diff === 0) return `t:${scheme}:${z}-${tileX}-${tileY}`;
        if (diff < 0) return `s:${scheme}:${terrainZoom}-${tileX}-${tileY}@${z}`;
        return `m:${scheme}:${terrainZoom}-${tileX}-${tileY}@${z}:${tileSize}`;
    }

    /**
     * Switch base map (raster tiles) at runtime.
     * - Updates base drape + atlas hot-update tiles.
     * - Clears caches and re-applies base textures on all loaded tiles.
     */
    setBaseMap(next = {}, camera = null) {
        this.config = { ...this.config, ...(next || {}) };
        this._baseMap = resolveBaseMapConfig(this.config);

        // Refresh effective tile config
        this.tileConfig.mapTileUrl = this._baseMap?.mapTileUrl ?? this.tileConfig.mapTileUrl;
        this.tileConfig.mapYtype = this._baseMap?.mapYtype ?? (this.config?.mapYtype ?? this.config?.mapYType ?? this.config?.mapTileScheme ?? 'xyz');
        this.tileConfig.mapSubdomains = this._baseMap?.mapSubdomains ?? (this.config?.mapSubdomains ?? this.config?.mapSubDomains ?? null);
        this.tileConfig.mapToken = this._baseMap?.templateToken ?? this.config?.mapToken ?? this.config?.token ?? this.config?.key ?? null;

        // Apply provider defaults only when user didn't set them explicitly.
        const applyDefault = (key, value) => {
            if (value === undefined || value === null) return;
            if (this.config[key] === undefined || this.config[key] === null) this.config[key] = value;
        };
        applyDefault('mapMaxConcurrent', this._baseMap?.mapMaxConcurrent);
        applyDefault('mapRateLimitBurst', this._baseMap?.mapRateLimitBurst);
        applyDefault('mapRateLimitWindowMs', this._baseMap?.mapRateLimitWindowMs);
        applyDefault('mapRateLimitCooldownMs', this._baseMap?.mapRateLimitCooldownMs);
        applyDefault('mapRetryCount', this._baseMap?.mapRetryCount);
        applyDefault('mapRetryBaseDelayMs', this._baseMap?.mapRetryBaseDelayMs);
        applyDefault('mapRetryMaxDelayMs', this._baseMap?.mapRetryMaxDelayMs);

        // Push new options into loaders (setOptions will reset caches if needed)
        this.imageryTiles?.setOptions?.({
            tileUrl: this.tileConfig?.mapTileUrl,
            tileScheme: this.tileConfig?.mapYtype,
            subdomains: this.tileConfig?.mapSubdomains,
            token: this.tileConfig?.mapToken,
            maxConcurrent: this.config?.mapMaxConcurrent ?? 8,
            maxEntries: this.config?.mapCacheSize ?? 256,
            maxAnisotropy: this.config?.mapMaxAnisotropy ?? 8,
            rateLimitBurst: this.tileConfig?.mapRateLimitBurst,
            rateLimitWindowMs: this.tileConfig?.mapRateLimitWindowMs,
            rateLimitCooldownMs: this.tileConfig?.mapRateLimitCooldownMs,
            retryCount: this.tileConfig?.mapRetryCount,
            retryBaseDelayMs: this.tileConfig?.mapRetryBaseDelayMs,
            retryMaxDelayMs: this.tileConfig?.mapRetryMaxDelayMs
        });
        this.imageryTilesAtlas?.setOptions?.({
            tileUrl: this.config?.mapDrapeTileUrl ?? this.tileConfig?.mapTileUrl,
            tileScheme: this.tileConfig?.mapYtype,
            subdomains: this.tileConfig?.mapSubdomains,
            token: this.tileConfig?.mapToken,
            maxConcurrent: this.config?.mapDrapeMaxConcurrent ?? this.config?.mapMaxConcurrent ?? 8,
            maxEntries: this.config?.mapDrapeCacheSize ?? Math.max(64, (this.config?.mapCacheSize ?? 256) | 0),
            maxAnisotropy: this.config?.mapDrapeAtlasAnisotropy ?? this.config?.mapMaxAnisotropy ?? 8,
            rateLimitBurst: this.tileConfig?.mapRateLimitBurst,
            rateLimitWindowMs: this.tileConfig?.mapRateLimitWindowMs,
            rateLimitCooldownMs: this.tileConfig?.mapRateLimitCooldownMs,
            retryCount: this.tileConfig?.mapRetryCount,
            retryBaseDelayMs: this.tileConfig?.mapRetryBaseDelayMs,
            retryMaxDelayMs: this.tileConfig?.mapRetryMaxDelayMs
        });

        this.mapAtlas?.clear?.();

        const imageryEnabled = this.config?.terrainImageryEnabled !== false;
        const patchOnly = !imageryEnabled && this.config?.mapDrapeShaderPatchEnabled === true && this.config?.mapDrapeSkipTileLoad !== true;
        const baseZoom = Number.isFinite(this.config?.mapDrapeBaseZoom) ? this.config.mapDrapeBaseZoom : this.tileConfig.zoom;
        for (const t of this.tileMap?.values?.() ?? []) {
            const mesh = t?.mesh;
            if (!mesh?.isMesh) continue;
            if (!mesh.userData) mesh.userData = {};

            // Unpin previous base drape texture (if any)
            if (mesh.userData?.mapCacheKey) {
                try { this.imageryTiles?.unpin?.(mesh.userData.mapCacheKey); } catch { /* ignore */ }
                mesh.userData.mapCacheKey = null;
            }
            mesh.userData.mapZoomApplied = null;

            // Background imagery (optional persistent underlay)
            if (mesh.userData?.backgroundMapCacheKey) {
                try { this.imageryTiles?.unpin?.(mesh.userData.backgroundMapCacheKey); } catch { /* ignore */ }
                mesh.userData.backgroundMapCacheKey = null;
            }
            mesh.userData.backgroundMapZoomApplied = null;

            if (imageryEnabled) {
                try { this._applyBackgroundImageryToTerrainMesh(mesh, t.tileX, t.tileY, t.tileZ); } catch { /* ignore */ }

                void this._applySatelliteToTerrainMesh(mesh, t.tileX, t.tileY, t.tileZ, {
                    mapZoom: baseZoom,
                    maxZoomDiff: this.tileConfig?.mapMaxZoomDiff ?? 2,
                    force: true
                });
            } else if (patchOnly) {
                this._applyAtlasDummyToMesh(mesh);
            }
        }

        if (camera) this.updateImagery(camera);
    }

    async _applySatelliteToTerrainMesh(mesh, tileX, tileY, tileZ, options = {}) {
        try {
            if (!mesh?.isMesh) return;
            if (mesh.userData?.isEditPatch) return;
            if (this.config?.terrainImageryEnabled === false) {
                const mat = mesh.material;
                if (mat?.map) {
                    mat.map = null;
                    mat.needsUpdate = true;
                }
                if (mesh.userData?.mapCacheKey) {
                    try { this.imageryTiles?.unpin?.(mesh.userData.mapCacheKey); } catch { /* ignore */ }
                    mesh.userData.mapCacheKey = null;
                }
                mesh.userData.mapZoomApplied = null;
                return;
            }

            this.imageryTiles?.setRenderer?.(this.renderer);
            this.imageryTiles?.setOptions?.({
                tileUrl: this.tileConfig?.mapTileUrl,
                tileScheme: this.tileConfig?.mapYtype,
                subdomains: this.tileConfig?.mapSubdomains,
                token: this.tileConfig?.mapToken,
                rateLimitBurst: this.tileConfig?.mapRateLimitBurst,
                rateLimitWindowMs: this.tileConfig?.mapRateLimitWindowMs,
                rateLimitCooldownMs: this.tileConfig?.mapRateLimitCooldownMs,
                retryCount: this.tileConfig?.mapRetryCount,
                retryBaseDelayMs: this.tileConfig?.mapRetryBaseDelayMs,
                retryMaxDelayMs: this.tileConfig?.mapRetryMaxDelayMs
            });

            const maxMapZoom = Number.isFinite(this.tileConfig?.maxMapZoom) ? this.tileConfig.maxMapZoom : 18;
            const minMapZoom = Number.isFinite(this.config?.mapZoomMin) ? this.config.mapZoomMin : 2;
            const desired = Number.isFinite(options.mapZoom) ? options.mapZoom : maxMapZoom;
            const requestedMapZoom = Math.max(minMapZoom, Math.min(maxMapZoom, desired));

            // Clamp imagery zoom by a per-request `maxZoomDiff` (defaults to global mapMaxZoomDiff).
            // This is IMPORTANT because diff>2 explodes into 2^diff x 2^diff XYZ requests per terrain tile.
            const maxZoomDiff = Number.isFinite(options.maxZoomDiff)
                ? options.maxZoomDiff
                : (this.tileConfig?.mapMaxZoomDiff ?? 2);
            const diff = requestedMapZoom - tileZ;
            const mapZoom = (diff > maxZoomDiff) ? (tileZ + maxZoomDiff) : requestedMapZoom;
            const force = !!options.force;
            if (!force && mesh.userData?.mapZoomApplied === mapZoom) return;

            const tileSize = this.tileConfig?.tileSize ?? 256;
            const cacheKey = this._getImageryCacheKeyForTerrainTile(tileX, tileY, tileZ, mapZoom, tileSize);
            if (mesh.userData?.mapCacheKey && mesh.userData.mapCacheKey !== cacheKey) {
                this.imageryTiles?.unpin?.(mesh.userData.mapCacheKey);
            }
            this.imageryTiles?.pin?.(cacheKey);
            const tex = await this.imageryTiles?.getTextureForTerrainTile(tileX, tileY, tileZ, {
                mapZoom,
                maxZoomDiff,
                tileSize
            });
            if (!tex) return;

            // Ensure per-tile material so each tile can have its own `map` without affecting others.
            const prev = mesh.material;
            const mat = prev === this.sharedMaterial ? prev.clone() : prev;
            if (!mat?.isMaterial) return;
            mat.map = tex;
            mat.color?.set?.(0xffffff);
            mat.needsUpdate = true;
            this.mapAtlas?.installOnMaterial(mat);

            // Preserve important flags
            if (prev?.polygonOffset !== undefined) mat.polygonOffset = prev.polygonOffset;
            if (prev?.polygonOffsetFactor !== undefined) mat.polygonOffsetFactor = prev.polygonOffsetFactor;
            if (prev?.polygonOffsetUnits !== undefined) mat.polygonOffsetUnits = prev.polygonOffsetUnits;
            if (prev?.side !== undefined) mat.side = prev.side;
            if (prev?.transparent !== undefined) mat.transparent = prev.transparent;
            if (prev?.opacity !== undefined) mat.opacity = prev.opacity;
            if (prev?.alphaTest !== undefined) mat.alphaTest = prev.alphaTest;
            if (prev?.fog !== undefined) mat.fog = prev.fog;
            if (prev?.wireframe !== undefined) mat.wireframe = prev.wireframe;

            mesh.material = mat;
            mesh.userData = mesh.userData || {};
            mesh.userData.mapZoomApplied = mapZoom;
            mesh.userData.mapCacheKey = cacheKey;

            // Ensure newly cloned per-tile material inherits current edit masks/clipping.
            this.editor?.applyCurrentMaskAndClippingToMaterial?.(mat);
        } catch (e) {
            console.warn('[Terrain] Failed to apply satellite texture:', e);
        }
    }

    async _applyBackgroundImageryToTerrainMesh(mesh, tileX, tileY, tileZ) {
        try {
            if (!mesh?.isMesh) return;
            if (mesh.userData?.isEditPatch) return;
            if (this.config?.terrainImageryEnabled === false) {
                if (mesh.userData?.backgroundMapCacheKey) {
                    try { this.imageryTiles?.unpin?.(mesh.userData.backgroundMapCacheKey); } catch { /* ignore */ }
                    mesh.userData.backgroundMapCacheKey = null;
                }
                mesh.userData.backgroundMapZoomApplied = null;
                const mat = mesh.material;
                if (mat?.map) {
                    mat.map = null;
                    mat.needsUpdate = true;
                }
                return;
            }

            const enabled = this.config?.backgroundMapEnabled ?? true;
            if (!enabled) return;

            const backgroundZoom = Number.isFinite(this.config?.backgroundMapZoom) ? this.config.backgroundMapZoom : 5;
            const maxZ = Number.isFinite(this.tileConfig?.maxMapZoom) ? this.tileConfig.maxMapZoom : 18;
            const z = Math.max(2, Math.min(maxZ, backgroundZoom));

            // Avoid re-applying
            if (mesh.userData?.backgroundMapZoomApplied === z) return;

            this.imageryTiles?.setRenderer?.(this.renderer);
            this.imageryTiles?.setOptions?.({
                tileUrl: this.tileConfig?.mapTileUrl,
                tileScheme: this.tileConfig?.mapYtype,
                subdomains: this.tileConfig?.mapSubdomains,
                token: this.tileConfig?.mapToken,
                rateLimitBurst: this.tileConfig?.mapRateLimitBurst,
                rateLimitWindowMs: this.tileConfig?.mapRateLimitWindowMs,
                rateLimitCooldownMs: this.tileConfig?.mapRateLimitCooldownMs,
                retryCount: this.tileConfig?.mapRetryCount,
                retryBaseDelayMs: this.tileConfig?.mapRetryBaseDelayMs,
                retryMaxDelayMs: this.tileConfig?.mapRetryMaxDelayMs
            });

            const tileSize = this.tileConfig?.tileSize ?? 256;
            const cacheKey = this._getImageryCacheKeyForTerrainTile(tileX, tileY, tileZ, z, tileSize);
            if (mesh.userData?.backgroundMapCacheKey && mesh.userData.backgroundMapCacheKey !== cacheKey) {
                this.imageryTiles?.unpin?.(mesh.userData.backgroundMapCacheKey);
            }
            this.imageryTiles?.pin?.(cacheKey);
            const tex = await this.imageryTiles?.getTextureForTerrainTile(tileX, tileY, tileZ, {
                mapZoom: z,
                // allow arbitrarily lower zoom (diff<0 path), no need to clamp
                maxZoomDiff: this.tileConfig?.mapMaxZoomDiff ?? 2,
                tileSize,
                pin: false
            });
            if (!tex) return;

            // Ensure per-tile material so each tile can have its own base `map`.
            const prev = mesh.material;
            const mat = prev === this.sharedMaterial ? prev.clone() : prev;
            if (!mat?.isMaterial) return;
            mat.map = tex;
            mat.color?.set?.(0xffffff);
            mat.needsUpdate = true;
            this.mapAtlas?.installOnMaterial(mat);
            mesh.material = mat;

            mesh.userData = mesh.userData || {};
            mesh.userData.backgroundMapZoomApplied = z;
            mesh.userData.backgroundMapCacheKey = cacheKey;

            // Ensure newly cloned per-tile material inherits current edit masks/clipping.
            this.editor?.applyCurrentMaskAndClippingToMaterial?.(mat);
        } catch (e) {
            console.warn('[Terrain] Failed to apply background imagery:', e);
        }
    }

    /**
     * Update terrain imagery.
     */
    updateImagery(camera) {
        if (!camera?.position) return;
        const imageryEnabled = this.config?.terrainImageryEnabled !== false;
        const patchOnly = !imageryEnabled && this.config?.mapDrapeShaderPatchEnabled === true && this.config?.mapDrapeSkipTileLoad !== true;
        if (!imageryEnabled) {
            if (!this._terrainImageryDisabled) {
                this._terrainImageryDisabled = true;
                this._clearTerrainImagery({ keepAtlas: patchOnly });
            }
            if (patchOnly) this._ensureAtlasPatchMaterials();
            this.mapAtlas?.update(camera);
            this.lodVisualizer?.update(camera);
            return;
        }
        this._terrainImageryDisabled = false;
        this.imageryTiles?.setRenderer?.(this.renderer);
        this.imageryTiles?.setOptions?.({
            tileUrl: this.tileConfig?.mapTileUrl,
            tileScheme: this.tileConfig?.mapYtype,
            subdomains: this.tileConfig?.mapSubdomains,
            token: this.tileConfig?.mapToken,
            rateLimitBurst: this.tileConfig?.mapRateLimitBurst,
            rateLimitWindowMs: this.tileConfig?.mapRateLimitWindowMs,
            rateLimitCooldownMs: this.tileConfig?.mapRateLimitCooldownMs,
            retryCount: this.tileConfig?.mapRetryCount,
            retryBaseDelayMs: this.tileConfig?.mapRetryBaseDelayMs,
            retryMaxDelayMs: this.tileConfig?.mapRetryMaxDelayMs
        });

        this.mapAtlas?.update(camera);
        this.lodVisualizer?.update(camera);
    }

    _clearTerrainImagery({ keepAtlas = false } = {}) {
        for (const t of this.tileMap?.values?.() ?? []) {
            const mesh = t?.mesh;
            if (!mesh?.isMesh) continue;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            for (const mat of mats) {
                if (mat?.map) {
                    mat.map = null;
                    mat.needsUpdate = true;
                }
            }
            if (mesh.userData?.mapCacheKey) {
                try { this.imageryTiles?.unpin?.(mesh.userData.mapCacheKey); } catch { /* ignore */ }
                mesh.userData.mapCacheKey = null;
            }
            if (mesh.userData?.backgroundMapCacheKey) {
                try { this.imageryTiles?.unpin?.(mesh.userData.backgroundMapCacheKey); } catch { /* ignore */ }
                mesh.userData.backgroundMapCacheKey = null;
            }
            mesh.userData.mapZoomApplied = null;
            mesh.userData.backgroundMapZoomApplied = null;
        }
        if (!keepAtlas) this.mapAtlas?.disableOnAllMaterials?.();
    }

    _getAtlasDummyTexture() {
        if (this._atlasDummyTexture) return this._atlasDummyTexture;
        const data = new Uint8Array([255, 255, 255, 255]);
        const tex = new THREE.DataTexture(data, 1, 1);
        tex.needsUpdate = true;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        this._atlasDummyTexture = tex;
        return tex;
    }

    _applyAtlasDummyToMesh(mesh) {
        if (!mesh?.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const dummy = this._getAtlasDummyTexture();
        for (const mat of mats) {
            if (!mat?.isMaterial) continue;
            if (mat.map !== dummy) {
                mat.map = dummy;
                mat.needsUpdate = true;
            }
            this.mapAtlas?.installOnMaterial?.(mat);
        }
    }

    _ensureAtlasPatchMaterials() {
        for (const t of this.tileMap?.values?.() ?? []) {
            this._applyAtlasDummyToMesh(t?.mesh);
        }
    }

    _getViewportHeightPx() {
        const h = this.renderer?.domElement?.clientHeight ?? this.renderer?.domElement?.height ?? window?.innerHeight;
        return Math.max(1, Number(h) || 1);
    }

    _getCameraTilt01(camera) {
        // 0 => looking straight down; 1 => looking near-horizontal.
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
        const down = new THREE.Vector3(0, -1, 0);
        const dot = THREE.MathUtils.clamp(dir.dot(down), -1, 1);
        const tiltRad = Math.acos(dot);
        return THREE.MathUtils.clamp(tiltRad / (Math.PI / 2), 0, 1);
    }

    _getPxPerMeterAtDepth(camera, depthMeters) {
        const depth = Math.max(1e-6, Number(depthMeters) || 0);
        const fovY = THREE.MathUtils.degToRad(camera.fov || 60);
        const halfH = this._getViewportHeightPx() / 2;
        return halfH / (depth * Math.tan(fovY / 2));
    }

    _getGroundPointUnderScreenCenter(camera, groundY = 0) {
        // Ray from NDC (0,0) through camera into world, intersect y=groundY
        const origin = camera.position.clone();
        const p = new THREE.Vector3(0, 0, 0.5).unproject(camera);
        const dir = p.sub(origin).normalize();
        const dy = dir.y;
        if (Math.abs(dy) < 1e-9) return null;
        const t = (groundY - origin.y) / dy;
        if (!Number.isFinite(t) || t <= 0) return null;
        return origin.addScaledVector(dir, t);
    }

    _getTerrainPointUnderScreenCenter(camera) {
        if (!camera) return null;
        if (!this.tileMap?.size) return null;

        const meshes = [];
        for (const t of this.tileMap.values()) {
            const m = t?.mesh;
            if (m?.isMesh) meshes.push(m);
        }
        if (meshes.length === 0) return null;

        camera.updateMatrixWorld(true);
        this.terrainGroup?.updateMatrixWorld?.(true);

        const raycaster = this._mapDrapeRaycaster || (this._mapDrapeRaycaster = new THREE.Raycaster());
        raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
        const hits = raycaster.intersectObjects(meshes, false);
        if (!hits?.length) return null;
        return hits[0]?.point ?? null;
    }


    getTileKey(tileX, tileY, tileZ) {
        return `${tileZ}-${tileX}-${tileY}`;
    }

    getTileByCoords(tileX, tileY, tileZ) {
        return this.tileMap.get(this.getTileKey(tileX, tileY, tileZ));
    }

    /**
     *  RGB 
     * @param {THREE.Texture} texture - RGB
     * @param {THREE.BufferGeometry} geometry - 
     * @param {Object} tileBounds -  WebMercator 
     * @returns {Float32Array} 
     */
    buildHeightmapFromTexture(texture, geometry, tileBounds) {
        const image = texture.image;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);

        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const positions = geometry.attributes.position.array;
        const heightmap = new Float32Array(positions.length / 3);

        const tileWidthMeters = Math.abs(tileBounds.max.x - tileBounds.min.x);
        const tileHeightMeters = Math.abs(tileBounds.max.y - tileBounds.min.y);
        const tileWidth = this.metersToUnits(tileWidthMeters);
        const tileHeight = this.metersToUnits(tileHeightMeters);

        for (let i = 0, v = 0; i < positions.length; i += 3, v++) {
            const x = positions[i];
            const y = positions[i + 1];

            const u = Number(((x + tileWidth / 2) / tileWidth).toFixed(6));
            // IMPORTANT: THREE.PlaneGeometry flips Y when generating vertices (position.y = -y),
            // so the first vertex row (row 0) corresponds to the north edge. Image pixelY=0 is also north.
            // Therefore we must invert V here; otherwise the terrain heights are mirrored north/south.
            const vCoord = Number(((tileHeight / 2 - y) / tileHeight).toFixed(6));

            const pixelX = Math.floor(u * (image.width - 1));
            const pixelY = Math.floor(vCoord * (image.height - 1));
            const pixelIndex = (pixelY * image.width + pixelX) * 4;

            if (pixelIndex >= 0 && pixelIndex < pixels.length) {
                const r = pixels[pixelIndex];
                const g = pixels[pixelIndex + 1];
                const b = pixels[pixelIndex + 2];
                heightmap[v] = -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1);
            }
        }

        return heightmap;
    }

    applyHeightmapToGeometry(geometry, heightmap) {
        const positions = geometry.attributes.position.array;
        for (let i = 0; i < heightmap.length; i++) {
            positions[i * 3 + 2] = heightmap[i];
        }
        geometry.attributes.position.needsUpdate = true;
    }

    updateTileGeometry(tile, updateOriginalPositions = false) {
        if (this.terrainEnabled) {
            tile.applyHeightmapToGeometry();
        } else {
            this._flattenGeometryToZero(tile.geometry);
        }
        tile.geometry.computeVertexNormals();
        tile.geometry.computeBoundingBox();
        tile.geometry.computeBoundingSphere();
        tile.mesh.updateMatrixWorld(true);

        if (updateOriginalPositions && this.terrainEnabled && !tile.geometry.userData.originalPositions) {
            tile.geometry.userData.originalPositions = new Float32Array(tile.geometry.attributes.position.array);
        }
    }

    updateTileGeometryFast(tile, options = {}) {
        if (!tile) return;
        const computeNormals = options.computeNormals ?? true;
        if (this.terrainEnabled) {
            tile.applyHeightmapToGeometry();
        } else {
            this._flattenGeometryToZero(tile.geometry);
        }
        if (computeNormals) {
            try {
                tile.geometry.computeVertexNormals();
            } catch {
                // ignore
            }
        }
        tile.mesh.updateMatrixWorld(true);
    }

    updateAllTileGeometries(updateOriginalPositions = false) {
        this.tileMap.forEach((tile) => {
            this.updateTileGeometry(tile, updateOriginalPositions);
        });
    }

    _flattenGeometryToZero(geometry) {
        const pos = geometry?.attributes?.position;
        const arr = pos?.array;
        if (!arr) return;
        for (let i = 2; i < arr.length; i += 3) arr[i] = 0;
        pos.needsUpdate = true;
    }

    _stitchTileEdgesIncremental(tile) {
        if (!tile) return;
        const { segments } = this.tileConfig;
        const getIndex = (row, col) => row * (segments + 1) + col;

        const hmOf = (t, which) => {
            if (!t) return null;
            if (which === 'baseHeightmap') return t.baseHeightmap || null;
            return t.heightmap || null;
        };

        const avgList = (list) => {
            if (!list.length) return null;
            let sum = 0;
            for (const v of list) sum += v;
            return sum / list.length;
        };

        const affected = new Set();
        affected.add(tile);

        const tileZ = tile.tileZ;
        const right = this.getTileByCoords(tile.tileX + 1, tile.tileY, tileZ);
        const left = this.getTileByCoords(tile.tileX - 1, tile.tileY, tileZ);
        const south = this.getTileByCoords(tile.tileX, tile.tileY + 1, tileZ);
        const north = this.getTileByCoords(tile.tileX, tile.tileY - 1, tileZ);
        const southEast = this.getTileByCoords(tile.tileX + 1, tile.tileY + 1, tileZ);
        const southWest = this.getTileByCoords(tile.tileX - 1, tile.tileY + 1, tileZ);
        const northEast = this.getTileByCoords(tile.tileX + 1, tile.tileY - 1, tileZ);
        const northWest = this.getTileByCoords(tile.tileX - 1, tile.tileY - 1, tileZ);

        const stitchEdge = (a, b, edge) => {
            if (!a || !b) return;
            affected.add(a);
            affected.add(b);
            if (edge === 'E') {
                for (let row = 0; row <= segments; row++) {
                    const ia = getIndex(row, segments);
                    const ib = getIndex(row, 0);
                    const h = (a.heightmap[ia] + b.heightmap[ib]) * 0.5;
                    a.heightmap[ia] = h;
                    b.heightmap[ib] = h;
                    const ba = hmOf(a, 'baseHeightmap');
                    const bb = hmOf(b, 'baseHeightmap');
                    if (ba && bb) {
                        const hb = (ba[ia] + bb[ib]) * 0.5;
                        ba[ia] = hb;
                        bb[ib] = hb;
                    }
                }
            } else if (edge === 'W') {
                for (let row = 0; row <= segments; row++) {
                    const ia = getIndex(row, 0);
                    const ib = getIndex(row, segments);
                    const h = (a.heightmap[ia] + b.heightmap[ib]) * 0.5;
                    a.heightmap[ia] = h;
                    b.heightmap[ib] = h;
                    const ba = hmOf(a, 'baseHeightmap');
                    const bb = hmOf(b, 'baseHeightmap');
                    if (ba && bb) {
                        const hb = (ba[ia] + bb[ib]) * 0.5;
                        ba[ia] = hb;
                        bb[ib] = hb;
                    }
                }
            } else if (edge === 'S') {
                for (let col = 0; col <= segments; col++) {
                    const ia = getIndex(segments, col);
                    const ib = getIndex(0, col);
                    const h = (a.heightmap[ia] + b.heightmap[ib]) * 0.5;
                    a.heightmap[ia] = h;
                    b.heightmap[ib] = h;
                    const ba = hmOf(a, 'baseHeightmap');
                    const bb = hmOf(b, 'baseHeightmap');
                    if (ba && bb) {
                        const hb = (ba[ia] + bb[ib]) * 0.5;
                        ba[ia] = hb;
                        bb[ib] = hb;
                    }
                }
            } else if (edge === 'N') {
                for (let col = 0; col <= segments; col++) {
                    const ia = getIndex(0, col);
                    const ib = getIndex(segments, col);
                    const h = (a.heightmap[ia] + b.heightmap[ib]) * 0.5;
                    a.heightmap[ia] = h;
                    b.heightmap[ib] = h;
                    const ba = hmOf(a, 'baseHeightmap');
                    const bb = hmOf(b, 'baseHeightmap');
                    if (ba && bb) {
                        const hb = (ba[ia] + bb[ib]) * 0.5;
                        ba[ia] = hb;
                        bb[ib] = hb;
                    }
                }
            }
        };

        // Stitch edges around this tile
        if (right) {
            stitchEdge(tile, right, 'E');
            tile.markEdgeStitched('east');
            right.markEdgeStitched('west');
        }
        if (left) {
            stitchEdge(tile, left, 'W');
            tile.markEdgeStitched('west');
            left.markEdgeStitched('east');
        }
        if (south) {
            stitchEdge(tile, south, 'S');
            tile.markEdgeStitched('south');
            south.markEdgeStitched('north');
        }
        if (north) {
            stitchEdge(tile, north, 'N');
            tile.markEdgeStitched('north');
            north.markEdgeStitched('south');
        }

        const stitchCorner = (pairs) => {
            // pairs: [{t, idx}, ...]
            for (const which of ['heightmap', 'baseHeightmap']) {
                const vals = [];
                for (const p of pairs) {
                    const hm = hmOf(p.t, which);
                    if (!hm) continue;
                    const v = hm[p.idx];
                    if (Number.isFinite(v)) vals.push(v);
                }
                if (vals.length < 2) continue;
                const vAvg = avgList(vals);
                for (const p of pairs) {
                    const hm = hmOf(p.t, which);
                    if (!hm) continue;
                    hm[p.idx] = vAvg;
                    affected.add(p.t);
                }
            }
        };

        // Corner smoothing (handle partial neighborhoods too)
        stitchCorner([
            { t: tile, idx: getIndex(segments, segments) },
            { t: right, idx: getIndex(segments, 0) },
            { t: south, idx: getIndex(0, segments) },
            { t: southEast, idx: getIndex(0, 0) }
        ]);
        stitchCorner([
            { t: tile, idx: getIndex(segments, 0) },
            { t: left, idx: getIndex(segments, segments) },
            { t: south, idx: getIndex(0, 0) },
            { t: southWest, idx: getIndex(0, segments) }
        ]);
        stitchCorner([
            { t: tile, idx: getIndex(0, segments) },
            { t: right, idx: getIndex(0, 0) },
            { t: north, idx: getIndex(segments, segments) },
            { t: northEast, idx: getIndex(segments, 0) }
        ]);
        stitchCorner([
            { t: tile, idx: getIndex(0, 0) },
            { t: left, idx: getIndex(0, segments) },
            { t: north, idx: getIndex(segments, 0) },
            { t: northWest, idx: getIndex(segments, segments) }
        ]);

        // Apply updated heights to geometry; normals optional for performance.
        const computeNormals = this.config?.terrainStitchComputeNormals ?? false;
        for (const t of affected) {
            if (!t) continue;
            this.updateTileGeometryFast(t, { computeNormals });
        }

        // Mark surface changed so imagery overlay can re-drape affected regions.
        this._markSurfaceDirty();
    }

    /**
     * Stitch all loaded terrain tiles to remove cracks (full pass).
     */
    stitchTileEdges() {
        const { segments } = this.tileConfig;
        const getIndex = (row, col) => row * (segments + 1) + col;

        const hmOf = (tile, which) => {
            if (!tile) return null;
            if (which === 'baseHeightmap') return tile.baseHeightmap || null;
            return tile.heightmap || null;
        };

        // Smooth stitching: set shared border vertices to the average of adjacent tiles.
        // Notes:
        // - PlaneGeometry vertex rows are flipped (row 0 is the north edge).
        // - We average both `heightmap` and `baseHeightmap` so visualization + editing sampling stay consistent.
        const avg2 = (a, b) => (a + b) * 0.5;

        const setBoth = (tileA, idxA, tileB, idxB, value, which) => {
            const hmA = hmOf(tileA, which);
            const hmB = hmOf(tileB, which);
            if (!hmA || !hmB) return;
            hmA[idxA] = value;
            hmB[idxB] = value;
        };

        this.tileMap.forEach((tile) => {
            const right = this.getTileByCoords(tile.tileX + 1, tile.tileY, tile.tileZ);
            const south = this.getTileByCoords(tile.tileX, tile.tileY + 1, tile.tileZ);

            // East-West shared edge: tile east col=segments <-> right west col=0
            if (right) {
                for (let row = 0; row <= segments; row++) {
                    const idxA = getIndex(row, segments);
                    const idxB = getIndex(row, 0);
                    const h = avg2(tile.heightmap[idxA], right.heightmap[idxB]);
                    tile.heightmap[idxA] = h;
                    right.heightmap[idxB] = h;

                    const baseA = hmOf(tile, 'baseHeightmap');
                    const baseB = hmOf(right, 'baseHeightmap');
                    if (baseA && baseB) {
                        const hb = avg2(baseA[idxA], baseB[idxB]);
                        baseA[idxA] = hb;
                        baseB[idxB] = hb;
                    }
                }
                // Update edge stitching status
                tile.markEdgeStitched('east');
                right.markEdgeStitched('west');
            }

            // North-South shared edge: tile south row=segments <-> south north row=0
            if (south) {
                for (let col = 0; col <= segments; col++) {
                    const idxA = getIndex(segments, col);
                    const idxB = getIndex(0, col);
                    const h = avg2(tile.heightmap[idxA], south.heightmap[idxB]);
                    tile.heightmap[idxA] = h;
                    south.heightmap[idxB] = h;

                    const baseA = hmOf(tile, 'baseHeightmap');
                    const baseB = hmOf(south, 'baseHeightmap');
                    if (baseA && baseB) {
                        const hb = avg2(baseA[idxA], baseB[idxB]);
                        baseA[idxA] = hb;
                        baseB[idxB] = hb;
                    }
                }
                // Update edge stitching status
                tile.markEdgeStitched('south');
                south.markEdgeStitched('north');
            }

            // 4-tile corner smoothing (SE corner of `tile`)
            // tile (segments,segments), right (segments,0), south (0,segments), southEast (0,0)
            if (right && south) {
                const southEast = this.getTileByCoords(tile.tileX + 1, tile.tileY + 1, tile.tileZ);
                if (southEast) {
                    const i00 = getIndex(segments, segments);
                    const i10 = getIndex(segments, 0);
                    const i01 = getIndex(0, segments);
                    const i11 = getIndex(0, 0);

                    const hAvg = (tile.heightmap[i00] + right.heightmap[i10] + south.heightmap[i01] + southEast.heightmap[i11]) * 0.25;
                    tile.heightmap[i00] = hAvg;
                    right.heightmap[i10] = hAvg;
                    south.heightmap[i01] = hAvg;
                    southEast.heightmap[i11] = hAvg;

                    const b00 = hmOf(tile, 'baseHeightmap');
                    const b10 = hmOf(right, 'baseHeightmap');
                    const b01 = hmOf(south, 'baseHeightmap');
                    const b11 = hmOf(southEast, 'baseHeightmap');
                    if (b00 && b10 && b01 && b11) {
                        const bAvg = (b00[i00] + b10[i10] + b01[i01] + b11[i11]) * 0.25;
                        b00[i00] = bAvg;
                        b10[i10] = bAvg;
                        b01[i01] = bAvg;
                        b11[i11] = bAvg;
                    }
                }
            }
        });

        // Mark all tiles as fully stitched after complete stitch
        this.tileMap.forEach(t => t.markAllEdgesStitched());

        // Heightmaps have changed; geometry update happens outside, but surface should be considered dirty.
        this._markSurfaceDirty();
    }

    /**
     * 
     */
    isPointInPolygon(point, polygon) {
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].x, yi = polygon[i].y;
            const xj = polygon[j].x, yj = polygon[j].y;
            const intersect = ((yi > point.y) !== (yj > point.y)) &&
                (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    /**
     * ?elta ?     */
    editTerrain(polygon, depth) {
        this.raiseLower(polygon, depth);
    }

    /**
     * /elta ?     */
    raiseLower(polygon, delta) {
        this.editor?.raiseLower(polygon, delta);
    }

    /**
     * /{ polygon:[[lon,lat],...], delta?: number }, ...]
     */
    raiseLowerMultiple(list) {
        this.multipleEditor?.applyDelta(list);
    }

    /**
     * argetElevation ?     */
    flattenTo(polygon, targetElevation) {
        this.editor?.flattenTo(polygon, targetElevation);
    }

    /**
     * { polygon:[[lon,lat],...], targetElevation?: number }, ...]
     */
    flattenMultiple(list) {
        this.multipleEditor?.applyFlatten(list);
    }

    /**
     *  AB ?     * @param {[number, number]} aLonLat
     * @param {[number, number]} bLonLat
     * @param {{side?: 'left'|'right', widthHeightRatio?: number, maxHeight?: number, highEdgeSamples?: any[]}} options
     */
    slopeFromAB(aLonLat, bLonLat, options) {
        this.ensureEditResolution?.();
        this.editor?.slopeFromAB(aLonLat, bLonLat, options);
    }

    /**
     * { aLonLat:[lon,lat], bLonLat:[lon,lat], side?, widthHeightRatio?, maxHeight?, highEdgeSamples? }, ...]
     */
    slopeMultiple(list) {
        this.ensureEditResolution?.();
        this.multipleEditor?.applySlopes(list);
    }

    /**
     *  3x3  segments?256?     * ?     */
    ensureEditResolution() {
        const targetSegments = this.tileConfig.editSegments || this.tileConfig.segments;
        if (this.tileConfig.segments >= targetSegments) return;
        if (this.tileMap.size === 0) return;

        const oldSegments = this.tileConfig.segments;

        const upsampleHeightmap = (oldHM, fromSeg, toSeg) => {
            const fromN = fromSeg + 1;
            const toN = toSeg + 1;
            const out = new Float32Array(toN * toN);

            const get = (row, col) => oldHM[row * fromN + col];

            for (let row = 0; row < toN; row++) {
                const v = row / toSeg;
                const oy = v * fromSeg;
                const y0 = Math.floor(oy);
                const y1 = Math.min(fromSeg, y0 + 1);
                const ty = oy - y0;

                for (let col = 0; col < toN; col++) {
                    const u = col / toSeg;
                    const ox = u * fromSeg;
                    const x0 = Math.floor(ox);
                    const x1 = Math.min(fromSeg, x0 + 1);
                    const tx = ox - x0;

                    const a = get(y0, x0);
                    const b = get(y0, x1);
                    const c = get(y1, x0);
                    const d = get(y1, x1);

                    const ab = a * (1 - tx) + b * tx;
                    const cd = c * (1 - tx) + d * tx;
                    out[row * toN + col] = ab * (1 - ty) + cd * ty;
                }
            }

            return out;
        };

        this.tileMap.forEach((tile) => {
            // rebuild heightmap at higher resolution
            const newHM = upsampleHeightmap(tile.heightmap, oldSegments, targetSegments);
            const newBaseHM = tile.baseHeightmap ? upsampleHeightmap(tile.baseHeightmap, oldSegments, targetSegments) : new Float32Array(newHM);
            tile.heightmap = newHM;
            tile.baseHeightmap = newBaseHM;
            tile.segments = targetSegments;

            // rebuild geometry and apply heightmap
            const oldGeom = tile.mesh.geometry;
            const newGeom = new THREE.PlaneGeometry(tile.tileWidth, tile.tileHeight, targetSegments, targetSegments);
            this.applyHeightmapToGeometry(newGeom, newHM);
            newGeom.computeVertexNormals();
            newGeom.computeBoundingBox();
            newGeom.computeBoundingSphere();

            tile.mesh.geometry = newGeom;
            tile.geometry = newGeom;
            tile.mesh.userData.geometry = newGeom;

            if (oldGeom) oldGeom.dispose();
        });

        // After rebuilding all tiles, use the new global segments everywhere (stitching/indexing).
        this.tileConfig.segments = targetSegments;

        // Re-stitch with new resolution so borders stay continuous.
        this.stitchTileEdges();
        this.updateAllTileGeometries(true);
    }

    /**
     * Sample height from the cached tile heightmaps (no raycasting).
     * @param {number} worldX
     * @param {number} worldZ
     * @param {"heightmap"|"baseHeightmap"} which
     */
    sampleHeightAtWorld(worldX, worldZ, which = 'heightmap') {
        if (!this.terrainEnabled) return 0;
        // Only 3x3 tiles in this demo, linear scan is fine.
        for (const tile of this.tileMap.values()) {
            if (!tile || !tile.mesh || !tile[which]) continue;

            tile.mesh.updateMatrixWorld(true);
            const invWorld = tile.mesh.matrixWorld.clone().invert();
            const local = new THREE.Vector3(worldX, 0, worldZ).applyMatrix4(invWorld);

            const u = (local.x + tile.tileWidth / 2) / tile.tileWidth;
            // IMPORTANT: THREE.PlaneGeometry stores vertex positions with Y flipped (position.y = -y in generator).
            // Our cached heightmap/baseHeightmap is in the same order as the geometry attribute array, so we must
            // invert V here to match that row ordering (row 0 corresponds to +tileHeight/2).
            const v = (tile.tileHeight / 2 - local.y) / tile.tileHeight;
            // Robust bounds handling:
            // - When sampling exactly on tile edges, floating point error can produce u/v slightly outside [0,1]
            // - Returning 0 creates "inverted triangle" gutters for imagery drape meshes
            const eps = 1e-6;
            if (u < -eps || u > 1 + eps || v < -eps || v > 1 + eps) continue;
            const uu = THREE.MathUtils.clamp(u, 0, 1);
            const vv = THREE.MathUtils.clamp(v, 0, 1);

            const seg = this.tileConfig.segments;
            const n = seg + 1;
            const x = uu * seg;
            const y = vv * seg;
            const x0 = Math.floor(x);
            const y0 = Math.floor(y);
            const x1 = Math.min(seg, x0 + 1);
            const y1 = Math.min(seg, y0 + 1);
            const tx = x - x0;
            const ty = y - y0;

            const hm = tile[which];
            const idx = (row, col) => row * n + col;
            // Match THREE.PlaneGeometry triangulation (diagonal from b(x0,y1) to d(x1,y0)):
            // triangles: (a,b,d) and (b,c,d)
            const ha = hm[idx(y0, x0)]; // a: (0,0)
            const hb = hm[idx(y1, x0)]; // b: (0,1)
            const hc = hm[idx(y1, x1)]; // c: (1,1)
            const hd = hm[idx(y0, x1)]; // d: (1,0)

            if ((tx + ty) <= 1) {
                // triangle (a,b,d): h = ha + ty*(hb-ha) + tx*(hd-ha)
                return ha + ty * (hb - ha) + tx * (hd - ha);
            }

            // triangle (b,c,d), barycentric weights:
            // w_b = 1 - tx, w_c = tx + ty - 1, w_d = 1 - ty
            const wb = 1 - tx;
            const wc = tx + ty - 1;
            const wd = 1 - ty;
            return hb * wb + hc * wc + hd * wd;
        }

        return 0;
    }

    // Editing visualization/patch logic moved to `src/terrain/TerrainEditor.js`.

    clipTerrain(polygon) {
        this.editor?.clipTerrain(polygon);
    }

    /**
     * { polygon:[[lon,lat],...] }, ...] ?[[lon,lat],...]
     */
    setClipTerrains(list) {
        this.multipleEditor?.setClips(list);
    }

    clearClipTerrain() {
        this.editor?.clearUserClip?.();
    }

    /**
     * Clear all "flatten" edit patches (single + multi) and restore base terrain masking.
     */
    clearFlattenTerrain() {
        this.editor?.clearFlattenEdits?.();
    }

    toggleTerrainVisibility() {
        this.setTerrainVisibility(!this.terrainEnabled);
    }

    // NOTE: kept for backwards compatibility with existing UI/tooling.
    // It now acts as a "terrain elevation switch":
    // - true  => real terrain
    // - false => flat plane at y=0
    setTerrainVisibility(enabled) {
        const next = !!enabled;
        if (this.terrainEnabled === next) return;
        this.terrainEnabled = next;

        // Always keep the terrain group visible: "disabled" means flat plane, not hidden.
        if (this.terrainGroup) this.terrainGroup.visible = true;

        // Base tiles: update geometry to match the enabled state.
        for (const tile of this.tileMap.values()) {
            this.updateTileGeometryFast(tile, { computeNormals: true });
            try {
                tile.geometry.computeBoundingBox();
                tile.geometry.computeBoundingSphere();
            } catch {
                // ignore
            }
        }

        // Editor patches: hide when terrain is disabled (keep "flat plane only").
        if (this.terrainGroup) {
            for (const child of this.terrainGroup.children) {
                if (child?.userData?.isEditPatch === true) child.visible = this.terrainEnabled;
            }
        }

        this._markSurfaceDirty();
    }

    getTerrainMesh() {
        return this.terrainMesh;
    }

    getTerrainGroup() {
        return this.terrainGroup;
    }

    getElevationAtThree(x, y, z) {
        if (x instanceof THREE.Vector3) {
            z = x.z;
            y = x.y;
            x = x.x;
        }

        const debug = this.config?.terrainDebugLogs ?? false;
        if (debug) console.log(`=== getElevationAtThree called with (${x}, ${z}) ===`);
        let elevation = 0;
        let found = false;

        this.terrainGroup.children.forEach((child, index) => {
            if (!child.isMesh || found) return;
            if (child.userData && child.userData.isEditPatch) return;
            child.updateMatrixWorld(true);
            const boundingBox = new THREE.Box3().setFromObject(child);
            if (x >= boundingBox.min.x && x <= boundingBox.max.x && z >= boundingBox.min.z && z <= boundingBox.max.z) {
                const raycaster = new THREE.Raycaster();
                const rayH = this.metersToUnits(10000);
                raycaster.set(new THREE.Vector3(x, rayH, z), new THREE.Vector3(0, -1, 0));
                const intersects = raycaster.intersectObject(child);
                if (intersects.length > 0) {
                    elevation = intersects[0].point.y;
                    found = true;
                }
            }
        });

        if (debug) console.log(`=== getElevationAtThree result: ${elevation} ===`);
        return elevation;
    }

    getElevationAtMercator(mercatorX, mercatorY) {
        const threePos = this.proj.mercatorToThree(mercatorX, mercatorY);
        return this.getElevationAtThree(threePos);
    }

    getElevationAtLonLat(lon, lat) {
        const threePos = this.proj.lonLatToThree(lon, lat);
        return this.getElevationAtThree(threePos);
    }


}


