import * as THREE from 'three';
import { initMathProj } from './math/proj.js';
import { CameraManager } from './camera/CameraManager.js';
import { Terrain } from './terrain/Terrain.js';
import { AuxiliaryTools } from './utils/AuxiliaryTools.js';
import { ToolManager } from './toolManager/ToolManager.js';
import { MarkerManager } from './marker/marker.js';
export {THREE}
/**
 * 局部地形场景类
 * 实现基于RGB瓦片的地形加载、渲染、编辑和交互功能
 */
export class Viewer {
	    /**
	     * 构造函数
	     * @param {Object} container - DOM容器元素
	     * @param {Object} config - 配置参数
	     */
    constructor(container, config) {
        this.container = container;
        this.config = config;

        // 初始化场景、相机、渲染器
        this.initScene();

	        // 初始化坐标转换工具
	        this.initProj();

	        // 初始化地形
	        this.initTerrain();

	        // 初始化交互
	        this.initInteraction();

        // 初始化工具管理器
        this.initToolManager();

	        // 开始动画循环
	        this.animate();
	    }

    // 相机由 `src/camera/CameraManager.js` 统一管理（便于后续实现瓦片 LOD 逻辑）

    /**
     * 初始化场景、相机、渲染器
     */
    initScene() {
        // 创建场景
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87CEEB);

