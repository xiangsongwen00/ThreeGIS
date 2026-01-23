import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RGBTerrain } from './Terrain/rgbTerrain.js';
import { OverlayTerrainMesh } from './Terrain/overlayTerrainMesh.js';
import { addXYZAxisLabel } from './tool/tool.js';
import { MapXYZ } from './map/mapXYZ.js';
import { initMathProj, getMathProj } from './Math/mathProj.js';
import { CameraTool } from './camera/cameraTool.js';
import { infoManager } from './infoTool/infoManager.js';
import { ModelManager } from './model/ModelManager.js';
import { ToolManager } from './toolManager/ToolManager.js';
import { MarkerManager } from './marker/marker.js';

// ===================== 核心配置项 =====================
const CONFIG = {
    // 105.29197,28.83638,0.00
    centerLon: 105.29197,
    centerLat: 28.83638,
    rangeEastWest: 3000,   // 东西范围
    rangeNorthSouth: 3000, // 南北范围（Z轴，-Z=北）
    mapZoom: 18,           // 地图层级
    terrainZoom: 13        // 地形层级
};

// ===================== 初始化Three.js场景 =====================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);

// 添加光源（让地形光影和纹理显示正常）
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(500, 1000, 500);
scene.add(directionalLight);

// 获取container元素
const container = document.getElementById('container');

// 初始化全局坐标转换工具
initMathProj({
    centerLon: CONFIG.centerLon,
    centerLat: CONFIG.centerLat
});

console.log('全局坐标转换工具已初始化');
console.log('当前场景中心Web墨卡托坐标：', getMathProj().getCenterMercator());

// 相机 - 天顶俯视
const camera = new THREE.PerspectiveCamera(
    60,
    container.clientWidth / container.clientHeight,
    1,
    50000
);
camera.position.set(0, 2000, 0); // 抬高视角，看清地形起伏
camera.lookAt(0, 0, 0);
scene.add(camera);

// 渲染器
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// 控制器
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2 - 0.01;
controls.target.set(0, 0, 0);

// ===================== 辅助元素 =====================
// 1. 坐标轴辅助线 - 初始隐藏
const axesHelper = new THREE.AxesHelper(1000);
axesHelper.visible = false; // 初始化隐藏
scene.add(axesHelper);

// 3. 场景边界框（已移除）
// const boundaryBox = new THREE.Box3(
//     new THREE.Vector3(-CONFIG.rangeEastWest, -10, -CONFIG.rangeNorthSouth),
//     new THREE.Vector3(CONFIG.rangeEastWest, 500, CONFIG.rangeNorthSouth) // 扩大Y轴范围，适配地形高程
// );
// const boxHelper = new THREE.Box3Helper(boundaryBox, 0x00ff00);
// scene.add(boxHelper);

// 3. 瓦片边界网格容器 - 初始隐藏
const tileBoundariesGroup = new THREE.Group();
tileBoundariesGroup.visible = false; // 初始化隐藏
scene.add(tileBoundariesGroup);

// 存储瓦片边界信息
const tileBoundariesInfo = {
    satelliteOffset: 200, // 卫星瓦片边界相对于地形的偏移
    terrainOffset: 250,   // 地形瓦片边界相对于地形的偏移
    baseHeight: 0         // 基础地形高度（原点处的地形高度）
};

// ===================== 加载地图和地形 =====================

// 1. 先加载卫星地图瓦片（仅加载纹理，不创建网格）
// 使用自动检测flipY设置的功能，无需硬编码
const Mapper = new MapXYZ({
    scene: scene,
    centerLon: CONFIG.centerLon,
    centerLat: CONFIG.centerLat,
    rangeEastWest: CONFIG.rangeEastWest,
    rangeNorthSouth: CONFIG.rangeNorthSouth,
    zoom: CONFIG.mapZoom,
    terrainZoom: CONFIG.terrainZoom, // 传递地形瓦片缩放级别
    tileUrl: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
    // 移除硬编码的flipY值，使用自动检测功能
    // flipY: true, // 系统会根据URL自动检测
});

