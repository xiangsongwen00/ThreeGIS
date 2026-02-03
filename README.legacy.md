# (Legacy) Three-Map-Terrain

## 介绍
Three.js 地图地形渲染库，专注于局部3D地理场景，支持卫星地图和地形瓦片加载，提供完整的坐标转换、高程查询、模型加载和动画控制功能。

## 核心业务逻辑
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EEEE
### 1. 坐标转换系统
- 高精度坐标转换工具 `MathProj`
- 支持经纬度 ↔ Web墨卡托 ↔ Three.js坐标
- 统一的坐标转换接口，确保各组件间的一致性
- 地球半径参数优化，与Python验证结果完全一致
- 高精度距离计算（Web Mercator距离和测地距离）
- 坐标系定义
    - 经纬度：WGS84（EPSG:4326）
    - Web墨卡托：EPSG:3857
    - Three.js坐标：本地坐标系统，基于地图中心
    - three Y轴：垂直向上，与Web墨卡托的Z一致
    - three Z轴：指向正南，与Web墨卡托的-Y一致
    - three X轴：指向正东，与Web墨卡托的X一致
    - three (x, y, z)：地理对齐（经度、高程、-纬度） 地理方向对齐（东、上、南）
    - 总之three -z对齐地理北，x对齐地理东，y对齐地理上

### 2. 地图与地形渲染
- 卫星地图瓦片加载与渲染
- 地形瓦片加载与渲染
- 无缝地形瓦片（修复了边界缝隙问题）
- 地形渲染切换功能（可开启/关闭真实高程）
- 灰度高程纹理显示
- 卫星影像与地形瓦片融合
- 瓦片边界可视化（地形瓦片：蓝色，卫星瓦片：绿色）
- 瓦片边界始终比地形高100米，便于观察

### 3. 高程查询
- 支持多种坐标类型的高程查询（Three.js、经纬度、墨卡托）
- 统一的高程查询接口
- 支持地形渲染开启/关闭两种模式下的高程查询
- 高精度高程计算
- 非地形状态下返回0，符合用户期望
- 优化的查询性能

### 4. 标记点管理
- 支持创建和管理多个标记点
- 支持标记点标签
- 支持临时标记点（自动删除）
- 智能贴地功能（可选择是否贴地）
- 支持用户自定义标记点高度

### 5. 距离测量
- 支持测量最新两个拾取点之间的距离
- 显示多种距离信息：实际地理距离、Three.js场景距离、比例尺因子等
- 距离测量UI（位于左下角）

### 6. 模型加载和动画控制
- GLB模型加载和管理
- 模型位置使用地形采样的高程
- 支持模型缩放和高度偏移
- 完善的动画控制（播放、暂停、停止）
- 支持动画速度控制
- 支持自定义模型初始化的动画帧索引
- 动画API兼容处理，支持不同Three.js版本
- 模型加载时间点优化，确保在地图/地形初始化完成后加载

### 7. 相机控制
- 禁止相机进入地下
- 基于地形高度的相机限制
- 支持有地形和无地形两种状态下的相机控制
- 平滑的相机控制

### 8. 工具栏和UI管理
- 统一的工具栏设计，位于底部中心
- 图标式按钮，带有提示信息
- 右侧控制面板，统一显示工具UI
- 工具切换时自动管理UI的显示和销毁
- 支持按需显示辅助元素（初始隐藏，通过按钮控制）
- 包含地形开关、坐标轴显隐、测量工具、动画控制、信息管理等功能

### 9. 场景信息管理
- 自动记录用户配置、地图瓦片、地形瓦片等信息
- 支持将场景信息下载为JSON文件
- 提供详细的瓦片分布分析
- 支持用户决定是否下载场景信息

### 10. 测试工具整合
- 统一的测试工具入口
- 集成距离验证、坐标转换调试、坐标轴方向验证等功能
- 加载信息面板控制（仅在打开测试UI时显示）
- 测试工具统一管理

### 11. 资源跟踪管理
- 自动跟踪Three.js资源（Object3D、Material、Texture、BufferGeometry等）
- 支持递归追踪，自动处理资源关联关系
- 统一的资源释放机制，避免内存泄漏
- 支持资源统计，方便调试和性能优化

## 技术栈
- Three.js - 3D渲染引擎
- JavaScript - 主要开发语言
- Vite - 开发构建工具

## 安装与运行

### 1. 安装依赖
```bash
npm install
```

### 2. 启动开发服务器
```bash
npm run dev
```

### 3. 构建生产版本
```bash
npm run build
```

## 快速开始

