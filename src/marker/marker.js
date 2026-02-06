/*
 * @Author: 2409479323@qq.com
 * @Date: 2026-01-20 15:58:36
 * @LastEditors: 2409479323@qq.com 
 * @LastEditTime: 2026-02-06 18:22:41
 * @FilePath: \RammedEarth\src\marker\marker.js
 * @Description: 
 * 
 * Copyright (c) 2026 by bimcc, All Rights Reserved. 
 */
import * as THREE from 'three';
import { IMG } from '../assets/img/urls.js';
import { SCENE_UNITS_PER_METER, metersToUnits } from '../math/scale.js';

/**
 * 点标记工具类
 * 用于在Three.js场景中创建和管理标记点
 */
export class MarkerManager {
    /**
     * 构造函数
     * @param {THREE.Scene} scene - Three.js场景
     */
    constructor(scene, options = {}) {
        this.scene = scene;
        this.markers = new Map(); // 存储所有标记点
        this.nextId = 0; // 标记点ID计数器
        this.markerGroup = new THREE.Group(); // 标记点分组
        scene.add(this.markerGroup);

        this.unitsPerMeter = Number(options.unitsPerMeter ?? SCENE_UNITS_PER_METER);
        this.autoScale = options.autoScale !== undefined ? !!options.autoScale : true;
        this.screenSizePx = Number.isFinite(Number(options.screenSizePx)) ? Number(options.screenSizePx) : 8;
        this.labelSizePx = Number.isFinite(Number(options.labelSizePx)) ? Number(options.labelSizePx) : 30;
    }

    _unitsPerPixel(camera, renderer, distance) {
        if (!camera || !renderer) return null;
        const h = renderer.domElement?.clientHeight
            ?? renderer.getSize?.(new THREE.Vector2())?.y
            ?? 0;
        if (!Number.isFinite(h) || h <= 0) return null;

        if (camera.isOrthographicCamera === true) {
            const frustumH = Math.abs(Number(camera.top) - Number(camera.bottom));
            return Number.isFinite(frustumH) && frustumH > 0 ? (frustumH / h) : null;
        }

        const fovDeg = Number(camera.fov);
        const fov = THREE.MathUtils.degToRad(Number.isFinite(fovDeg) ? fovDeg : 60);
        if (!Number.isFinite(fov) || fov <= 0) return null;
        return (2 * distance * Math.tan(fov / 2)) / h;
    }

    update(camera, renderer) {
        if (!camera || !renderer) return;
        if (!this.markers?.size) return;

        for (const marker of this.markers.values()) {
            const data = marker?.userData?.markerData;
            if (!data?.sphere) continue;

            const pos = marker.position;
            const dist = (camera.isOrthographicCamera === true)
                ? 1
                : (camera.position?.distanceTo?.(pos) ?? 1);

            const unitsPerPixel = this._unitsPerPixel(camera, renderer, dist);
            if (!Number.isFinite(unitsPerPixel) || unitsPerPixel <= 0) continue;

            const baseRadius = Math.max(1e-6, Number(data.baseRadiusUnits ?? 1));
            const px = Number(data.screenSizePx ?? this.screenSizePx) || this.screenSizePx;
            const desiredRadius = 0.5 * px * unitsPerPixel;
            const radius = data.autoScale ? Math.max(baseRadius, desiredRadius) : baseRadius;
            data.sphere.scale.setScalar(radius);

            if (data.labelSprite) {
                const labelPx = Number(data.labelSizePx ?? px) || px;
                const baseSize = Math.max(1e-6, Number(data.baseLabelSizeUnits ?? (baseRadius * 2)));
                const desiredSize = labelPx * unitsPerPixel;
                const size = data.autoScale ? Math.max(baseSize, desiredSize) : baseSize;
                data.labelSprite.scale.set(size, size, 1);
                const offsetBase = Number(data.labelOffsetUnits ?? 0);
                data.labelSprite.position.set(0, offsetBase + radius, 0);
            }
        }
    }