// 2. 创建地形瓦片加载器
// 确保地形层级不大于地图层级，避免纹理对齐问题
const effectiveTerrainZoom = Math.min(CONFIG.terrainZoom, CONFIG.mapZoom);
const rgbTerrain = new RGBTerrain({
    scene: scene,
    centerLon: CONFIG.centerLon,
    centerLat: CONFIG.centerLat,
    rangeEastWest: CONFIG.rangeEastWest,
    rangeNorthSouth: CONFIG.rangeNorthSouth,
    zoom: effectiveTerrainZoom,
    tileUrl: 'https://tiles1.geovisearth.com/base/v1/terrain-rgb/{z}/{x}/{y}?format=png&tmsIds=w&token=a1b140c94dba53eef3541ed85e72e2df16bfa63d8065f0d8a6e16604a035cbe0',
    segments: 32
});

// 输出实际使用的地形层级
console.log(`地图层级：${CONFIG.mapZoom}级，地形层级：${effectiveTerrainZoom}级（实际使用）`);

// 3. 初始化相机工具，用于禁止相机进入地下
const cameraTool = new CameraTool({
    camera: camera,
    rgbTerrain: rgbTerrain
});

// 4. 初始化模型管理器
const modelManager = new ModelManager({
    scene: scene,
    rgbTerrain: rgbTerrain,
    mathProj: getMathProj(),
    animationControl: {
        enabled: true,
        frameRate: 60,
        deltaTime: 1 / 60,
        paused: false
    }
});

// 5. 初始化标记管理器
const markerManager = new MarkerManager(scene);

// 6. 初始化工具管理器
const toolManager = new ToolManager({
    scene: scene,
    camera: camera,
    renderer: renderer,
    controls: controls,
    rgbTerrain: rgbTerrain,
    modelManager: modelManager,
    markerManager: markerManager,
    // 传递CONFIG信息，用于创建加载信息面板
    centerLon: CONFIG.centerLon,
    centerLat: CONFIG.centerLat,
    rangeEastWest: CONFIG.rangeEastWest,
    rangeNorthSouth: CONFIG.rangeNorthSouth,
    zoom: CONFIG.mapZoom,
    effectiveTerrainZoom: effectiveTerrainZoom
});

// 初始化信息管理器
infoManager.updateUserConfig({
    centerLon: CONFIG.centerLon,
    centerLat: CONFIG.centerLat,
    rangeEastWest: CONFIG.rangeEastWest,
    rangeNorthSouth: CONFIG.rangeNorthSouth,
    mapZoom: CONFIG.mapZoom,
    terrainZoom: CONFIG.terrainZoom
});

// 更新相机限制范围
infoManager.updateCameraInfo(
    camera.position,
    controls.target,
    {
        minX: -CONFIG.rangeEastWest,
        maxX: CONFIG.rangeEastWest,
        minZ: -CONFIG.rangeNorthSouth,
        maxZ: CONFIG.rangeNorthSouth
    }
);

// 更新地图瓦片范围
if (Mapper.tileRange) {
    infoManager.updateMapTileBounds(Mapper.tileRange);
}

// 更新地形瓦片范围
if (rgbTerrain.tileRange) {
    infoManager.updateTerrainTileBounds(rgbTerrain.tileRange);
}