### 1. 初始化场景
```javascript
import { initMathProj, getMathProj } from './tool/mathProj.js';
import { RGBTerrain } from './Terrain/rgbTerrain.js';
import { MapXYZ } from './map/mapXYZ.js';
import { CameraTool } from './camera/cameraTool.js';
import { ModelManager } from './model/ModelManager.js';
import { ToolManager } from './toolManager/ToolManager.js';

// 核心配置项
const CONFIG = {
    centerLon: 105.29197,
    centerLat: 28.83638,
    rangeEastWest: 4000,
    rangeNorthSouth: 4000,
    mapZoom: 16,
    terrainZoom: 13
};

// 初始化Three.js场景、相机、渲染器等基础组件
// ...

// 初始化坐标转换工具
initMathProj({
    centerLon: CONFIG.centerLon,
    centerLat: CONFIG.centerLat
});

// 初始化地图
const Mapper = new MapXYZ({
    scene: scene,
    centerLon: CONFIG.centerLon,
    centerLat: CONFIG.centerLat,
    rangeEastWest: CONFIG.rangeEastWest,
    rangeNorthSouth: CONFIG.rangeNorthSouth,
    zoom: CONFIG.mapZoom,
    terrainZoom: CONFIG.terrainZoom,
    tileUrl: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}'
});

// 初始化地形
const rgbTerrain = new RGBTerrain({
    scene: scene,
    centerLon: CONFIG.centerLon,
    centerLat: CONFIG.centerLat,
    rangeEastWest: CONFIG.rangeEastWest,
    rangeNorthSouth: CONFIG.rangeNorthSouth,
    zoom: Math.min(CONFIG.terrainZoom, CONFIG.mapZoom),
    tileUrl: 'https://tiles1.geovisearth.com/base/v1/terrain-rgb/{z}/{x}/{y}?format=png&tmsIds=w&token=...'
});

// 初始化相机工具
const cameraTool = new CameraTool({
    camera: camera,
    rgbTerrain: rgbTerrain
});

// 初始化模型管理器
const modelManager = new ModelManager({
    scene: scene,
    rgbTerrain: rgbTerrain,
    mathProj: getMathProj()
});

// 初始化工具管理器
const toolManager = new ToolManager({
    scene: scene,
    camera: camera,
    renderer: renderer,
    controls: controls,
    rgbTerrain: rgbTerrain,
    modelManager: modelManager,
    ...CONFIG
});

// 加载地图和地形
Mapper.load().then(() => {
    // 获取卫星纹理
    const satelliteTextures = Mapper.getLoadedTextures();
    
    // 加载地形，并在渲染时使用卫星纹理
    return rgbTerrain.load(satelliteTextures).then(() => {
        // 地形加载完成后，设置相机工具有地形状态
        cameraTool.setHasTerrain(true);
        
        // 创建工具栏
        toolManager.createToolbar();
        
        // 地图和地形加载完成后，加载GLB模型
        const modelConfig = {
            modelId: 'wjj_model',
            modelPath: './src/assest/data/wjj.glb',
            lon: CONFIG.centerLon,
            lat: CONFIG.centerLat,
            heightOffset: 50,
            scale: [10, 10, 10],
            animationFrameIndex: 20 // 自定义模型初始化动画帧
        };
        
        // 加载模型
        return modelManager.loadModel(modelConfig.modelId, modelConfig.modelPath, {
            animation: {
                enabled: true,
                clipIndex: 0,
                speed: 1.0,
                loop: true
            }
        }).then((model) => {
            // 根据经纬度放置模型，使用地形采样的高程
            return modelManager.placeModelAtLonLat(
                modelConfig.modelId,
                modelConfig.lon,
                modelConfig.lat,
                modelConfig.heightOffset
            );
        }).then((model) => {
            // 设置模型缩放比例
            modelManager.setModelScale(modelConfig.modelId, modelConfig.scale);
        });
    });
}).catch((error) => {
    console.error('地图或地形加载失败：', error);
});
```

### 2. 坐标转换
```javascript
// 经纬度转Three.js坐标
const threePos = getMathProj().lonLatToThree(lon, lat, elevation);

// Three.js坐标转经纬度
const lonLat = getMathProj().threeToLonLat(threeX, threeY, threeZ);

// 经纬度转Web墨卡托
const mercator = getMathProj().lonLatToMercator(lon, lat);

// Web墨卡托转Three.js坐标
const threePos = getMathProj().mercatorToThree(mercatorX, mercatorY, mercatorZ);
```

### 3. 高程查询
```javascript
// 根据Three.js坐标查询高程
const elevation = rgbTerrain.getElevationAtThreePosition(x, z);

// 根据经纬度查询高程
const elevation = rgbTerrain.getElevationAtLonLat(lon, lat);

// 根据墨卡托坐标查询高程
const elevation = rgbTerrain.getElevationAtMercator(mercatorX, mercatorY);
```

