<!--
 * @Author: 2409479323@qq.com
 * @Date: 2026-02-03 15:51:52
 * @LastEditors: 2409479323@qq.com 
 * @LastEditTime: 2026-02-03 16:20:54
 * @FilePath: \RammedEarth\README.md
 * @Description: 
 * 
 * Copyright (c) 2026 by bimcc, All Rights Reserved. 
-->
# ThreeMap（局部地形 / 填挖方 / 地形修整验证）

基于 **Three.js + Vite** 的局部 3D 地理场景 Demo：加载 **terrain-rgb 高程瓦片**，并在地形材质上铺设 **栅格底图/影像瓦片（XYZ/TMS）**；提供测量、绘制、填挖方、剖面、地形修整（抬高/降低/整平/坡面/裁剪）等交互工具。

> 安全提示：仓库里不应提交任何 Token/密钥。旧版 `README.md` 中出现过 `ghp_...`（GitHub Token）一类敏感信息，本次已移除；请自查历史记录并及时作废/轮换密钥。

## 快速开始

```bash
npm install
npm run dev
```

常用命令：
- `npm run dev`：本地开发
- `npm run net`：局域网访问（`--host 0.0.0.0`）
- `npm run build`：Vite 构建（输出到 `dist/`）

## 入口与配置

页面入口：`index.html` → `src/index.js`。

场景配置在 `src/index.js` 的 `CONFIG` 中（示例字段）：
- `centerLon` / `centerLat`：场景中心（WGS84，经纬度）
- `rangeEastWest` / `rangeNorthSouth`：关注区域范围（米）
- `terrainZoom`：地形瓦片层级
- `maxMapZoom` / `mapMaxZoomDiff`：影像瓦片最大层级与“影像层级相对地形层级”的最大差值
- `baseMapType`：底图预设类型（见 `src/maptiles/basemaps.js`）
- `mapTileUrl`：自定义底图瓦片模板（与 `baseMapType` 二选一即可）
- `mapYtype`：`xyz` 或 `tms`（不同服务的 y 轴原点不同）
- `mapToken`：底图 Token（用于填充 `{token}` / `{key}` / `{accessToken}` 等模板变量）

地形瓦片 URL 与相关参数在 `src/terrain/Terrain.js` 内部默认值中定义（可按需改成自己的服务）。

## 坐标系约定（重要）

项目统一使用：
- 经纬度：WGS84（EPSG:4326）
- 投影：Web Mercator（EPSG:3857）
- Three.js 本地坐标：以场景中心为原点的局部米制坐标

轴向对齐（`src/math/proj.js`）：
- three **+X**：地理东
- three **+Y**：向上（高程）
- three **+Z**：地理南（因此地理北为 **-Z**）

## 功能概览（与当前实现一致）

### 地形与影像
- terrain-rgb 高程瓦片加载与渲染：`src/terrain/Terrain.js`
- 地形材质铺设影像/底图瓦片：`src/maptiles/imageryTiles.js`
  - 支持 XYZ/TMS
  - 并发上限、重试/退避、简单限流（适配严格服务）
  - LRU 缓存 + 驱逐释放纹理
  - `mapZoom > terrainZoom` 时支持“多瓦片拼接到一张纹理（mosaic）”
- 底图预设（OpenStreetMap / Google / 天地图 / MapTiler / Mapbox / Bing / Custom）：`src/maptiles/basemaps.js`

### 工具栏（底部）+ 右侧工具面板
由 `src/toolManager/ToolManager.js` 统一管理：
- 地形开关：真实高程 / 平面（高程视为 0）
- 坐标轴/网格：显示、大小、跟随地形抬升（`src/utils/AuxiliaryTools.js`）
- 绘制工具：点/线/面，支持贴地（`src/toolManager/UI/drawToolUI.js`、`src/drawTool/DrawTool.js`）
- 测量工具：点/距离/多段距离/面积/剖面/填挖方（`src/toolManager/UI/measureToolUI.js`）
- 地形修整：抬高/降低、整平、坡面、多洞裁剪（`src/toolManager/UI/terrainEditorUI.js` + `src/terrain/TerrainEditor.js`）
- 动画控制：选择模型并触发动作（`src/toolManager/UI/animationControlUI.js` + `src/model/ModelManager.js`）
- 信息面板：场景配置与瓦片统计、下载 JSON（`src/toolManager/UI/infoManagerUI.js`）
- 测试工具：高程拾取、经纬度/Three 坐标查询、重置相机（`src/toolManager/UI/testToolsUI.js`）

## 项目结构（当前 `src/` 实际目录）

```
src/
  index.js                 # demo 入口：创建 Viewer
  viewer.js                # 场景总控：scene/camera/terrain/tools
  assest/                  # 静态资源（目录名为 assest）
    data/                  # glb/gltf/geojson 等
    img/                   # UI 图标等
  camera/CameraManager.js  # 相机与 OrbitControls
  drawTool/DrawTool.js     # 点线面绘制（含贴地表面）
  maptiles/                # 影像瓦片加载与预设
  marker/marker.js         # 标记点与 label sprite
  math/proj.js             # 投影/坐标转换（-Z 为北）
  model/                   # 模型与动画动作
  terrain/                 # 地形渲染、编辑、贴地表面等
  toolManager/             # 工具栏与右侧面板 UI
  utils/                   # 辅助工具
```

## 开发记录

详见 `开发技术问题记录.md`（已按当前实现更新）。