// 4. 先加载卫星地图，再加载地形，并将卫星纹理传递给地形材质
Mapper.load().then(() => {
    console.log('所有卫星地图瓦片加载完成');
    infoManager.setMapLoaded(true);

    // 获取卫星纹理
    const satelliteTextures = Mapper.getLoadedTextures();

    // 加载地形，并在渲染时使用卫星纹理
    return rgbTerrain.load(satelliteTextures).then(() => {

        infoManager.setTerrainLoaded(true);

        // 地形加载完成后，设置相机工具有地形状态
        cameraTool.setHasTerrain(true);
        infoManager.setHasTerrain(true);

        // 地形加载完成后，调整坐标轴和标签位置
        if (rgbTerrain.renderTerrain) {
            const originHeight = rgbTerrain.getTerrainHeight(0, 0);
            axesHelper.position.y = originHeight;

            // 调整坐标轴标签位置
            if (axisLabelsInfo && axisLabelsInfo.labelGroup) {
                axisLabelsInfo.labelGroup.position.y = originHeight;
            }

            console.log(`地形加载完成后，坐标轴和标签已抬升至地形高度：${originHeight.toFixed(2)}米`);
        }

        // 绘制瓦片边界：绿色为卫星瓦片，蓝色为地形瓦片


        // 计算基础地形高度（原点处的地形高度）
        tileBoundariesInfo.baseHeight = rgbTerrain.getTerrainHeight(0, 0);

        // 绘制瓦片边界，传入相对于地形的偏移量
        const satelliteY = tileBoundariesInfo.baseHeight + tileBoundariesInfo.satelliteOffset;
        const terrainY = tileBoundariesInfo.baseHeight + tileBoundariesInfo.terrainOffset;

        Mapper.drawTileBoundaries(tileBoundariesGroup, satelliteY);
        rgbTerrain.drawTileBoundaries(tileBoundariesGroup, terrainY);

        // 确保瓦片边界组初始隐藏，直到用户点击坐标轴工具才显示
        tileBoundariesGroup.visible = false;

        console.log(`瓦片边界绘制完成，基础高度：${tileBoundariesInfo.baseHeight.toFixed(2)}米，卫星偏移：${tileBoundariesInfo.satelliteOffset}米，地形偏移：${tileBoundariesInfo.terrainOffset}米`);

        // 创建更新瓦片边界高程的函数
        window.updateTileBoundariesElevation = function () {
            // 清空现有边界
            tileBoundariesGroup.clear();

            // 重新计算基础地形高度
            tileBoundariesInfo.baseHeight = rgbTerrain.getTerrainHeight(0, 0);

            // 重新绘制瓦片边界
            const satelliteY = tileBoundariesInfo.baseHeight + tileBoundariesInfo.satelliteOffset;
            const terrainY = tileBoundariesInfo.baseHeight + tileBoundariesInfo.terrainOffset;

            Mapper.drawTileBoundaries(tileBoundariesGroup, satelliteY);
            rgbTerrain.drawTileBoundaries(tileBoundariesGroup, terrainY);

            console.log(`瓦片边界高程已更新，基础高度：${tileBoundariesInfo.baseHeight.toFixed(2)}米`);
        };

        // 地形加载完成后，打印信息摘要
        infoManager.printSummary();

        // 创建工具栏
        toolManager.createToolbar();

        // 地图和地形加载完成后，加载GLB模型
        console.log('开始加载GLB模型...');

        // 模型配置
        const modelConfig = {
            modelId: 'wjj_model',
            name: '挖掘机模型', // 模型名称
            modelPath: './src/assest/data/gltf/wjj.glb',
            type: 'Excavator', // 模型类型：Excavator挖掘机、Bulldozer推土机、SoilCompactor压土机、Men人物、Others其他
            info: {
                // 施工信息字段
                modelName: '挖掘机',
                manufacturer: '未知',
                modelNumber: 'WJJ-001',
                constructionCompany: '施工公司',
                operator: '操作员',
                startTime: new Date().toISOString()
            },
            lon: CONFIG.centerLon - 0.0015, // 使用配置的中心经度
            lat: CONFIG.centerLat, // 使用配置的中心纬度
            heightOffset: 0// 高度偏移量，50表示模型底部在地形表面上方50米
        };

        // 加载第一个模型，启用动画
        modelManager.loadModel(modelConfig.modelId, modelConfig.modelPath, {
            name: modelConfig.name,
            info: modelConfig.info,
            animation: {
                enabled: true,  // 启用动画
                clipIndex: 0,   // 播放第一个动画剪辑
                speed: 1.0,     // 动画速度
                loop: true      // 循环播放
            }
        })
            .then((model) => {
                console.log('第一个GLB模型加载成功，开始放置模型...');

                // 设置模型类型
                modelManager.setModelType(modelConfig.modelId, modelConfig.type);
                console.log('第一个模型类型已设置：', modelConfig.type);

                // 根据经纬度放置模型，使用地形采样的高程
                return modelManager.placeModelAtLonLat(
                    modelConfig.modelId,
                    modelConfig.lon,
                    modelConfig.lat,
                    modelConfig.heightOffset
                );
            })
            .then((model) => {
                console.log('第一个GLB模型已成功放置在地形上，开始设置缩放比例...');

                // 设置模型缩放比例为10倍
                modelManager.setModelScale(modelConfig.modelId, [1.2, 1.2, 1.2]);
                console.log('第一个GLB模型缩放比例已设置为10倍');

                // 将模型赋值给初始化标志，确保在动画第一帧执行初始化
                modelToInitialize = model;
                console.log('第一个模型已准备好，等待动画第一帧初始化...');

                // 手动播放动画，确保动画正确启动
                modelManager.playAnimation(modelConfig.modelId, 0);
                console.log('手动播放第一个模型动画');

                // 打印动画信息，用于调试
                console.log('第一个模型动画信息：', {
                    animationsCount: model.userData.animations.length,
                    animationMixer: !!model.userData.animationMixer,
                    actionsCount: model.userData.animationActions.length,
                    currentAction: !!model.userData.currentAction
                });

                // 创建第二个挖掘机模型配置
                const secondModelConfig = {
                    modelId: 'wjj_model_2',
                    name: '挖掘机模型2',
                    modelPath: './src/assest/data/gltf/wjj.glb',
                    type: 'Excavator',
                    info: {
                        modelName: '挖掘机2',
                        manufacturer: '未知',
                        modelNumber: 'WJJ-002',
                        constructionCompany: '施工公司',
                        operator: '操作员2',
                        startTime: new Date().toISOString()
                    },
                    lon: CONFIG.centerLon - 0.001, // 在第一个模型东边一点
                    lat: CONFIG.centerLat,
                    heightOffset: 1
                };

                // 加载第二个模型
                return modelManager.loadModel(secondModelConfig.modelId, secondModelConfig.modelPath, {
                    name: secondModelConfig.name,
                    info: secondModelConfig.info,
                    animation: {
                        enabled: true,
                        clipIndex: 0,
                        speed: 1.0,
                        loop: true
                    }
                });
            })
            .then((secondModel) => {
                console.log('第二个GLB模型加载成功，开始放置模型...');

                // 设置第二个模型的类型
                modelManager.setModelType('wjj_model_2', 'Excavator');
                console.log('第二个模型类型已设置：Excavator');

                // 放置第二个模型
                return modelManager.placeModelAtLonLat(
                    'wjj_model_2',
                    CONFIG.centerLon - 0.001, // 在第一个模型东边一点
                    CONFIG.centerLat,
                    1
                );
            })
            .then((secondModel) => {
                console.log('第二个GLB模型已成功放置在地形上，开始设置缩放比例...');

                // 设置第二个模型缩放比例为10倍
                modelManager.setModelScale('wjj_model_2', [1.2, 1.2, 1.2]);
                console.log('第二个GLB模型缩放比例已设置为10倍');

                // 手动播放第二个模型的动画
                modelManager.playAnimation('wjj_model_2', 0);
                console.log('手动播放第二个模型动画');

                // 打印第二个模型的动画信息，用于调试
                console.log('第二个模型动画信息：', {
                    animationsCount: secondModel.userData.animations.length,
                    animationMixer: !!secondModel.userData.animationMixer,
                    actionsCount: secondModel.userData.animationActions.length,
                    currentAction: !!secondModel.userData.currentAction
                });
            })
            .catch((error) => {
                console.error('GLB模型加载或放置失败:', error);
            });
    }).then(() => {
        // 地图和地形加载完成后，创建PolygonTerrain示例
        console.log('开始创建PolygonTerrain示例...');

        // 计算示例多边形的经纬度范围：以中心坐标为基准，东西偏0.01度，南北偏0.01度
        const centerLon = CONFIG.centerLon;
        const centerLat = CONFIG.centerLat;
        const offset = 0.01; // 偏移量

        // 创建多边形坐标数组（经纬度格式）
        const polygon = [
            { lon: centerLon - offset, lat: centerLat + offset }, // 左上角
            { lon: centerLon + offset, lat: centerLat + 2 * offset },
            { lon: centerLon + 2 * offset, lat: centerLat + offset }, // 右上角
            { lon: centerLon + 2 * offset, lat: centerLat - offset }, // 右下角
            { lon: centerLon - offset, lat: centerLat - offset }  // 左下角
        ];

        // 初始化OverlayTerrainMesh实例
        const overlayTerrain = new OverlayTerrainMesh({
            scene: scene,
            polygon: polygon,
            rgbTerrain: rgbTerrain, // 传递RGBTerrain实例，用于获取高程数据
            offset: 700, // 比地形高100米
            segments: 256 // 细分段数，降低分段数提高性能
        });

        // 创建覆盖地形网格
        overlayTerrain.createMesh().then(mesh => {
            console.log('OverlayTerrainMesh示例创建成功！');
            console.log('示例范围：', polygon);

            // 绘制红色多边形，高程700
            const elevation = 700;
            const mathProj = rgbTerrain.mathProj;

            // 将经纬度坐标转换为Three.js坐标，设置高程为700
            const threePolygon = polygon.map(point => {
                const threePos = mathProj.lonLatToThree(point.lon, point.lat);
                return new THREE.Vector3(threePos.x, elevation, threePos.z);
            });

            // 创建多边形几何体
            const polygonGeometry = new THREE.BufferGeometry().setFromPoints(threePolygon);

            // 创建红色材质
            const polygonMaterial = new THREE.LineBasicMaterial({
                color: 0xff0000, // 红色
                linewidth: 2 // 线宽
            });

            // 创建线环（闭合多边形）
            const polygonLine = new THREE.LineLoop(polygonGeometry, polygonMaterial);

            // 添加到场景
            scene.add(polygonLine);

            console.log('红色多边形绘制完成，高程：', elevation);
        }).catch(error => {
            console.error('OverlayTerrainMesh示例创建失败：', error);
        });
    });
}).catch((error) => {
    console.error('地图或地形加载失败：', error);
    if (error.message.includes('地图')) {
        infoManager.setMapLoaded(false);
    } else if (error.message.includes('地形')) {
        infoManager.setTerrainLoaded(false);
    }
});

