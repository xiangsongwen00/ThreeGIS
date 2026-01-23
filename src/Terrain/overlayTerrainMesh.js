import * as THREE from 'three';

/**
 * OverlayTerrainMesh类
 * 实现基于Shader的地形覆盖功能
 * 根据多边形范围获取地形瓦片，使用Shader进行跨瓦片高度采样和抬升
 */
export class OverlayTerrainMesh {
    /**
     * 构造函数
     * @param {Object} options - 配置选项
     * @param {THREE.Scene} options.scene - Three.js场景
     * @param {Array} options.polygon - 坐标数组，可以是经纬度格式 [{lon, lat}, ...] 或 Three.js坐标格式 [{x, z}, ...]
     * @param {Object} options.rgbTerrain - RGBTerrain实例
     * @param {string} [options.coordType] - 坐标类型，可选值：'lonlat'（经纬度）或'three'（Three.js坐标），默认'lonlat'
     * @param {number} [options.offset] - 高度偏移，默认100米
     * @param {number} [options.segments] - 分段数，默认32，降低分段数提高性能
     */
    constructor(options) {
        this.options = {
            coordType: 'lonlat',
            offset: 100,
            segments: 32, // 降低分段数，提高性能
            ...options
        };

        this.scene = this.options.scene;
        this.polygon = this.options.polygon;
        this.coordType = this.options.coordType;
        this.rgbTerrain = this.options.rgbTerrain;
        this.offset = this.options.offset;
        this.segments = this.options.segments;

        this.overlayMesh = null;
        this.terrainTiles = [];
        this.mathProj = this.rgbTerrain.mathProj; // 从rgbTerrain获取坐标转换工具

        // 转换多边形坐标为Three.js坐标
        this.threePolygon = this.convertPolygonToThreeCoords();

        // 创建着色器材质
        this.material = this.createShaderMaterial();
    }

    /**
     * 将多边形坐标转换为Three.js坐标
     * @returns {Array} Three.js坐标数组 [{x, z}, ...]
     */
    convertPolygonToThreeCoords() {
        if (this.coordType === 'lonlat') {
            // 经纬度转Three.js坐标
            return this.polygon.map(point => {
                const threePos = this.mathProj.lonLatToThree(point.lon, point.lat);
                return { x: threePos.x, z: threePos.z };
            });
        } else {
            // 已经是Three.js坐标
            return this.polygon;
        }
    }

    /**
     * 获取多边形的边界框
     * @param {Array} polygon - Three.js坐标数组 [{x, z}, ...]
     * @returns {Object} 边界框 {minX, maxX, minZ, maxZ}
     */
    getPolygonBounds(polygon) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;

        polygon.forEach(point => {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minZ = Math.min(minZ, point.z);
            maxZ = Math.max(maxZ, point.z);
        });

