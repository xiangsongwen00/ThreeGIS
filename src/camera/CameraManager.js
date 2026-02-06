import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SCENE_UNITS_PER_METER, metersToUnits, unitsToMeters } from '../math/scale.js';

/**
 * 相机管理器
 * - 全程无缩放限制，自由滚动/放大
 * - 保留所有地图瓦片LOD相关的核心能力
 */
export class CameraManager {
    constructor(container, scene, options = {}) {
        this.container = container;
        this.scene = scene;
        this.camera = null;
        this.controls = null;

        this.unitsPerMeter = SCENE_UNITS_PER_METER;
        this.metersPerUnit = this.unitsPerMeter !== 0 ? (1 / this.unitsPerMeter) : 1;
        this._toUnits = (v) => metersToUnits(v, this.unitsPerMeter);

        // 默认配置：适应 ~40km 城市场景，移除缩放限制相关的冗余配置
        this.config = {
            fov: 60,
            near: 0.1,
            far: 10000000,
            maxPolarAngle: Math.PI / 2 - 0.05,
            dampingFactor: 0.05,
            // 操作速度可按需调整，无缩放限制
            zoomSpeed: 1.5,
            panSpeed: 1.5,
            rotateSpeed: 1.5,
            ...options
        };
        this.config.near = this._toUnits(this.config.near);
        this.config.far = this._toUnits(this.config.far);

        this._frustum = new THREE.Frustum();
        this._viewProj = new THREE.Matrix4();
        this._tmp = {
            pos: new THREE.Vector3(),
            dir: new THREE.Vector3(),
            up: new THREE.Vector3(),
            target: new THREE.Vector3()
        };

        this.init();
        // 无需初始化滚轮监听，直接删除
    }

    init() {
        this.camera = new THREE.PerspectiveCamera(
            this.config.fov,
            this.container.clientWidth / this.container.clientHeight,
            this.config.near,
            this.config.far
        );

        const posY = this._toUnits(5000);
        const posZ = this._toUnits(10000);
        this.camera.position.set(0, posY, posZ);
        this.camera.lookAt(0, 0, 0);

        this.controls = new OrbitControls(this.camera, this.container);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = this.config.dampingFactor;

        // ************************** 核心修改 **************************
        this.controls.minDistance = 0;          // 最小距离设为0，无放大限制
        this.controls.maxDistance = Infinity;   // 最大距离设为无穷大，无缩小限制
        // *************************************************************

        this.controls.maxPolarAngle = this.config.maxPolarAngle;
        this.controls.target.set(0, 0, 0);

        this.controls.enableZoom = true;
        this.controls.enablePan = true;
        this.controls.enableRotate = true;

        // 操作速度用配置项，可按需覆盖
        this.controls.zoomSpeed = this.config.zoomSpeed;
        this.controls.panSpeed = this.config.panSpeed;
        this.controls.rotateSpeed = this.config.rotateSpeed;
    }

    // 以下所有方法完全不变，保留所有地图瓦片LOD核心能力
    updateProjection() {
        if (!this.camera) return;
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
    }

    updateControls() {
        this.controls?.update?.();
    }

    getCamera() {
        return this.camera;
    }

    getControls() {
        return this.controls;
    }

    getPose() {
        if (!this.camera) return null;
        const pos = this._tmp.pos.copy(this.camera.position);
        const dir = this._tmp.dir.set(0, 0, -1).applyQuaternion(this.camera.quaternion).normalize();
        const up = this._tmp.up.copy(this.camera.up).normalize();
        const target = this._tmp.target.copy(this.controls?.target ?? new THREE.Vector3());
        return {
            position: pos.clone(),
            direction: dir.clone(),
            up: up.clone(),
            target: target.clone()
        };
    }

    getFrustum() {
        if (!this.camera) return null;
        this.camera.updateMatrixWorld(true);
        this._viewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
        this._frustum.setFromProjectionMatrix(this._viewProj);
        return this._frustum;
    }

    distanceTo(worldPoint) {
        if (!this.camera?.position || !worldPoint) return Infinity;
        return unitsToMeters(this.camera.position.distanceTo(worldPoint), this.unitsPerMeter);
    }

    _rayFromNdc(x, y) {
        const cam = this.camera;
        if (!cam) return null;
        const p = new THREE.Vector3(x, y, 0.5).unproject(cam);
        const origin = cam.position.clone();
        const dir = p.sub(origin).normalize();
        return { origin, dir };
    }

    getGroundIntersections(options = {}) {
        const cam = this.camera;
        if (!cam) return null;

        const groundY = Number.isFinite(options.groundY) ? options.groundY : 0;
        const maxDistanceMeters = Number.isFinite(options.maxDistance)
            ? options.maxDistance
            : unitsToMeters(this.config?.far ?? 50000, this.unitsPerMeter);
        const maxDistance = this._toUnits(maxDistanceMeters);

        const corners = [
            [-1, -1], // bottom-left
            [1, -1], // bottom-right
            [1, 1], // top-right
            [-1, 1] // top-left
        ];

        const out = [];
        for (const [nx, ny] of corners) {
            const ray = this._rayFromNdc(nx, ny);
            if (!ray) return null;

            const dy = ray.dir.y;
            if (Math.abs(dy) < 1e-9) return null;

            const t = (groundY - ray.origin.y) / dy;
            if (!Number.isFinite(t) || t <= 0 || t > maxDistance) return null;

            out.push(ray.origin.clone().addScaledVector(ray.dir, t));
        }

        return out;
    }

    getViewportTileRange(zoom, proj, options = {}) {
        const z = Number(zoom);
        if (!Number.isFinite(z)) return null;
        if (!proj?.threeToLonLat || !proj?.lonLatToTile) return null;

        const groundY = Number.isFinite(options.groundY) ? options.groundY : 0;
        const paddingTiles = Math.max(0, (options.paddingTiles ?? 0) | 0);

        const pts = this.getGroundIntersections({ groundY,maxDistance:200000 });
        if (!pts || pts.length < 3) return null;

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        const corners = [];

        for (const p of pts) {
            const ll = proj.threeToLonLat(p.x, 0, p.z);
            corners.push({ lon: ll.lon, lat: ll.lat });
            const t = proj.lonLatToTile(ll.lon, ll.lat, z);
            minX = Math.min(minX, t.x);
            maxX = Math.max(maxX, t.x);
            minY = Math.min(minY, t.y);
            maxY = Math.max(maxY, t.y);
        }

        if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
        return {
            minX: minX - paddingTiles,
            maxX: maxX + paddingTiles,
            minY: minY - paddingTiles,
            maxY: maxY + paddingTiles,
            corners
        };
    }

    // 销毁方法保留，移除事件监听（无滚轮监听后，仅销毁控制器）
    destroy() {
        this.controls?.dispose();
        this.camera = null;
        this.controls = null;
    }
}