// ===================== 辅助工具 =====================
// 保存坐标轴标签信息，以便后续调整位置
let axisLabelsInfo = addXYZAxisLabel(scene);
// 初始隐藏坐标方向信息
if (axisLabelsInfo && axisLabelsInfo.labelGroup) {
    axisLabelsInfo.labelGroup.visible = false;
}
// 移除初始化时的addLoadingInfo调用，改为在测试UI打开时执行

// 初始化加载信息面板变量
let loadingInfo = null;
window.loadingInfo = null;

// ===================== 动画循环 =====================
// 模型初始化标志
let modelInitialized = false;
let modelToInitialize = null;
let currentFrame = 0; // 当前动画帧计数器

// 动画参数控制
let animationParams = {
    deltaTime: 1 / 60  // 初始时间增量
};

// 模型初始化配置
let modelInitConfig = {
    frameIndex: 40 // 自定义初始化帧索引，默认为0（第一帧）
};

function animate() {
    requestAnimationFrame(animate);
    controls.update();

    // 更新相机位置，禁止相机进入地下
    cameraTool.updateCameraPosition();

    // 检查并处理模型初始化（在指定帧执行）
    if (modelToInitialize && !modelInitialized && currentFrame === modelInitConfig.frameIndex) {
        console.log(`在动画第${currentFrame}帧执行模型初始化...`);
        modelInitialized = true;
        // 这里可以添加额外的模型初始化逻辑
    }

    // 更新模型动画，使用外部可设置的参数
    modelManager.updateAnimations(animationParams.deltaTime);

    renderer.render(scene, camera);

    // 增加帧计数器
    currentFrame++;
}
animate();

