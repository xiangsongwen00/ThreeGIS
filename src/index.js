/*
 * @Author: 2409479323@qq.com
 * @Date: 2026-01-29 10:04:52
 * @LastEditors: 2409479323@qq.com 
 * @LastEditTime: 2026-02-06 17:53:59
 * @FilePath: \RammedEarth\src\index.js
 * @Description: 
 * 
 * Copyright (c) 2026 by bimcc, All Rights Reserved. 
 */
import { Viewer } from './viewer.js';
//114.593095813796, 29.757331653122648
// 配置参数
const CONFIG = {
    centerLon: 114.594095813796,
    centerLat: 29.756331653122648,
    rangeEastWest: 20000,
    rangeNorthSouth: 20000,
    terrainZoom: 13,
    terrainZoomMin: 5,
    // Global clamp for terrain-tile imagery mosaicing: mapZoom <= terrainZoom + mapMaxZoomDiff
    mapMaxZoomDiff: 2,
    // Terrain is fixed: load only AOI tiles at `terrainZoom` and keep them persistent.
    terrainLodsEnabled: false,
    maxMapZoom: 18,
    terrainOpacity: 1.0,
    terrainColor: 0x8fd3ff,
    // Disable terrain imagery; keep solid color only.
    terrainImageryEnabled: true,
    // Raster base map (built-in presets):
    // - 'openstreetmap' (default if you omit all map settings)
    // - 'google' | 'tianditu' | 'maptiler' | 'mapbox' | 'bing'
    baseMapType: 'google',
    // Provider token (used to fill `{token}` / `{key}` / `{accessToken}` placeholders in presets)
    mapToken: null,
    mapMaxConcurrent: 8,
    mapCacheSize: 256,
    // Tianditu is strict: limit burst and add retry/backoff during init.
    mapRateLimitBurst: 100,
    mapRateLimitWindowMs: 1000,
    mapRateLimitCooldownMs: 1000,
    mapRetryCount: 2,
    mapRetryBaseDelayMs: 250,
    mapRetryMaxDelayMs: 2000,
    // Terrain-material imagery (base drape + atlas shader local high-res patch).
    mapDrapeShaderPatchEnabled: true,
    // Enable hot-update only when height-to-ground <= this threshold (meters).
    mapDrapeEnableBelowOrEqualHeightMeters: 1000000,
    // Cap viewport bounds / LOD patch radius (meters).
    mapDrapeNearMeters: 200000,
    // Base (restored) imagery zoom for terrain materials when hot-update is disabled.
    mapDrapeBaseZoom: 6,
    // Clean viewport LOD for atlas patching.
    mapDrapeLod: {
        mode: 'viewport',
        minZoom: 5,
        maxZoom: 18,
        viewportPadTiles: 2,
        autoMaxZoom: true,
        maxTilesPerZoom: 200,
        updateMs: 250,
        debounce: { ms: 150, moveMeters: 15, heightMeters: 20, angleDeg: 1.5 }
    },
    // Minimum atlas zoom for LOD (lower => fewer tiles).
    mapDrapeAtlasMinZoom: 5,
    // Atlas cell size override (larger => sharper per-tile resolution in atlas).
    mapDrapeAtlasCellSizeByZoom: { 13: 256, 14: 256, 15: 256, 16: 256, 17: 256, 18: 256 },
    // Reduce blur in atlas sampling.
    mapDrapeAtlasSmoothness: 0,
    mapDrapeAtlasSmoothRadiusPx: 0,
    mapDrapeAtlasMipmaps: false,
    // Debug: visualize LOD tiles (wireframe boxes).
    mapDrapeSkipTileLoad: false,
    mapDrapeLodVizEnabled: true,
    mapDrapeLodVizShowViewQuad: true,
    mapDrapeLodVizOpacity: 0.9,
    mapDrapeLodVizMaxTiles: 12000,
    // Debug drape hot-update (logs once per second)
    mapDrapeDebug: true,
    // Disable background map layer to avoid double-loading textures (base drape handles the underlay).
    backgroundMapEnabled: false,
};


// 初始化场景
const container = document.getElementById('container');
const viewer = new Viewer(container, CONFIG);

// 确保默认加载地形，调用setTerrainVisibility(true)以确保状态一致
viewer.setTerrainVisibility(true);
const terrainVisibleEl = document.getElementById('terrain-visible');
if (terrainVisibleEl) terrainVisibleEl.checked = true;

// 确保辅助工具和坐标轴标签的高度与地形状态一致
viewer.updateAuxiliaryToolsHeight(true);
window.viewer = viewer
