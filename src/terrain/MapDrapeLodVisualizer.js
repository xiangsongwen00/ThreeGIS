import * as THREE from 'three';
export class MapDrapeLodVisualizer {
    /**
     * @param {import('./Terrain.js').Terrain} terrain
     */
    constructor(terrain) {
        this.terrain = terrain;
        this.group = new THREE.Group();
        this.group.name = 'MapDrapeLodVisualizer';
        this.group.visible = false;

        this._linesByZoom = new Map();
        this._viewLine = null;
        this._lastUpdate = 0;
        this._lastLog = 0;

        try {
            this.terrain?.scene?.add?.(this.group);
        } catch {
            // ignore
        }
    }

    dispose() {
        try {
            this.group?.parent?.remove?.(this.group);
        } catch {
            // ignore
        }

        for (const obj of this._linesByZoom.values()) {
            try { obj?.geometry?.dispose?.(); } catch {}
            try { obj?.material?.dispose?.(); } catch {}
        }
        this._linesByZoom.clear();

        if (this._viewLine) {
            try { this._viewLine.geometry?.dispose?.(); } catch {}
            try { this._viewLine.material?.dispose?.(); } catch {}
            this._viewLine = null;
        }
    }

    _now() {
        return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    }

    update(camera) {
        const cfg = this.terrain?.config || {};
        const enabled = cfg.mapDrapeLodVizEnabled === true;
        this.group.visible = enabled;
        if (!enabled) return;

        const intervalMs = Number.isFinite(cfg.mapDrapeLodVizUpdateMs) ? Math.max(0, Number(cfg.mapDrapeLodVizUpdateMs)) : 250;
        const now = this._now();
        if ((now - this._lastUpdate) < intervalMs) return;
        this._lastUpdate = now;

        this._rebuild(camera, now);
    }