    /**
     * 创建标记点
     * @param {Object} options - 标记点配置
     * @param {number} options.x - Three.js X坐标
     * @param {number} options.y - Three.js Y坐标
     * @param {number} options.z - Three.js Z坐标
     * @param {number} [options.radius=5] - 标记点半径
     * @param {number} [options.color=0xff0000] - 标记点颜色
     * @param {string} [options.label] - 标记点标签
     * @param {string} [options.img] - 标记点图片路径
     * @returns {string} 标记点ID
     */
    createMarker(options) {
        const { x, y, z, radius = 5, color = 0xff0000, label = '', img = '' } = options;
        const unitsPerMeter = Number(options.unitsPerMeter ?? this.unitsPerMeter ?? SCENE_UNITS_PER_METER);
        const baseRadiusMeters = Number.isFinite(Number(radius)) ? Number(radius) : 1;
        const baseRadiusUnits = Math.max(1e-6, metersToUnits(baseRadiusMeters, unitsPerMeter));
        const autoScale = options.autoScale !== undefined ? !!options.autoScale : this.autoScale;
        const screenSizePx = Number.isFinite(Number(options.screenSizePx)) ? Number(options.screenSizePx) : this.screenSizePx;
        const labelOffsetMeters = Number.isFinite(Number(options.labelOffsetMeters)) ? Number(options.labelOffsetMeters) : 5;
        const labelOffsetUnits = metersToUnits(labelOffsetMeters, unitsPerMeter);
        const labelSizePx = Number.isFinite(Number(options.labelSizePx)) ? Number(options.labelSizePx) : (this.labelSizePx ?? screenSizePx);
        const baseLabelSizeMeters = Number.isFinite(Number(options.labelSizeMeters)) ? Number(options.labelSizeMeters) : (baseRadiusMeters * 2);
        const baseLabelSizeUnits = Math.max(1e-6, metersToUnits(baseLabelSizeMeters, unitsPerMeter));
        const id = `marker_${this.nextId++}`;

        // 创建标记点组
        const markerGroup = new THREE.Group();
        markerGroup.name = id;
        markerGroup.userData.id = id;
        markerGroup.position.set(Number(x) || 0, Number(y) || 0, Number(z) || 0);

        // 创建球体几何体（始终创建）
        const geometry = new THREE.SphereGeometry(1, 25, 25);
        const material = new THREE.MeshBasicMaterial({ color: color });
        const sphere = new THREE.Mesh(geometry, material);
        sphere.name = id;
        sphere.position.set(0, 0, 0);
        sphere.scale.setScalar(baseRadiusUnits);
        markerGroup.add(sphere);

        markerGroup.userData.markerData = {
            sphere,
            baseRadiusUnits,
            autoScale,
            screenSizePx,
            labelOffsetUnits,
            labelSizePx,
            baseLabelSizeUnits
        };

        // 如果提供了图片路径，创建图片标签并显示在球体上方
        if (img) {
            // 使用图片创建标签
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const canvasSize = 25; // 画布大小
            canvas.width = canvasSize;
            canvas.height = canvasSize;
            
            // 清空画布
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // 创建纹理（在onload回调之前定义）
            const texture = new THREE.CanvasTexture(canvas);
            
            // 绘制图片
            const imgElement = new Image();
            imgElement.crossOrigin = 'anonymous'; // 允许跨域加载
            imgElement.onload = () => {
                // 在画布中心绘制图片
                const imgSize = canvasSize;
                ctx.drawImage(imgElement, 0, 0, imgSize, imgSize);
                
                // 在图片正中间绘制文字
                if (label) {
                    ctx.fillStyle = '#ffffff'; // 白色字体
                    ctx.font = 'bold 8px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
                }
                
                // 更新纹理
                texture.needsUpdate = true;
            };
            
            imgElement.src = img;
            
            // 创建精灵
            const spriteMaterial = new THREE.SpriteMaterial({ 
                map: texture,
                transparent: true // 启用透明通道
            });
            
            const imgLabel = new THREE.Sprite(spriteMaterial);
            imgLabel.name = id;
            // 将图片标签放在球体上方
            imgLabel.position.set(0, labelOffsetUnits + baseRadiusUnits, 0);
            
            // 设置固定像素大小为10px
            imgLabel.scale.set(baseLabelSizeUnits, baseLabelSizeUnits, 1);
            
            markerGroup.add(imgLabel);
            if (markerGroup.userData.markerData) markerGroup.userData.markerData.labelSprite = imgLabel;
        }

        // 添加到场景和标记点列表
        this.markers.set(id, markerGroup);
        this.markerGroup.add(markerGroup);

        return id;
    }