### 4. 模型动画控制
```javascript
// 播放动画
modelManager.setAnimationPaused(false);

// 暂停动画
modelManager.setAnimationPaused(true);

// 设置动画速度
modelManager.setAnimationFrameRate(30);
```

## 工具管理

### 工具栏功能
- **地形开关**：切换地形的显示/隐藏
- **坐标轴显隐**：切换坐标轴和瓦片边界的显示/隐藏
- **测量工具**：进行距离测量
- **动画控制**：控制模型动画的播放、暂停和停止
- **信息管理和下载**：查看和下载场景信息

### 右侧控制面板
- 显示当前激活工具的详细UI
- 支持工具切换时自动销毁和创建UI
- 提供完整的工具配置选项

## 相机控制

### 核心功能
- 禁止相机进入地下
- 基于地形高度的相机限制
- 支持自定义相机限制范围
- 平滑的相机控制

### 关键方法
```javascript
// 初始化相机工具
const cameraTool = new CameraTool({
    camera: camera,
    rgbTerrain: rgbTerrain
});

// 更新相机位置，禁止相机进入地下
cameraTool.updateCameraPosition();

// 设置相机工具有地形状态
cameraTool.setHasTerrain(true);
```

## 模型管理

### 核心功能
- GLB模型加载和管理
- 模型位置使用地形采样的高程
- 支持模型缩放和高度偏移
- 完善的动画控制

### 关键方法
```javascript
// 加载模型
modelManager.loadModel(modelId, modelPath, config);

// 根据经纬度放置模型
modelManager.placeModelAtLonLat(modelId, lon, lat, heightOffset);

// 设置模型缩放
modelManager.setModelScale(modelId, scale);

// 播放/暂停动画
modelManager.setAnimationPaused(paused);

// 设置动画帧率
modelManager.setAnimationFrameRate(frameRate);
```

## 开发指南

### 调试工具使用
1. 启动开发服务器后，访问 http://localhost:5174
2. 底部中心会显示工具栏
3. 可使用以下功能：
   - 开启/关闭地形
   - 显示/隐藏坐标轴和瓦片边界
   - 控制模型动画
   - 查看和下载场景信息
   - 打开测试工具面板

### 主要组件说明

#### MathProj
- 负责所有坐标转换逻辑
- 确保各组件间坐标转换的一致性
- 支持完整的坐标转换链

#### RGBTerrain
- 负责RGB地形瓦片的加载和渲染
- 提供高程查询功能
- 支持地形渲染切换

#### MapXYZ
- 负责XYZ卫星地图瓦片的加载和渲染

#### CameraTool
- 负责相机控制和限制
- 禁止相机进入地下
- 基于地形高度的相机限制

#### ModelManager
- 负责模型的加载、管理和动画控制
- 支持GLB模型加载
- 提供完整的动画控制功能

#### ToolManager
- 负责工具栏和UI的管理
- 处理工具的激活和停用
- 渲染和销毁工具UI

## 已解决的技术问题

### 1. 地形瓦片边界缝隙问题
- **问题**：地形瓦片之间出现明显缝隙
- **解决方案**：实现瓦片边缘数据共享，使用双线性插值获取精确高程

### 2. 地形渲染方向问题
- **问题**：高程拉伸方向错误，导致地形显示异常
- **解决方案**：重构地形网格创建逻辑，确保高程沿Y轴正确拉伸

### 3. 坐标转换NaN问题
- **问题**：坐标转换过程中出现NaN值
- **解决方案**：调整初始化顺序，加强边界检查

### 4. 坐标转换精度问题
- **问题**：坐标转换和距离计算存在误差
- **解决方案**：使用高精度地球半径参数，优化转换公式

### 5. 非地形状态下的高程查询处理
- **问题**：关闭地形渲染后，高程查询返回不合理值
- **解决方案**：非地形状态下返回0，符合用户期望

### 6. 标记点高度设置问题
- **问题**：标记点总是贴地显示，忽略用户输入的高程值
- **解决方案**：添加贴地选项，支持用户自定义标记点高度

### 7. 地形渲染状态切换时的缝隙问题
- **问题**：关闭地形再次重启后出现缝隙
- **解决方案**：统一高程计算方法，重新处理瓦片边缘

### 8. 小范围地图无法渲染问题
- **问题**：小范围地图配置下无法正确渲染瓦片
- **解决方案**：优化瓦片范围计算逻辑，确保正确处理小范围场景

### 9. 相机进入地下问题
- **问题**：相机可以进入地形内部，导致视图异常
- **解决方案**：实现CameraTool类，禁止相机进入地下