        return { minX, maxX, minZ, maxZ };
    }

    /**
     * 创建Shader材质
     * @returns {THREE.ShaderMaterial} Shader材质
     */
    createShaderMaterial() {
        // WebGL 1.0 顶点着色器支持的纹理单元数量限制为16，所以设置MAX_TILES为16
        let MAX_TILES = 16;
        const vertexShader = `
        #define MAX_TILES ${MAX_TILES}

        uniform sampler2D heightTextures[MAX_TILES];
        uniform vec4 tileBounds[MAX_TILES];   // minX, minZ, maxX, maxZ
        uniform vec2 tileElevRange[MAX_TILES]; // minElevation, maxElevation
        uniform int tileCount;
        uniform float offset;

        varying float vHeight;

        float sampleHeightFromTile(int tileIndex, vec2 worldXZ) {
            vec4 b = tileBounds[tileIndex];
            
            if (
                worldXZ.x >= b.x && worldXZ.x <= b.z &&
                worldXZ.y >= b.y && worldXZ.y <= b.w
            ) {
                vec2 uv = vec2(
                    (worldXZ.x - b.x) / (b.z - b.x),
                    1.0-(worldXZ.y - b.y) / (b.w - b.y)
                );

                float gray = 0.0;
                
                // 使用条件分支采样不同瓦片的纹理
                // WebGL 1.0不支持动态索引采样器，所以使用展开的if-else
                // 只支持16个瓦片，符合WebGL 1.0的纹理单元限制
                if (tileIndex == 0) gray = texture2D(heightTextures[0], uv).r;
                else if (tileIndex == 1) gray = texture2D(heightTextures[1], uv).r;
                else if (tileIndex == 2) gray = texture2D(heightTextures[2], uv).r;
                else if (tileIndex == 3) gray = texture2D(heightTextures[3], uv).r;
                else if (tileIndex == 4) gray = texture2D(heightTextures[4], uv).r;
                else if (tileIndex == 5) gray = texture2D(heightTextures[5], uv).r;
                else if (tileIndex == 6) gray = texture2D(heightTextures[6], uv).r;
                else if (tileIndex == 7) gray = texture2D(heightTextures[7], uv).r;
                else if (tileIndex == 8) gray = texture2D(heightTextures[8], uv).r;
                else if (tileIndex == 9) gray = texture2D(heightTextures[9], uv).r;
                else if (tileIndex == 10) gray = texture2D(heightTextures[10], uv).r;
                else if (tileIndex == 11) gray = texture2D(heightTextures[11], uv).r;
                else if (tileIndex == 12) gray = texture2D(heightTextures[12], uv).r;
                else if (tileIndex == 13) gray = texture2D(heightTextures[13], uv).r;
                else if (tileIndex == 14) gray = texture2D(heightTextures[14], uv).r;
                else if (tileIndex == 15) gray = texture2D(heightTextures[15], uv).r;

                vec2 elev = tileElevRange[tileIndex];
                float height = mix(elev.x, elev.y, gray);

                return height;
            }
            
            return -1.0;
        }

        float sampleHeight(vec2 worldXZ) {
            // 逐瓦片检测，使用循环遍历所有瓦片
            for (int i = 0; i < MAX_TILES; i++) {
                if (i >= tileCount) break;

                float h = sampleHeightFromTile(i, worldXZ);
                if (h >= 0.0) {
                    return h;
                }
            }
            return 0.0;
        }

        void main() {
            vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;

            float h = sampleHeight(worldPos.xz);
            worldPos.y = h + offset;

            vHeight = h;

            gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
        }
        `;

        // 片段着色器
        const fragmentShader = `
        varying float vHeight;

        void main() {
            gl_FragColor = vec4(0.0, 0.8, 0.3, 1.0);
        }
        `;

        // 创建占位符纹理，防止 uniform 数组为空导致编译错误
        // 使用 DataTexture 确保有效的 WebGL 纹理并保留到实例上以便后续填充
        // 使用 Float32Array 和 RedFormat 与 heightTextures 格式一致
        const placeholderTexture = new THREE.DataTexture(
            new Float32Array([0.5]),
            1,
            1,
            THREE.RedFormat,
            THREE.FloatType
        );
        placeholderTexture.needsUpdate = true;
        placeholderTexture.magFilter = THREE.LinearFilter;
        placeholderTexture.minFilter = THREE.LinearFilter;
        placeholderTexture.minElevation = 0;
        placeholderTexture.maxElevation = 100;
        this.MAX_TILES = MAX_TILES;
        this._placeholderTexture = placeholderTexture;

        // 使用 Array.from() 为每个位置创建独立的对象，避免共享引用
        const placeholderTextures = Array.from({ length: MAX_TILES }, () => placeholderTexture);
        const placeholderBounds = Array.from({ length: MAX_TILES }, () => new THREE.Vector4(0, 0, 1, 1));
        const placeholderElevRange = Array.from({ length: MAX_TILES }, () => new THREE.Vector2(0, 100));

        return new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                heightTextures: { value: placeholderTextures },
                tileBounds: { value: placeholderBounds },
                tileElevRange: { value: placeholderElevRange },
                tileCount: { value: 0 },
                offset: { value: this.offset }
            },
            side: THREE.DoubleSide
        });
    }

    createMesh() {
        return new Promise((resolve, reject) => {
            try {
                const bounds = this.getPolygonBounds(this.threePolygon);
                const { minX, maxX, minZ, maxZ } = bounds;

                const width = maxX - minX;
                const height = maxZ - minZ;

                const centerX = (minX + maxX) / 2;
                const centerZ = (minZ + maxZ) / 2;

                let geometry = new THREE.PlaneGeometry(
                    width,
                    height,
                    this.segments,
                    this.segments
                );

                geometry.rotateX(-Math.PI / 2);
                geometry.translate(centerX, 0, centerZ);

                // 关键：拿到所有相交瓦片，不再限制数量
                const tiles = this.rgbTerrain.getTilesIntersectingPolygon(
                    this.threePolygon
                );

                // 保存相交瓦片信息到实例
                this.terrainTiles = tiles;
                
                // 控制台输出详细调试信息
                console.log('Intersecting tiles found:', tiles.length);
                console.log('Tiles details:', tiles);
                console.log('Original polygon bounds:', bounds);
                
                // 如果没有相交瓦片，输出警告
                if (tiles.length === 0) {
                    console.warn('No intersecting tiles found for the polygon');
                    console.warn('Polygon coordinates:', this.threePolygon);
                    
                    // 如果没有相交瓦片，回退到原多边形边界
                    this.overlayMesh = new THREE.Mesh(geometry, this.material);
                    this.scene.add(this.overlayMesh);
                    resolve(this.overlayMesh);
                    return;
                }
                
                // 计算相交瓦片的外边界
                let minTileX = Infinity;
                let maxTileX = -Infinity;
                let minTileZ = Infinity;
                let maxTileZ = -Infinity;
                
                tiles.forEach(tile => {
                    if (tile.minX < minTileX) minTileX = tile.minX;
                    if (tile.maxX > maxTileX) maxTileX = tile.maxX;
                    if (tile.minZ < minTileZ) minTileZ = tile.minZ;
                    if (tile.maxZ > maxTileZ) maxTileZ = tile.maxZ;
                });
                
                // 创建瓦片外边界对象
                const tileBounds = {
                    minX: minTileX,
                    maxX: maxTileX,
                    minZ: minTileZ,
                    maxZ: maxTileZ
                };
                
                console.log('Tile bounding box:', tileBounds);
                
                // 使用瓦片外边界创建新的几何体
                let tileWidth = tileBounds.maxX - tileBounds.minX;
                let tileHeight = tileBounds.maxZ - tileBounds.minZ;
                let tileCenterX = (tileBounds.minX + tileBounds.maxX) / 2;
                let tileCenterZ = (tileBounds.minZ + tileBounds.maxZ) / 2;
                
                // 创建新的平面几何体，使用瓦片外边界
                const newGeometry = new THREE.PlaneGeometry(
                    tileWidth,
                    tileHeight,
                    this.segments,
                    this.segments
                );
                
                newGeometry.rotateX(-Math.PI / 2);
                newGeometry.translate(tileCenterX, 0, tileCenterZ);
                
                // 更新几何体引用
                geometry.dispose(); // 释放旧几何体资源
                geometry = newGeometry;

                const heightTextures = [];
                const tileUVBounds = [];
                const tileElevRange = [];

                tiles.forEach(tile => {
                    // 确保tile和tile.heightTexture存在
                    if (tile && tile.heightTexture) {
                        heightTextures.push(tile.heightTexture);

                        tileUVBounds.push(
                            new THREE.Vector4(
                                tile.minX,
                                tile.minZ,
                                tile.maxX,
                                tile.maxZ
                            )
                        );

                        tileElevRange.push(
                            new THREE.Vector2(
                                tile.minElevation,
                                tile.maxElevation
                            )
                        );
                    } else {
                        console.warn('Invalid tile or missing heightTexture:', tile);
                    }
                });

                // 填充并保证数组长度为 MAX_TILES，与着色器一致，避免超出纹理单元限制
            const MAX_TILES = this.MAX_TILES || 16;
            const placeholderTexture = this._placeholderTexture || (() => {
                    const t = new THREE.DataTexture(
                        new Float32Array([0.5]),
                        1,
                        1,
                        THREE.RedFormat,
                        THREE.FloatType
                    );
                    t.needsUpdate = true;
                    t.magFilter = THREE.LinearFilter;
                    t.minFilter = THREE.LinearFilter;
                    return t;
                })();

            const paddedHeightTextures = Array.from({ length: MAX_TILES }, (_, i) => heightTextures[i] || placeholderTexture);
            const paddedTileBounds = Array.from({ length: MAX_TILES }, (_, i) => tileUVBounds[i] || new THREE.Vector4(0, 0, 1, 1));
            const paddedTileElevRange = Array.from({ length: MAX_TILES }, (_, i) => tileElevRange[i] || new THREE.Vector2(0, 100));

            this.material.uniforms.heightTextures.value = paddedHeightTextures;
            this.material.uniforms.tileBounds.value = paddedTileBounds;
            this.material.uniforms.tileElevRange.value = paddedTileElevRange;
            this.material.uniforms.tileCount.value = tiles.length;

            this.overlayMesh = new THREE.Mesh(geometry, this.material);
            this.scene.add(this.overlayMesh);

                resolve(this.overlayMesh);
            } catch (e) {
                reject(e);
            }
        });
    }


    /**
     * 更新高度偏移
     * @param {number} offset - 新的高度偏移值
     */
    updateOffset(offset) {
        this.offset = offset;

        // 仅更新材质的uniforms，由GPU实时处理高度偏移
        if (this.material) {
            this.material.uniforms.offset.value = offset;
            console.log('OverlayTerrainMesh高度偏移已更新：', offset);
        }
    }

    /**
     * 使用 renderer 渲染 RGBTerrain 的世界高度贴图并应用到 overlay
     * 该方法会调用 rgbTerrain.renderWorldHeightMap(renderer, bounds, resolution)
     */
    async updateFromTerrain(renderer, resolution = 1024, margin = 16) {
        if (!this.rgbTerrain || !renderer) return;
        
        // 获取多边形边界
        const bounds = this.getPolygonBounds(this.threePolygon);
        
        try {
            // 确保地形瓦片已加载完成
            if (this.rgbTerrain.loadedTerrainTiles.size === 0) {
                console.warn('No terrain tiles loaded, cannot update overlay');
                return;
            }
            
            // 重新获取相交瓦片，确保使用最新的瓦片数据
            const tiles = this.rgbTerrain.getTilesIntersectingPolygon(this.threePolygon);
            this.terrainTiles = tiles;
            
            console.log('updateFromTerrain - Intersecting tiles:', tiles.length);
            
            if (tiles.length === 0) {
                console.warn('No intersecting tiles found in updateFromTerrain');
                return;
            }
            
            // 更新材质的瓦片数据
            const heightTextures = [];
            const tileBounds = [];
            const tileElevRange = [];

            tiles.forEach(tile => {
                if (tile && tile.heightTexture) {
                    heightTextures.push(tile.heightTexture);
                    tileBounds.push(new THREE.Vector4(tile.minX, tile.minZ, tile.maxX, tile.maxZ));
                    tileElevRange.push(new THREE.Vector2(tile.minElevation, tile.maxElevation));
                }
            });
            
            // 填充并保证数组长度为 MAX_TILES，与着色器一致，避免超出纹理单元限制
            const MAX_TILES = this.MAX_TILES || 16;
            const placeholderTexture = this._placeholderTexture;
            
            const paddedHeightTextures = Array.from({ length: MAX_TILES }, (_, i) => heightTextures[i] || placeholderTexture);
            const paddedTileBounds = Array.from({ length: MAX_TILES }, (_, i) => tileBounds[i] || new THREE.Vector4(0, 0, 1, 1));
            const paddedTileElevRange = Array.from({ length: MAX_TILES }, (_, i) => tileElevRange[i] || new THREE.Vector2(0, 100));
            
            // 更新材质uniforms
            if (this.material) {
                this.material.uniforms.heightTextures.value = paddedHeightTextures;
                this.material.uniforms.tileBounds.value = paddedTileBounds;
                this.material.uniforms.tileElevRange.value = paddedTileElevRange;
                this.material.uniforms.tileCount.value = tiles.length;
                
                console.log('Material uniforms updated with', tiles.length, 'tiles');
            }
            
            console.log('updateFromTerrain completed successfully');
        } catch (e) {
            console.error('updateFromTerrain failed', e);
        }
    }

    /**
     * 清理资源
     */
    dispose() {
        if (this.overlayMesh) {
            this.scene.remove(this.overlayMesh);
            this.overlayMesh.geometry.dispose();
            this.overlayMesh.material.dispose();
            this.overlayMesh = null;
        }
    }
}