    _rebuild(camera, now = 0) {
        const terrain = this.terrain;
        const proj = terrain?.proj;
        const atlas = terrain?.mapAtlas;
        const atlasState = atlas?._state;
        const byZoom = atlasState?.byZoom;
        if (!proj || !byZoom || !byZoom.size) return;

        const cfg = terrain?.config || {};
        const toUnits = (v) => (proj?.metersToUnits ? proj.metersToUnits(v) : Number(v));
        const heightOffsetMeters = Number.isFinite(cfg.mapDrapeLodVizHeightOffset) ? Number(cfg.mapDrapeLodVizHeightOffset) : 2;
        const heightOffset = toUnits(heightOffsetMeters);
        const maxTiles = Number.isFinite(cfg.mapDrapeLodVizMaxTiles) ? Math.max(0, cfg.mapDrapeLodVizMaxTiles | 0) : 5000;
        const showViewQuad = cfg.mapDrapeLodVizShowViewQuad !== false;
        const renderer = terrain?.renderer;
        const maxRT = (() => {
            const a = Number(renderer?.capabilities?.maxRenderTargetSize);
            const b = Number(renderer?.capabilities?.maxTextureSize);
            let max = Infinity;
            if (Number.isFinite(a) && a > 0) max = Math.min(max, a);
            if (Number.isFinite(b) && b > 0) max = Math.min(max, b);
            if (!Number.isFinite(max) || max <= 0) max = 0;
            return max | 0;
        })();

        const camMerc = proj?.threeToMercator?.(camera?.position) ?? null;
        const groundHeightAtCam = (camMerc && Number.isFinite(camMerc.x) && Number.isFinite(camMerc.y))
            ? (terrain?.getElevationAtMercator?.(camMerc.x, camMerc.y) ?? null)
            : (terrain?.sampleHeightAtWorld?.(camera.position.x, camera.position.z, 'heightmap') ?? null);
        const groundY = Number.isFinite(groundHeightAtCam) ? Number(groundHeightAtCam) : 0;
        const baseY = groundY + heightOffset;

        const zooms = Array.from(byZoom.keys()).filter((z) => Number.isFinite(z)).sort((a, b) => b - a);

        const colors = {
            18: 0xff2d2d,
            17: 0xff8a00,
            16: 0xffe500,
            15: 0x00ff6a
        };

        let remaining = maxTiles;
        const stats = [];
        for (const z of zooms) {
            const st = byZoom.get(z);
            const keys = st?.activeKeys;
            if (!(keys instanceof Set) || keys.size === 0) {
                const line = this._linesByZoom.get(z);
                if (line) line.visible = false;
                stats.push({ z, color: colors[z] ?? 0xffffff, active: 0, drawn: 0, grid: 0, cell: 0, rt: 0, maxGrid: 0, maxRT });
                continue;
            }

            const take = (remaining > 0) ? Math.min(keys.size, remaining) : 0;
            remaining -= take;
            const grid = st?.grid?.gridSize ?? 0;
            const cell = st?.cellSize ?? 0;
            const rt = st?.rt?.width ?? 0;
            const maxGrid = (maxRT > 0 && cell > 0) ? Math.max(1, Math.floor(maxRT / cell)) : 0;
            stats.push({ z, color: colors[z] ?? 0xffffff, active: keys.size, drawn: take, grid, cell, rt, maxGrid, maxRT });

            const vertexCount = take * 8;
            const positions = new Float32Array(vertexCount * 3);

            const cx = Number(proj?.centerMercator?.x ?? 0);
            const cy = Number(proj?.centerMercator?.y ?? 0);

            let out = 0;
            let i = 0;
            for (const key of keys) {
                if (i >= take) break;
                i++;

                const parts = String(key).split('-');
                const tileX = Number(parts[1]);
                const tileY = Number(parts[2]);
                if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) continue;

                const b = proj.tileToMercatorBounds(tileX, tileY, z);
                if (!b?.min || !b?.max) continue;

                const west = Number(b.min.x);
                const north = Number(b.min.y);
                const east = Number(b.max.x);
                const south = Number(b.max.y);
                if (!Number.isFinite(west) || !Number.isFinite(north) || !Number.isFinite(east) || !Number.isFinite(south)) continue;

                const xW = toUnits(west - cx);
                const xE = toUnits(east - cx);
                const zN = toUnits(cy - north);
                const zS = toUnits(cy - south);

                // 4 edges => 8 vertices
                positions[out++] = xW; positions[out++] = baseY; positions[out++] = zN;
                positions[out++] = xE; positions[out++] = baseY; positions[out++] = zN;

                positions[out++] = xE; positions[out++] = baseY; positions[out++] = zN;
                positions[out++] = xE; positions[out++] = baseY; positions[out++] = zS;

                positions[out++] = xE; positions[out++] = baseY; positions[out++] = zS;
                positions[out++] = xW; positions[out++] = baseY; positions[out++] = zS;

                positions[out++] = xW; positions[out++] = baseY; positions[out++] = zS;
                positions[out++] = xW; positions[out++] = baseY; positions[out++] = zN;
            }

            let line = this._linesByZoom.get(z);
            if (!line) {
                const geom = new THREE.BufferGeometry();
                geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                const mat = new THREE.LineBasicMaterial({
                    color: colors[z] ?? 0xffffff,
                    transparent: true,
                    opacity: Number.isFinite(cfg.mapDrapeLodVizOpacity) ? Math.max(0, Math.min(1, Number(cfg.mapDrapeLodVizOpacity))) : 0.95,
                    depthTest: false,
                    depthWrite: false
                });
                line = new THREE.LineSegments(geom, mat);
                line.frustumCulled = false;
                this._linesByZoom.set(z, line);
                this.group.add(line);
            } else {
                const geom = line.geometry;
                const attr = geom?.getAttribute?.('position');
                if (!attr || attr.array?.length !== positions.length) {
                    try { geom?.dispose?.(); } catch {}
                    const newGeom = new THREE.BufferGeometry();
                    newGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                    line.geometry = newGeom;
                } else {
                    attr.array.set(positions);
                    attr.needsUpdate = true;
                    geom.computeBoundingSphere?.();
                }
                const mat = line.material;
                if (mat?.color?.setHex) mat.color.setHex(colors[z] ?? 0xffffff);
                if (mat && Number.isFinite(cfg.mapDrapeLodVizOpacity)) {
                    mat.opacity = Math.max(0, Math.min(1, Number(cfg.mapDrapeLodVizOpacity)));
                }
            }

            line.visible = true;
        }

        // Hide lines for zooms that are no longer present.
        for (const [z, line] of this._linesByZoom.entries()) {
            if (!zooms.includes(z)) line.visible = false;
        }