### 10. 瓦片边界可视化问题
- **问题**：无法直观查看瓦片分布情况
- **解决方案**：实现瓦片边界绘制功能，地形瓦片显示蓝色边界，卫星瓦片显示绿色边界

### 11. 模型加载时间点问题
- **问题**：模型加载时间点不正确，导致位置计算错误
- **解决方案**：确保模型在地图/地形初始化完成后加载

### 12. 动画API兼容性问题
- **问题**：不同Three.js版本的动画API不兼容
- **解决方案**：添加条件判断，支持不同版本的动画API

### 13. 工具栏和UI重构
- **问题**：原有的工具栏和UI设计不够统一
- **解决方案**：实现统一的工具栏和右侧控制面板

### 14. UI元素按需显示优化
- **问题**：初始加载时显示所有辅助元素，导致界面杂乱
- **解决方案**：初始隐藏辅助元素，通过按钮控制显示/隐藏

### 15. 坐标轴与方位标签未跟随地形抬升问题
- **问题**：开启地形后，坐标轴和方位标签未跟随地形高度抬升
- **解决方案**：根据地形高度自动调整坐标轴和方位标签的位置

### 16. 信息管理工具乱码问题
- **问题**：infoManager.js文件中的中文注释出现乱码
- **解决方案**：修正文件编码，确保中文注释正常显示

### 17. 卫星瓦片渲染逻辑错误
- **问题**：不同缩放级别下卫星瓦片渲染不正确
- **解决方案**：修复卫星瓦片渲染逻辑，确保正确计算瓦片索引

### 18. 工具管理器目录名拼写错误
- **问题**：ToolManader目录名拼写错误，导致导入失败
- **解决方案**：修正目录名为toolManager，确保所有导入路径正确

### 19. 加载信息面板总是显示问题
- **问题**：addLoadingInfo总是执行，导致界面杂乱
- **解决方案**：确保addLoadingInfo只在打开测试UI时执行，不在初始化时执行

### 20. 模型动画速度控制问题
- **问题**：action.setSpeed不是一个函数，导致模型动画控制失败
- **解决方案**：使用条件判断，支持不同Three.js版本的动画速度控制API

## 未来规划

### 1. 卫星瓦片与地形层级匹配
- 支持卫星瓦片层级大于地形瓦片层级的情况
- 实现跨层级瓦片索引转换
- 支持多分辨率纹理映射
- 优化不同层级瓦片的数据获取和处理

### 2. 性能优化
- 优化瓦片加载和渲染性能
- 实现LOD（Level of Detail）切换
- 优化高程查询性能
- 优化坐标转换计算效率
- 实现瓦片预加载和缓存机制
- 优化模型加载和渲染性能

### 3. 功能扩展
- 支持更多地图和地形数据源
- 实现矢量瓦片渲染
- 支持3D Tiles格式
- 实现更丰富的标记点样式和动画
- 支持路径绘制和管理
- 增强测量功能，支持多点测量和面积测量
- 添加地形剖面分析功能
- 实现地形编辑功能
- 支持水体、植被等自然元素渲染

### 4. 用户体验优化
- 改进UI设计，提供更直观的操作界面
- 添加更多交互功能
- 优化响应速度
- 支持移动端适配
- 实现更丰富的可视化效果
- 提供更多预设场景和模板

### 5. 文档完善
- 完善API文档
- 添加更多使用示例
- 提供详细的开发指南
- 制作视频教程
- 完善中文文档

### 6. 扩展能力
- 实现插件系统，支持第三方扩展
- 提供SDK，方便集成到其他项目
- 支持与其他GIS系统集成
- 实现云端数据存储和共享

### 7. 测试和质量保证
- 完善单元测试和集成测试
- 实现自动化测试流程
- 提高代码覆盖率
- 优化代码结构和可读性

### 8. 国际化支持
- 支持多语言界面
- 支持不同国家和地区的地图数据源
- 支持不同坐标系转换

### 9. 高级功能
- 实现AR/VR支持
- 支持机器学习地形分析
- 实现实时天气和环境效果
- 支持大规模场景渲染
- 实现物理引擎集成

### 10. 生态系统建设
- 建立开发者社区
- 提供示例项目和模板
- 定期更新和维护
- 收集用户反馈，持续改进

## 参与贡献
1. Fork 本仓库
2. 新建 Feat_xxx 分支
3. 提交代码
4. 新建 Pull Request
5. 确保代码符合项目规范
6. 提供详细的代码说明和测试用例

## 许可证
MIT License

## 联系方式
- 项目地址：[GitHub Repository]
- 开发团队：BIMCC
- 邮箱：2409479323@qq.com
- 日期：2026-01-20
