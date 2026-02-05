/*
 * @Author: 2409479323@qq.com
 * @Date: 2026-01-29 10:04:52
 * @LastEditors: 2409479323@qq.com 
 * @LastEditTime: 2026-02-05 09:27:01
 * @FilePath: \RammedEarth\src\index.js
 * @Description: 
 * 
 * Copyright (c) 2026 by bimcc, All Rights Reserved. 
 */
import { Viewer } from './viewer.js';

// 配置参数
const CONFIG = {
    centerLon: 105.29197,
    centerLat: 28.83638,
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
    // Enable hot-update only when height-to-ground <= this threshold (meters).
    mapDrapeEnableBelowOrEqualHeightMeters: 4000,
    // Only hot-update tiles within this near range (meters).
    mapDrapeNearMeters: 20000,
    // Patch refresh interval (ms). Textures stream async; lowering increases responsiveness but costs CPU.
    mapDrapePatchUpdateMs: 250,
    // LOD mode:
    // - 'trapezoid' (default): view-trapezoid quadtree refine (angle-aware, distance-based, fewer hard boundaries)
    // - 'bands': legacy radial distance bands (`mapDrapePatchBands`)
    mapDrapeLodMode: 'trapezoid',
    // Quadtree refine tuning (larger => coarser, fewer high-zoom tiles)
    mapDrapeLodErrorScale: 1.0,
    // Safety caps (prevent exploding tile counts)
    mapDrapeLodMaxTiles: 2048,
    // Near-horizontal safety cap: when tilt-from-vertical >= this, limit patch range to `mapDrapeShallowMaxMeters`.
    mapDrapeShallowMaxRangeMinTiltDeg: 60,
    mapDrapeShallowMaxMeters: 5000,
    // Default distance bands within `mapDrapeNearMeters` (meters) -> zoom level.
    // Highest zoom is capped at 18 (no 19+ tiles).
    mapDrapePatchBands: [
        { maxDist: 20, zoom: 19 },
        { maxDist: 30, zoom: 18 },
        { maxDist: 80, zoom: 17 },
        { maxDist: 250, zoom: 16 },
        { maxDist: 600, zoom: 15 },
        { maxDist: 10000, zoom: 14 },
        { maxDist: 30000, zoom: 13 },
        { maxDist: 90000, zoom: 12 },
        { maxDist: 130000, zoom: 11 },
        { maxDist: 230000, zoom: 10 },
    ],
    // Base (restored) imagery zoom for terrain materials when hot-update is disabled.
    // Recommend keeping this close to `terrainZoom` for stability/perf.
    mapDrapeBaseZoom: 14,
    // Debug drape hot-update (logs once per second)
    mapDrapeDebug: true,
    // Disable background map layer to avoid double-loading textures (base drape handles the underlay).
    backgroundMapEnabled: false,
    mapDrapeShaderPatchEnabled: true,
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
