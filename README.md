# FocusDesk · 专注工作台

平板上的轻量专注工作台：**番茄钟 + 待办 + 时间块**。纯本地、可离线、无账号、无后端。

> 一个针对平板 / 桌面场景的「单一用途」专注看板，追求极简与耐用。

## 功能

- **番茄钟**：按「目标结束时间」计时，切后台 / 卡顿不漂；刷新后按规则恢复；专注 / 短休 / 长休时长可配。
- **待办清单**：快速添加、双击改名、勾选完成、删除、按状态过滤。
- **时间块**：时间轴视图，空白处拖拽创建、拖动移动、拖上下边缘改时长、点击编辑；与其它安排重叠时**只提示不覆盖**。
- **联动**：把待办或时间块设为「当前专注任务」，番茄钟运行时主界面显示它；统计今日专注次数与累计分钟。
- **屏幕常亮**：基于 Screen Wake Lock API；不可用或被拒时**如实显示**，不伪造状态。
- **界面轻微位移**：定期让装饰光斑与时钟做极轻微平滑位移（LCD 防灼屏），只作用于装饰层，且尊重系统「减少动态效果」。
- **本地存储**：数据存于浏览器 localStorage，支持导出 / 导入 JSON 备份。
- **PWA**：可安装到桌面、离线打开。

## 运行

1. 最简单：直接用浏览器打开 `index.html`。
2. 完整体验（屏幕常亮 / 离线 / PWA 需要**安全上下文**）：

```bash
python3 -m http.server 8000
# 然后打开 http://localhost:8000/
```

## 在平板上使用

在电脑上起本地服务后，平板浏览器访问 `http://<电脑局域网IP>:8000/`。

⚠️ 局域网下的 `http://` 在浏览器看来**不是安全上下文**，`Screen Wake Lock` 与 Service Worker（PWA）会被禁用。
要使用完整功能，请通过 `https://` 或 `http://localhost` 访问。

## 文件结构

```
index.html            应用主页面
styles.css            样式
app.js                全部逻辑（番茄钟 / 待办 / 时间块 / 唤屏 / 存储）
sw.js                 Service Worker（离线缓存）
manifest.webmanifest  PWA 清单
icon.svg / icon-maskable.svg   图标
test-entry.html       测试入口页（一键直达 + 自检探针 + 检查清单）
tests/smoke.js        jsdom 冒烟测试
```

## 测试

打开 `test-entry.html` 可一键直达各功能并运行自检探针。自动化冒烟测试：

```bash
npm i jsdom
python3 -m http.server 8173 &
node tests/smoke.js
```

## 已知限制

- 数据保存在浏览器 **localStorage**：清除浏览器数据会丢失，请用「导出备份」留底。
- 屏幕常亮依赖 `Screen Wake Lock API`，且需要安全上下文（`https` 或 `localhost`）；系统省电策略可能强制回收，界面会显示「已释放」。
- 未在真实平板触摸 / 唤屏场景下验证（开发验证环境为无头 Chromium）。详见 `test-entry.html`。