    /**
     * 创建标签
     * @param {THREE.Group} parent - 父对象
     * @param {string} text - 标签文本
     * @param {number} x - X坐标
     * @param {number} y - Y坐标
     * @param {number} z - Z坐标
     */
    createLabel(parent, text, x, y, z) {
        // 创建画布，用于绘制图片和文字
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const canvasSize = 32; // 画布大小
        canvas.width = canvasSize;
        canvas.height = canvasSize;
        
        // 清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 1. 绘制图片作为背景
        const img = new Image();
        img.crossOrigin = 'anonymous'; // 允许跨域加载
        img.onload = () => {
            // 在画布中心绘制图片
            const imgSize = canvasSize; // 图片大小与画布相同
            ctx.drawImage(img, 0, 0, imgSize, imgSize);
            
            // 2. 在图片正中间绘制文字
            ctx.fillStyle = '#ffffff'; // 白色字体
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, canvas.width / 2, canvas.height / 2);
            
            // 创建合成纹理
            const texture = new THREE.CanvasTexture(canvas);
            texture.needsUpdate = true;
            
            // 创建精灵材质
            const material = new THREE.SpriteMaterial({ 
                map: texture,
                transparent: true // 启用透明通道
            });
            
            // 创建精灵
            const sprite = new THREE.Sprite(material);
            
            // 设置固定像素大小
            const pixelSize = 12; // 像素大小
            sprite.position.set(x, y, z);
            const baseSizeUnits = Math.max(1e-6, Number(parent?.userData?.markerData?.baseLabelSizeUnits ?? pixelSize));
            sprite.scale.set(baseSizeUnits, baseSizeUnits, 1);
            
            // 添加到父对象
            parent.add(sprite);
            parent.userData.label = sprite;
            if (parent.userData.markerData) parent.userData.markerData.labelSprite = sprite;
        };
        
        // 加载图片
        img.src = IMG.point.point;
    }

    /**
     * 更新标记点位置
     * @param {string} id - 标记点ID
     * @param {number} x - 新的X坐标
     * @param {number} y - 新的Y坐标
     * @param {number} z - 新的Z坐标
     */
    updateMarkerPosition(id, x, y, z) {
        const marker = this.markers.get(id);
        if (marker) {
            marker.position.set(x, y, z);
        }
    }

    /**
     * 更新标记点标签
     * @param {string} id - 标记点ID
     * @param {string} text - 新的标签文本
     */
    updateMarkerLabel(id, text) {
        const marker = this.markers.get(id);
        if (marker) {
            // 移除旧标签
            if (marker.userData.label) {
                marker.remove(marker.userData.label);
                marker.userData.label = null;
            }
            // 创建新标签
            const data = marker.userData.markerData;
            const offset = data ? (data.labelOffsetUnits + data.baseRadiusUnits) : 15;
            this.createLabel(marker, text, 0, offset, 0);
        }
    }

    /**
     * 删除标记点
     * @param {string} id - 标记点ID
     */
    removeMarker(id) {
        const marker = this.markers.get(id);
        if (marker) {
            this.markerGroup.remove(marker);
            this.markers.delete(id);
        }
    }

    /**
     * 清除所有标记点
     */
    clearAllMarkers() {
        for (const [id, marker] of this.markers) {
            this.markerGroup.remove(marker);
        }
        this.markers.clear();
        this.nextId = 0;
    }

    /**
     * 获取标记点数量
     * @returns {number} 标记点数量
     */
    getMarkerCount() {
        return this.markers.size;
    }

    /**
     * 获取标记点
     * @param {string} id - 标记点ID
     * @returns {THREE.Group|null} 标记点对象
     */
    getMarker(id) {
        return this.markers.get(id) || null;
    }

    /**
     * 创建临时标记点（5秒后自动删除）
     * @param {Object} options - 标记点配置
     * @returns {string} 标记点ID
     */
    createTemporaryMarker(options) {
        const id = this.createMarker(options);
        
        // 5秒后自动删除
        setTimeout(() => {
            this.removeMarker(id);
        }, 5000);
        
        return id;
    }
}

/**
 * 简单的点标记工具类
 * 用于快速创建单个标记点
 */
export class PointMarker {
    /**
     * 构造函数
     * @param {THREE.Scene} scene - Three.js场景
     */
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
    }

    /**
     * 在指定位置创建标记点
     * @param {THREE.Vector3} position - 标记点位置
     * @param {number} [radius=5] - 标记点半径
     * @param {number} [color=0xff0000] - 标记点颜色
     */
    createAtPosition(position, radius = 5, color = 0xff0000) {
        // 移除旧标记点
        this.remove();

        // 创建新标记点
        const geometry = new THREE.SphereGeometry(metersToUnits(radius, SCENE_UNITS_PER_METER), 16, 16);
        const material = new THREE.MeshBasicMaterial({ color: color });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.position.copy(position);
        this.scene.add(this.mesh);
    }

    /**
     * 移除标记点
     */
    remove() {
        if (this.mesh) {
            this.scene.remove(this.mesh);
            this.mesh.geometry.dispose();
            this.mesh.material.dispose();
            this.mesh = null;
        }
    }

    /**
     * 更新标记点位置
     * @param {THREE.Vector3} position - 新位置
     */
    updatePosition(position) {
        if (this.mesh) {
            this.mesh.position.copy(position);
        }
    }
}