// 将modelManager、动画控制参数和模型初始化配置暴露给全局，以便外部访问
window.modelManager = modelManager;
window.animationParams = animationParams;
window.modelInitConfig = modelInitConfig;
window.currentFrame = currentFrame;

// 保存原始的setRenderTerrain方法
const originalSetRenderTerrain = rgbTerrain.setRenderTerrain;

// 重写setRenderTerrain方法，添加调整坐标轴位置的功能
rgbTerrain.setRenderTerrain = function (render) {
    // 调用原始方法
    originalSetRenderTerrain.call(this, render);

    // 调整坐标轴和标签的位置
    if (render) {
        // 开启地形：获取原点处的地形高度，并调整所有元素位置
        const originHeight = this.getTerrainHeight(0, 0);
        axesHelper.position.y = originHeight;

        // 调整坐标轴标签位置
        if (axisLabelsInfo && axisLabelsInfo.labelGroup) {
            axisLabelsInfo.labelGroup.position.y = originHeight;
        }

        console.log(`坐标轴和标签已抬升至地形高度：${originHeight.toFixed(2)}米`);
    } else {
        // 关闭地形：将所有元素位置设置为0
        axesHelper.position.y = 0;

        // 调整坐标轴标签位置
        if (axisLabelsInfo && axisLabelsInfo.labelGroup) {
            axisLabelsInfo.labelGroup.position.y = 0;
        }

        console.log('坐标轴和标签已恢复到0高度');
    }

    // 更新瓦片边界高程
    if (window.updateTileBoundariesElevation) {
        window.updateTileBoundariesElevation();
    }
};



