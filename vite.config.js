/*
 * @Author: 2409479323@qq.com
 * @Date: 2026-01-15 18:06:48
 * @LastEditors: 2409479323@qq.com 
 * @LastEditTime: 2026-01-26 11:26:59
 * @FilePath: \THREEMapT\vite.config.js
 * @Description: 
 * 
 * Copyright (c) 2026 by bimcc, All Rights Reserved. 
 */
import { defineConfig } from 'vite';
import { resolve } from 'path';

// Vite配置
export default defineConfig({
    // 开发服务器配置
    server: {
        host: '0.0.0.0', // 允许局域网访问
        open: '/index.html', // 自动打开演示页面
        https: false
    },
    
    // 构建配置
    build: {
        lib: {
            entry: resolve(__dirname, 'src/viewer.js'),
            name: 'ThreeMap',
            fileName: (format) => {
                if (format === 'es') {
                    return 'ThreeMap.mjs';
                } else if (format === 'umd') {
                    return 'ThreeMap.umd.js';
                }
                return `ThreeMap.${format}.js`;
            },
            formats: ['es', 'umd'] // 输出ES和UMD格式
        },
        outDir: 'dist',
        emptyOutDir: true,
        sourcemap: true
    }
});