        // 创建渲染器（优化瓦片缝隙）
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,          // 启用抗锯齿
            alpha: false,             // 禁用alpha通道，避免边缘透明问题
            precision: 'highp',        // 使用高精度渲染
            depthPrecision: 24
        });

        // 设置渲染器大小和像素比
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        // 优化：使用适当的像素比，避免过度渲染
        const pixelRatio = Math.min(window.devicePixelRatio, 2);
        this.renderer.setPixelRatio(pixelRatio);

        // 关键优化：启用阴影映射，提高渲染质量
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // 使用软阴影

        // 优化：启用深度测试和 alpha 混合的高级设置
        this.renderer.autoClear = true;
        this.renderer.autoClearDepth = true;
        this.renderer.autoClearColor = true;

        // 优化：设置渲染器的clear颜色和alpha
        this.renderer.setClearColor(0x87CEEB, 1.0);

        // 优化：启用高精度深度缓冲
        this.renderer.getContext().getExtension('WEBGL_depth_texture');

        this.container.appendChild(this.renderer.domElement);

        // 添加灯光
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(500, 1000, 500);
        this.scene.add(directionalLight);

        // 初始化相机管理器
        this.cameraManager = new CameraManager(this.renderer.domElement, this.scene, this.config?.camera ?? {});
        this.camera = this.cameraManager.getCamera();
        this.controls = this.cameraManager.getControls();

        // 初始化辅助工具
        this.auxiliaryTools = new AuxiliaryTools(this.scene, {
            gridSize: 40000,
            gridDivisions: 40,
            axesSize: 5000
        });
        this._axesSize = 5000;

        // Marker manager (used by measure/draw tools)
        this.markerManager = new MarkerManager(this.scene);

        // 创建坐标轴文字标签（使用 canvas sprite，中文不会变成 ?）
        this.createAxisLabels();

        // 窗口大小变化监听
        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    /**
     * 初始化坐标转换工具
     */
    initProj() {
        // Keep a global MathProj instance in sync for tools (ToolManager uses getMathProj()).
        const centerLon = Number(this.config?.centerLon);
        const centerLat = Number(this.config?.centerLat);
        this.proj = initMathProj({
            centerLon: Number.isFinite(centerLon) ? centerLon : 0,
            centerLat: Number.isFinite(centerLat) ? centerLat : 0
        });
    }

    /**
     * 初始化地形
     */
    initTerrain() {
        // 创建立体地形实例，使用独立的 Terrain 类
        this.terrain = new Terrain(this.scene, this.config, this.onTerrainLoaded.bind(this));
        // Give Terrain access to renderer for local clipping.
        if (this.terrain) {
            this.terrain.renderer = this.renderer;
            this.terrain.imageryTiles?.setRenderer?.(this.renderer);
        }

        // 初始化地形状态
        this.terrainVisible = true;

        // 同步辅助工具和坐标轴标签的高度
        this.updateAuxiliaryToolsHeight(this.terrainVisible);
    }

    /**
     * 加载地形瓦片
     */
    loadTerrainTiles() {
        // 根据配置计算需要加载的瓦片范围
        const { centerLon, centerLat } = this.config;

        // 将经纬度转换为瓦片坐标（XYZ）
        const zoom = this.tileConfig.zoom;
        const tileCenterX = Math.floor((centerLon + 180) / 360 * Math.pow(2, zoom));
        const tileCenterY = Math.floor((1 - Math.log(Math.tan(centerLat * Math.PI / 180) + 1 / Math.cos(centerLat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));

        console.log('Loading terrain tile:', tileCenterX, tileCenterY, zoom);

        // 加载中心瓦片
        this.loadTile(tileCenterX, tileCenterY, zoom);
    }

    /**
     * 加载单个瓦片
     * @param {number} x - 瓦片X坐标
     * @param {number} y - 瓦片Y坐标
     * @param {number} z - 瓦片缩放级别
     */
    loadTile(x, y, z) {
        const tileUrl = this.tileConfig.tileUrl.replace('{z}', z).replace('{x}', x).replace('{y}', y);

        const loader = new THREE.TextureLoader();
        loader.load(tileUrl, (texture) => {
            this.createTerrainFromTexture(texture, x, y, z);
        }, undefined, (error) => {
            console.error('Failed to load terrain tile:', error);
        });
    }

    /**
     * 从RGB纹理创建地形网格
     * @param {THREE.Texture} texture - RGB地形纹理
     * @param {number} tileX - 瓦片X坐标
     * @param {number} tileY - 瓦片Y坐标
     * @param {number} tileZ - 瓦片缩放级别
     */
    createTerrainFromTexture(texture, tileX, tileY, tileZ) {
        const { segments } = this.tileConfig;
        const { rangeEastWest, rangeNorthSouth } = this.config;

        // 使用配置的范围作为地形大小
        const tileWidth = rangeEastWest;  // X轴方向（地理东）
        const tileHeight = rangeNorthSouth;  // Y轴方向（地理北，-Z指向北）

        // 1. 创建PlaneGeometry，默认在XY平面
        const geometry = new THREE.PlaneGeometry(tileWidth, tileHeight, segments, segments);

        // 2. 应用高程数据到 Z 坐标（垂直于 XY 平面）
        this.applyElevationToGeometry(geometry, texture);

        // 3. 材质设置
        const material = new THREE.MeshPhongMaterial({
            color: 0x8B4513,
            wireframe: false,
            side: THREE.DoubleSide,
            flatShading: false
        });

        // 4. 创建地形网格
        const terrainMesh = new THREE.Mesh(geometry, material);
        terrainMesh.position.set(0, 0, 0);

        // 5. 关键：绕 X 轴旋转 90 度，将平面从 XY 平面旋转到 XZ 平面
        // - X 轴保持不变，仍然指向东（+X -> 东）
        // - Z 轴（高程方向）旋转到垂直向上（+Y -> 上）
        // - Y 轴旋转到指向北（-Z -> 北）
        terrainMesh.rotation.x = -Math.PI / 2;

        this.terrainGroup.add(terrainMesh);
        this.terrainMesh = terrainMesh;

        console.log('Terrain mesh created and added to scene');
    }

    /**
     * 将 RGB 纹理的高程数据应用到几何体
     * @param {THREE.BufferGeometry} geometry - 平面几何体
     * @param {THREE.Texture} texture - RGB地形纹理
     */
    applyElevationToGeometry(geometry, texture) {
        const image = texture.image;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);

        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const { segments } = this.tileConfig;

        // 获取顶点位置数组
        const positions = geometry.attributes.position.array;
        const { rangeEastWest, rangeNorthSouth } = this.config;
        const tileWidth = rangeEastWest;
        const tileHeight = rangeNorthSouth;

        // 遍历所有顶点，将高程应用到 Z 坐标（垂直于 XY 平面）
        for (let i = 0; i < positions.length; i += 3) {
            // 获取当前顶点的 X 和 Y 坐标（在平面中的位置）
            const x = positions[i];     // 平面X坐标
            const y = positions[i + 1];   // 平面Y坐标

            // 将平面坐标转换为纹理坐标（0~1）
            const u = (x + tileWidth / 2) / tileWidth;
            const v = (y + tileHeight / 2) / tileHeight;

            // 将纹理坐标转换为像素坐标
            const pixelX = Math.floor(u * (image.width - 1));
            const pixelY = Math.floor(v * (image.height - 1));
            const pixelIndex = (pixelY * image.width + pixelX) * 4;

            // 从 RGB 值计算高程
            const r = pixels[pixelIndex];
            const g = pixels[pixelIndex + 1];
            const b = pixels[pixelIndex + 2];
            const elevation = -10000 + ((r * 256 * 256 + g * 256 + b) * 0.1);

            // 修改Z坐标为高程值（此时Z是垂直于XY平面的方向）
            // 旋转后，这个 Z 轴会变成 Y 轴（垂直向上）
            positions[i + 2] = elevation;
        }

        // 更新几何体
        geometry.attributes.position.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    /**
     * 初始化交互
     */
    initInteraction() {
        // 射线投射器
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // 高程拾取状态
        this.elevationPickEnabled = false;

        // 鼠标点击事件
        this.renderer.domElement.addEventListener('click', this.onMouseClick.bind(this));
    }

    /**
     * 设置高程拾取状态
     * @param {boolean} enabled - 是否启用高程拾取
     */
    setElevationPickEnabled(enabled) {
        this.elevationPickEnabled = enabled;
    }

    /**
     * 查询指定经纬度的高程
     * @param {number} lon - 经度
     * @param {number} lat - 纬度
     * @returns {number} 高程值
     */
    queryElevationByLonLat(lon, lat) {
        if (this.terrain) {
            return this.terrain.getElevationAtLonLat(lon, lat);
        }
        return 0;
    }

    /**
     * 查询指定 Three.js 坐标的高程
     * @param {number} x - Three.js X坐标
     * @param {number} z - Three.js Z坐标
     * @returns {number} 高程值
     */
    queryElevationByThree(x, z) {
        if (this.terrain) {
            console.log(`Querying elevation at Three.js coordinates: (${x}, ${z})`);
            const elevation = this.terrain.getElevationAtThree(x, 0, z);
            console.log(`Query result: ${elevation}`);
            return elevation;
        }
        return 0;
    }

    /**
     * 查询指定墨卡托坐标的高程
     * @param {number} mercatorX - 墨卡托X坐标
     * @param {number} mercatorY - 墨卡托Y坐标
     * @returns {number} 高程值
     */
    queryElevationByMercator(mercatorX, mercatorY) {
        if (this.terrain) {
            return this.terrain.getElevationAtMercator(mercatorX, mercatorY);
        }
        return 0;
    }

    /**
     * 鼠标点击事件处理
     * @param {MouseEvent} event - 鼠标事件
     */
    onMouseClick(event) {
        // 只有在高程拾取启用时才执行拾取
        if (this.elevationPickEnabled) {
            // 计算鼠标在标准化设备坐标中的位置
            this.mouse.x = (event.clientX / this.container.clientWidth) * 2 - 1;
            this.mouse.y = -(event.clientY / this.container.clientHeight) * 2 + 1;

            // 更新射线投射器
            this.raycaster.setFromCamera(this.mouse, this.camera);

            // 检测与地形的交点
            let intersects = [];
            if (this.terrain) {
                const terrainGroup = this.terrain.getTerrainGroup();
                intersects = this.raycaster.intersectObjects(terrainGroup.children);
            }

            if (intersects.length > 0) {
                const intersect = intersects[0];
                const elevation = intersect.point.y;
                console.log('Picked elevation:', elevation);

                // 触发高程拾取事件
                this.onElevationPicked && this.onElevationPicked(elevation, intersect.point);

                // 如果有testToolsUI实例，更新UI显示
                if (this.testToolsUIInstance) {
                    this.testToolsUIInstance.updateElevationPickResult({
                        x: intersect.point.x,
                        y: intersect.point.y,
                        z: intersect.point.z,
                        elevation: elevation
                    });
                }
            }
        }
    }

    /**
     * 判断点是否在多边形内部（射线法）
     * @param {THREE.Vector2} point - 点坐标
     * @param {Array} polygon - 多边形坐标数组 [Vector2, Vector2, ...]
     * @returns {boolean} 是否在内部
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
     * 地形编辑 - 压平/抬升
     * @param {Array} polygon - 多边形坐标数组 [[lon1, lat1], [lon2, lat2], ...]
     * @param {number} depth - 深度/高度参数（正数抬升，负数压平）
     */
    editTerrain(polygon, depth) {
        if (this.terrain) {
            // legacy: treat as raise/lower delta
            this.terrain.raiseLower?.(polygon, depth) ?? this.terrain.editTerrain(polygon, depth);
        }
    }

    /**
     * 抬升/降低：变化量 delta（允许负数）
     */
    raiseLowerTerrain(polygon, delta) {
        if (this.terrain) {
            this.terrain.raiseLower?.(polygon, delta);
        }
    }

    /**
     * 批量抬升/降低：[{ polygon:[[lon,lat],...], delta?: number }, ...]
     */
    raiseLowerTerrainMultiple(list) {
        if (this.terrain) {
            this.terrain.raiseLowerMultiple?.(list);
        }
    }

    /**
     * 整平：目标海拔 targetElevation（允许负数）
     */
    flattenTerrain(polygon, targetElevation) {
        if (this.terrain) {
            this.terrain.flattenTo?.(polygon, targetElevation);
        }
    }

    /**
     * 批量整平：[{ polygon:[[lon,lat],...], targetElevation?: number }, ...]
     */
    flattenTerrainMultiple(list) {
        if (this.terrain) {
            this.terrain.flattenMultiple?.(list);
        }
    }

    /**
     * 清除整平（flatten）造成的编辑补丁与裁剪遮罩（单次 + 批量）。
     * 用于需要“执行/撤销”的场景（例如填挖方测量）。
     */
    clearFlattenTerrain() {
        if (this.terrain) {
            this.terrain.clearFlattenTerrain?.();
        }
    }

    /**
     * 坡面：基于高坡边 AB 生成线性坡面补丁
     * @param {[number, number]} aLonLat - A 点经纬度 [lon, lat]
     * @param {[number, number]} bLonLat - B 点经纬度 [lon, lat]
     * @param {{side?: 'left'|'right', widthHeightRatio?: number, maxHeight?: number, highEdgeSamples?: any[]}} options
     */
    slopeTerrain(aLonLat, bLonLat, options) {
        if (this.terrain) {
            this.terrain.slopeFromAB?.(aLonLat, bLonLat, options);
        }
    }

    /**
     * 批量坡面：[{ aLonLat:[lon,lat], bLonLat:[lon,lat], ... }, ...]
     */
    slopeTerrainMultiple(list) {
        if (this.terrain) {
            this.terrain.slopeMultiple?.(list);
        }
    }

    /**
     * 地形裁剪 - 凸多边形挖洞
     * @param {Array} polygon - 凸多边形坐标数组 [[lon1, lat1], [lon2, lat2], ...]
     */
    clipTerrain(polygon) {
        if (this.terrain) {
            this.terrain.clipTerrain(polygon);
        }
    }

    /**
     * 设置多洞裁剪：[{ polygon:[[lon,lat],...] }, ...]
     */
    setClipTerrains(list) {
        if (this.terrain) {
            this.terrain.setClipTerrains?.(list);
        }
    }

    clearClipTerrain() {
        if (this.terrain) {
            this.terrain.clearClipTerrain?.();
        }
    }

    /**
     * Switch raster base map at runtime (terrain base drape + LOD hot-update atlas).
     * @param {Object} options
     * - Prefer `baseMapType` + `mapToken` (built-in providers), or provide `mapTileUrl`/`mapYtype`/`mapSubdomains`.
     */
    setBaseMap(options = {}) {
        this.config = { ...(this.config || {}), ...(options || {}) };
        this.terrain?.setBaseMap?.(options, this.camera);
    }

    setBaseMapType(baseMapType, options = {}) {
        this.setBaseMap({ ...(options || {}), baseMapType });
    }

    /**
     * 切换地形显示/隐藏
     */
    toggleTerrainVisibility() {
        if (this.terrain) {
            this.terrain.toggleTerrainVisibility();
        }
        this.terrainVisible = !this.terrainVisible;

        // 让辅助工具跟随地形开关调整高度
        this.updateAuxiliaryToolsHeight(this.terrainVisible);
    }

    /**
     * 设置地形可见性
     * @param {boolean} visible - 是否可见
     */
    setTerrainVisibility(visible) {
        if (this.terrain) {
            this.terrain.setTerrainVisibility(visible);
        }
        this.terrainVisible = visible;

        // 让辅助工具跟随地形开关调整高度
        this.updateAuxiliaryToolsHeight(this.terrainVisible);
    }

    /**
     * 设置线框模式
     * @param {boolean} enabled - 是否启用线框模式
     */
    setWireframe(enabled) {
        if (this.terrain) {
            // 获取地形组中的所有网格
            const terrainGroup = this.terrain.getTerrainGroup();
            terrainGroup.children.forEach(child => {
                if (child.isMesh) {
                    child.material.wireframe = enabled;
                }
            });
        }
    }

    /**
     * 设置网格可见性
     * @param {boolean} visible - 是否可见
     */
    setGridVisibility(visible) {
        if (this.auxiliaryTools) {
            this.auxiliaryTools.getGridHelper().visible = visible;
        }
    }

    /**
     * 设置坐标轴可见性
     * @param {boolean} visible - 是否可见
     */
    setAxesVisibility(visible) {
        if (this.auxiliaryTools) {
            this.auxiliaryTools.getAxesHelper().visible = visible;
        }
        if (this.axisLabelGroup) {
            this.axisLabelGroup.visible = visible;
        }
    }

    // === Adapter methods for tools (MeasureToolUI/DrawToolUI) ===
    isRenderingTerrain() {
        // In this project, "terrainVisible" means terrain elevation is enabled.
        return this.terrainVisible === true;
    }

    getElevationAtThreePosition(x, z) {
        if (!this.terrain) return 0;
        return this.terrain.sampleHeightAtWorld?.(Number(x) || 0, Number(z) || 0, 'heightmap') ?? 0;
    }

    getRayTerrainIntersection(ray, options = {}) {
        if (!ray || !this.terrain || this.terrainVisible !== true) return null;
        const maxDistance = Number.isFinite(options.maxDistance) ? Number(options.maxDistance) : 10000;
        const step = Number.isFinite(options.step) ? Math.max(0.1, Number(options.step)) : 20;
        const tolerance = Number.isFinite(options.tolerance) ? Math.max(0.001, Number(options.tolerance)) : 0.1;

        const origin = ray.origin;
        const dir = ray.direction;
        if (!origin || !dir) return null;

        let tPrev = 0;
        let pPrev = origin.clone();
        let hPrev = this.getElevationAtThreePosition(pPrev.x, pPrev.z);
        let sPrev = pPrev.y - hPrev;

        if (Math.abs(sPrev) <= tolerance) return new THREE.Vector3(pPrev.x, hPrev, pPrev.z);

        for (let t = step; t <= maxDistance; t += step) {
            const p = origin.clone().addScaledVector(dir, t);
            const h = this.getElevationAtThreePosition(p.x, p.z);
            const s = p.y - h;

            if (Math.abs(s) <= tolerance) return new THREE.Vector3(p.x, h, p.z);

            // Detect crossing of the height field.
            if ((sPrev > 0 && s < 0) || (sPrev < 0 && s > 0)) {
                let a = tPrev;
                let b = t;
                let sa = sPrev;

                for (let i = 0; i < 20; i++) {
                    const m = (a + b) * 0.5;
                    const pm = origin.clone().addScaledVector(dir, m);
                    const hm = this.getElevationAtThreePosition(pm.x, pm.z);
                    const sm = pm.y - hm;
                    if (Math.abs(sm) <= tolerance) return new THREE.Vector3(pm.x, hm, pm.z);

                    if ((sa > 0 && sm > 0) || (sa < 0 && sm < 0)) {
                        a = m;
                        sa = sm;
                    } else {
                        b = m;
                    }
                }

                const pm = origin.clone().addScaledVector(dir, (a + b) * 0.5);
                const hm = this.getElevationAtThreePosition(pm.x, pm.z);
                return new THREE.Vector3(pm.x, hm, pm.z);
            }

            tPrev = t;
            pPrev = p;
            hPrev = h;
            sPrev = s;
        }

        return null;
    }

    /**
     * 更新辅助工具和坐标轴标签的高度
     * @param {boolean} terrainVisible - 地形是否可见
     */
    updateAuxiliaryToolsHeight(terrainVisible) {
        // 获取地形高程
        let height = 0;
        if (terrainVisible && this.terrain) {
            // 获取场景中心的高程（Three.js 坐标为 0,0,0）
            console.log('Updating auxiliary tools height, querying elevation at scene center (0, 0, 0)');

            // 尝试获取场景中心的高程
            height = this.terrain.getElevationAtThree(0, 0, 0);
            console.log('Scene center elevation from getElevationAtThree:', height);

            // 如果高程为 0，尝试从地形网格中获取
            if (height === 0) {
                console.log('Trying to get elevation from terrain meshes...');
                const terrainGroup = this.terrain.getTerrainGroup();

                // 遍历所有地形网格，获取平均高程
                let sum = 0;
                let count = 0;

                terrainGroup.children.forEach(child => {
                    if (child.isMesh) {
                        const geometry = child.geometry;
                        const positionAttribute = geometry.attributes.position;

                        // 计算网格的平均高程
                        let meshSum = 0;
                        let meshCount = 0;

                        for (let i = 0; i < positionAttribute.count; i++) {
                            meshSum += positionAttribute.getY(i);
                            meshCount++;
                        }

                        if (meshCount > 0) {
                            sum += meshSum / meshCount;
                            count++;
                        }
                    }
                });

                if (count > 0) {
                    height = sum / count;
                    console.log('Average elevation from terrain meshes:', height);
                }
            }
        }

        // 让辅助工具跟随地形开关调整高度
        if (this.auxiliaryTools) {
            this.auxiliaryTools.followTerrain(terrainVisible, height);
        }

        // 更新坐标轴标签的位置（与坐标轴长度/高度保持一致）
        if (typeof this._updateAxisLabelPositions === 'function') {
            this._updateAxisLabelPositions(height);
        }
    }

    /**
     * 地形瓦片加载完成后更新辅助工具高度
     */
    onTerrainLoaded() {
        console.log('Terrain loaded, updating auxiliary tools height');
        this.updateAuxiliaryToolsHeight(this.terrainVisible);
    }

    /**
     * 窗口大小变化处理
     */
    onWindowResize() {
        this.cameraManager?.updateProjection?.();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }

    /**
     * 创建坐标轴文字标签
     */
    createAxisLabels() {
        // Use canvas sprites for labels:
        // - Avoid remote font loading
        // - Chinese characters render with system fonts
        // - Visibility stays in sync with the AxesHelper
        const makeLabelSprite = (text, color = '#ffffff') => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const w = 512;
            const h = 128;
            canvas.width = w;
            canvas.height = h;

            ctx.clearRect(0, 0, w, h);
            ctx.font = 'bold 64px "Microsoft YaHei", "Noto Sans CJK SC", "PingFang SC", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            ctx.lineWidth = 10;
            ctx.strokeStyle = 'rgba(0,0,0,0.75)';
            ctx.strokeText(text, w / 2, h / 2);

            ctx.fillStyle = color;
            ctx.fillText(text, w / 2, h / 2);

            const tex = new THREE.CanvasTexture(canvas);
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.anisotropy = 4;
            tex.needsUpdate = true;

            const mat = new THREE.SpriteMaterial({
                map: tex,
                transparent: true,
                depthTest: false,
                depthWrite: false
            });
            mat.toneMapped = false;

            const spr = new THREE.Sprite(mat);
            spr.renderOrder = 999999;
            return spr;
        };

        if (this.axisLabelGroup) {
            try { this.scene.remove(this.axisLabelGroup); } catch {}
            this.axisLabelGroup = null;
        }

        const group = new THREE.Group();
        group.name = 'AxisLabels';
        this.axisLabelGroup = group;

        const xLabel = makeLabelSprite('X(东)');
        const yLabel = makeLabelSprite('Y(上)');
        const zLabel = makeLabelSprite('Z(南)');
        group.add(xLabel, yLabel, zLabel);
        this.scene.add(group);

        this.axisLabels = { xLabel, yLabel, zLabel };

        this._updateAxisLabelPositions = (baseY = 0) => {
            const axesSize = (() => {
                const s0 = Number(this._axesSize);
                if (Number.isFinite(s0) && s0 > 0) return s0;
                const s1 = Number(this.auxiliaryTools?.config?.axesSize);
                if (Number.isFinite(s1) && s1 > 0) return s1;
                const s2 = Number(this.auxiliaryTools?.getAxesHelper?.()?.size);
                if (Number.isFinite(s2) && s2 > 0) return s2;
                return 5000;
            })();

            const pad = axesSize * 0.06;
            const end = axesSize + pad;

            xLabel.position.set(end, baseY, 0);
            yLabel.position.set(0, baseY + end, 0);
            zLabel.position.set(0, baseY, end);

            const labelW = Math.max(50, axesSize * 0.12);
            const labelH = labelW * (128 / 512);
            xLabel.scale.set(labelW, labelH, 1);
            yLabel.scale.set(labelW, labelH, 1);
            zLabel.scale.set(labelW, labelH, 1);
        };

        // Initial placement at current height.
        const y0 = Number(this.auxiliaryTools?.currentHeight) || 0;
        this._updateAxisLabelPositions(y0);
    }

    /**
     * 动画循环
     */
    animate() {
       // --- FPS 计算新增变量 ---
        if (!this.fpsLastTime) {
            this.fpsLastTime = performance.now(); // 记录上一次计算FPS的时间点
            this.fpsFrameCount = 0;                // 记录经过的帧数
        }
        // --- FPS 计算新增变量 ---

        requestAnimationFrame(this.animate.bind(this));

        // 更新控制器
        this.cameraManager?.updateControls?.();

        // Axis labels are sprites (always face the camera)

        // 卫星影像（地形材质底图 + atlas shader 局部高清覆盖）
        this.terrain?.updateImagery?.(this.camera);

        this.renderer.render(this.scene, this.camera);

        // --- FPS 计算逻辑 ---
        this.fpsFrameCount++;
        const now = performance.now();
        const elapsed = now - this.fpsLastTime;
        if (elapsed >= 1000) { // 每隔1000毫秒（1秒）执行一次
            const currentFps = Math.round((this.fpsFrameCount * 1000) / elapsed);
            console.log("Current FPS:", currentFps); // 打印到控制台
            this.currentFps=currentFps
            // 重置计数器
            this.fpsLastTime = now;
            this.fpsFrameCount = 0;
        }
        // --- FPS 计算逻辑 ---
    }

    /**
     * 初始化工具管理器
     */
    initToolManager() {
        // 初始化工具管理器
        this.toolManager = new ToolManager({
            scene: this.scene,
            camera: this.camera,
            renderer: this.renderer,
            controls: this.controls,
            rgbTerrain: this,
            markerManager: this.markerManager,
            config: this.config
        });

        // 创建工具栏
        this.toolManager.createToolbar();
    }

    /**
     * 销毁场景
     */
    dispose() {
        window.removeEventListener('resize', this.onWindowResize.bind(this));
        this.renderer.domElement.removeEventListener('click', this.onMouseClick.bind(this));

        // 销毁工具管理器
        if (this.toolManager) {
            this.toolManager.dispose();
        }

        // 销毁辅助工具
        if (this.auxiliaryTools) {
            this.auxiliaryTools.dispose();
        }

        this.container.removeChild(this.renderer.domElement);
        this.renderer.dispose();
    }
}