// ===================== 窗口自适应 + 调试控制 =====================
window.addEventListener('resize', () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
});

window.addEventListener('keydown', (e) => {
    switch (e.key.toLowerCase()) {
        case 'r': // 重置相机
            camera.position.set(0, 2000, 0);
            camera.lookAt(0, 0, 0);
            controls.target.set(0, 0, 0);
            break;
        case 'a': // 显示/隐藏坐标轴（同步瓦片网格）
        case 't': // 显示/隐藏瓦片边界（同步坐标轴）
            // 切换坐标轴显示/隐藏
            const newAxesState = !axesHelper.visible;
            axesHelper.visible = newAxesState;

            // 同时切换坐标轴标签的显示/隐藏
            if (axisLabelsInfo && axisLabelsInfo.labelGroup) {
                axisLabelsInfo.labelGroup.visible = newAxesState;
            }

            // 同步切换瓦片网格的显示/隐藏
            tileBoundariesGroup.visible = newAxesState;

            console.log(`坐标轴和瓦片网格已${newAxesState ? '显示' : '隐藏'}`);
            break;
        case 'm': // 显示/隐藏地形标记
            rgbTerrain.toggleMarkers();
            break;
    }
});

// 初始化地形渲染状态，调整坐标轴和标签位置
if (rgbTerrain.renderTerrain) {
    // 等待地形加载完成后再调整位置，避免获取到不正确的高度
    setTimeout(() => {
        const originHeight = rgbTerrain.getTerrainHeight(0, 0);
        axesHelper.position.y = originHeight;

        // 调整坐标轴标签位置
        if (axisLabelsInfo && axisLabelsInfo.labelGroup) {
            axisLabelsInfo.labelGroup.position.y = originHeight;
        }

        console.log(`初始坐标轴和标签已抬升至地形高度：${originHeight.toFixed(2)}米`);
    }, 1000); // 延迟1秒，确保地形已加载完成
}
