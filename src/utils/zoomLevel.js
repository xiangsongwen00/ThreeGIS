/*
 * @Author: 2409479323@qq.com
 * @Date: 2026-02-03 15:13:09
 * @LastEditors: 2409479323@qq.com 
 * @LastEditTime: 2026-02-06 18:27:35
 * @FilePath: \RammedEarth\src\utils\zoomLevel.js
 * @Description: 
 * 
 * Copyright (c) 2026 by bimcc, All Rights Reserved. 
 */
/**
 * Shared distance->zoom mapping (from `src/camera/camera.md`).
 * Zoom is an integer where larger means more detail.
 *
 * Note: callers should clamp to their own min/max zoom bounds.
 */
export function getZoomLevelByDistance(distanceMeters) {
    const d = Math.max(0, Number(distanceMeters) || 0);
    if (d <= 29) return 22;
    if (d <= 59) return 21;
    if (d <= 79) return 20;
    if (d <= 200) return 19;
    if (d <= 400) return 18;
    if (d <= 660) return 17;
    if (d <= 1300) return 16;
    if (d <= 2600) return 15;
    if (d <= 6400) return 14;
    if (d <= 13200) return 13;
    if (d <= 26000) return 12;
    if (d <= 67985) return 11;
    if (d <= 139780) return 10;
    if (d <= 250600) return 9;
    if (d <= 380000) return 8;
    if (d <= 640000) return 7;
    if (d <= 1280000) return 6;
    if (d <= 2600000) return 5;
    if (d <= 6100000) return 4;
    if (d <= 11900000) return 3;
    return 2;
}

export function clampZoom(z, minZ, maxZ) {
    const zz = Number(z);
    const lo = Number.isFinite(minZ) ? minZ : -Infinity;
    const hi = Number.isFinite(maxZ) ? maxZ : Infinity;
    if (!Number.isFinite(zz)) return Math.max(lo, Math.min(hi, 0));
    return Math.max(lo, Math.min(hi, zz));
}

export function getZoomLevelWithBias(distanceMeters, options = {}) {
    const base = getZoomLevelByDistance(distanceMeters);
    const bias = Number.isFinite(options.bias) ? options.bias : 0;
    return clampZoom(base + bias, options.minZ, options.maxZ);
}