        if (showViewQuad) {
            this._updateViewQuad(camera, groundY, baseY);
        } else if (this._viewLine) {
            this._viewLine.visible = false;
        }

        const logMs = Number.isFinite(cfg.mapDrapeLodVizLogMs) ? Math.max(0, Number(cfg.mapDrapeLodVizLogMs)) : 5000;
        if (logMs > 0 && (now - (this._lastLog || 0)) >= logMs) {
            this._lastLog = now;
            const rows = stats
                .sort((a, b) => b.z - a.z)
                .map((s) => ({
                    zoom: s.z,
                    color: `#${(s.color >>> 0).toString(16).padStart(6, '0')}`,
                    active: s.active,
                    drawn: s.drawn,
                    grid: s.grid,
                    cell: s.cell,
                    rt: s.rt,
                    maxGrid: s.maxGrid,
                    maxRT: s.maxRT
                }));
            try {
                console.log('[LodViz] tiles by zoom (active vs drawn):', rows);
            } catch {
                // ignore
            }
        }
    }

    _updateViewQuad(camera, groundY, drawY) {
        const terrain = this.terrain;
        const proj = terrain?.proj;
        if (!proj?.centerMercator) return;

        const toUnits = (v) => (proj?.metersToUnits ? proj.metersToUnits(v) : Number(v));
        const planeBelowGroundCfg = Number.isFinite(terrain?.config?.mapDrapeViewportPlaneBelowGroundMeters)
            ? Math.max(0, Number(terrain.config.mapDrapeViewportPlaneBelowGroundMeters))
            : null;
        const planeBelowGround = planeBelowGroundCfg !== null ? toUnits(planeBelowGroundCfg) : 0;
        const planeY = Number(groundY) - planeBelowGround;

        const terrainGroup = terrain?.terrainGroup;
        try { terrainGroup?.updateMatrixWorld?.(true); } catch {}

        const raycaster = this._raycaster || (this._raycaster = new THREE.Raycaster());
        const ndcV2 = this._ndc || (this._ndc = new THREE.Vector2());

        const hit = (nx, ny) => {
            ndcV2.set(nx, ny);
            raycaster.setFromCamera(ndcV2, camera);

            if (terrainGroup) {
                const hits = raycaster.intersectObject(terrainGroup, true);
                if (hits?.length) {
                    for (const h of hits) {
                        const obj = h?.object;
                        if (obj?.userData?.isEditPatch) continue;
                        if (h?.point?.isVector3) return h.point.clone();
                    }
                }
            }

            const o = raycaster.ray.origin;
            const d = raycaster.ray.direction;
            const dy = d.y;
            if (!Number.isFinite(dy) || Math.abs(dy) < 1e-9) return null;
            const t = (planeY - o.y) / dy;
            if (!Number.isFinite(t) || t <= 0) return null;
            return o.clone().addScaledVector(d, t);
        };

        const pts = [
            hit(-1, -1),
            hit(1, -1),
            hit(1, 1),
            hit(-1, 1)
        ].filter(Boolean);

        if (pts.length < 3) {
            if (this._viewLine) this._viewLine.visible = false;
            return;
        }

        const positions = new Float32Array((pts.length + 1) * 3);
        let out = 0;
        for (const p of pts) {
            positions[out++] = p.x;
            positions[out++] = drawY;
            positions[out++] = p.z;
        }
        // close the loop
        positions[out++] = pts[0].x;
        positions[out++] = drawY;
        positions[out++] = pts[0].z;

        if (!this._viewLine) {
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            const mat = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.8,
                depthTest: false,
                depthWrite: false
            });
            this._viewLine = new THREE.Line(geom, mat);
            this._viewLine.frustumCulled = false;
            this.group.add(this._viewLine);
        } else {
            const geom = this._viewLine.geometry;
            const attr = geom?.getAttribute?.('position');
            if (!attr || attr.array?.length !== positions.length) {
                try { geom?.dispose?.(); } catch {}
                const newGeom = new THREE.BufferGeometry();
                newGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                this._viewLine.geometry = newGeom;
            } else {
                attr.array.set(positions);
                attr.needsUpdate = true;
                geom.computeBoundingSphere?.();
            }
            this._viewLine.visible = true;
        }
    }
}
