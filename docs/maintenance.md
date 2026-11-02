# 维护手册

## 改什么、在哪改

| 目标 | 文件 |
| --- | --- |
| 首页文案、粒子图案、站点信息 | `content/site.json` |
| 照片顺序、描述、精选 | `content/photos.json`（优先用 `npm run photos`） |
| 共用页面结构、导航、页脚 | `src/layout.html` |
| 首页、摄影页结构 | `src/index.html`、`src/photos.html` |
| 外观与响应式布局 | `src/styles.css` |
| 粒子效果 / 画廊交互 | `src/particles.js` / `src/gallery.js` |
| 构建与检查 | `scripts/build.mjs`、`scripts/check.mjs` |

页面带有 Content-Security-Policy（`src/layout.html` 的 meta）：只允许本站资源和 Cloudflare Web Analytics。引入任何外部脚本、字体或图片前，先在那里放行，否则浏览器会拦截。

`site.json` 里 `hero.photoId` 指定首屏照片，`phantom.shapes` 的第一项是默认图案。图片 `sizes` 定义在 `build.mjs` 顶部的 `sizes` 对象里，修改 `styles.css` 的网格列数或断点时同步更新它。

## 照片

- 数组顺序就是画廊顺序；`move` 不改 ID，单张链接 `/photos/#photo-p16` 一直有效。
- `featured: true` 的照片进首页精选，至少保留一张。
- `add` 生成网页母版（长边 ≤ 3200px，无元数据），不保存相机原片。所有修改命令都支持 `--dry-run`。
- 工具运行时持有 `.cache/photos.lock`；进程异常退出后，确认没有照片命令在跑再删掉它。
- 构建用 `sharp` 生成 320–1920 共六档宽度的 AVIF 和 WebP，外加一份 1920 宽 JPEG（无 JS 时的链接和"Open image"目标）。编码结果缓存在 `.cache/images`，CI 也会复用。
- AVIF 质量 60 是对照 WebP 测过 PSNR 后定的：每张都不低于 WebP，体积约小两成。调参数前先做同样的对比。

## 粒子图案

素材放 `image/`（PNG 或 JPG，亮且不透明的区域会变成粒子），在 `site.json` 的 `phantom.shapes` 中登记。构建时会缩到 900px 以内并压缩，原图不必预先处理。

## Phantom 实验页（/phantom/）

独立全屏页，`noindex`，不在导航和 sitemap 里。代码在 `src/phantom/`（原生 WebGL2，无依赖；构建时整个目录按内容取哈希输出到 `assets/phantom-<hash>/`），文案与参数在 `content/phantom.json`。

| 章节 | 内容 | 数据 |
| --- | --- | --- |
| Ignite | 首页图案的 GPU 粒子版，指针力场、点击冲击波、长曝光快门 | `site.json` 的 `phantom.shapes` |
| Sculpt | 图案挤出成浮雕，物理相机（焦距、光圈、薄透镜景深、九叶光斑）| 同上 |
| Develop | 每张照片单独的度量深度模型还原成点云；景深按原片的光圈和对焦距离；等亮线 / 等深线（以米计）模式 | `content/phantom/scenes.json`、`content/phantom/scenes/<id>.bin` |
| Atlas | 地球 → 各地 LiDAR 点云 → 在拍摄位置把照片投回场景，再收拢成照片自己的深度点云 | `content/phantom/atlas/` |

- 粒子数按实测 GPU 时间在 6.5 万到 104 万之间自动选档。
- 照片的 EXIF（焦距、光圈、时间）手工记在 `content/phantom.json` 的 `photos` 里，因为 `Photo/` 母版不含元数据。相机时钟一直停在美东标准时间（UTC−5）：纽约那批比当地夏令时慢 1 小时（p12 日落验证），旧金山那批比太平洋时间快 3 小时（p16 太阳高度 0.8° 验证）。
- 离线数据工具在 `tools/phantom-data/`，有自己的 `package.json`，CI 不安装：

```powershell
cd tools/phantom-data; npm install
node depth.mjs p05 p07         # 按场景模型生成度量深度（Depth Anything V2 Small，模型缓存在 .models/）
node atlas.mjs globe           # Natural Earth 陆地掩膜
node atlas.mjs lidar           # 按 phantom.json 里各站点的 clouds 下载并抽稀 LiDAR（缓存在 .cache/ept）
node atlas.mjs frames          # 解算各 stop 的相机位置
```

- 新地点（如田纳西）：先用 `npm run photos -- add` 把照片加进画廊，在 `photos` 里补 EXIF；再在 `sites` 里填 `origin` 和 `lidar`，在 `atlas.stops` 里加 stop，然后跑 `lidar` 与 `frames`。
  - LiDAR 来源：NOAA 的 EPT 是 UTM 坐标（填 `zone`）；USGS 3DEP 的 EPT 是 Web Mercator，另加 `"srs": "EPSG:3857"`，本地坐标系仍按 `zone` 建。
  - 分类错了的结构用 `structures` 走廊改正：2010 年金门测量把大桥归成了植被，走廊内 40 m 以上的点改成桥（class 17，金色），抽稀时整体保留。
  - 以山地为主的点云用 `terrain` 提亮地面和植被。
- stop 的写法：
  - `kind: "globe"` 让地球转到该地点。
  - `kind: "overview"` 是俯瞰，`orbit` 用米写方位、仰角和距离。
  - 其余是照片 stop。`approach` 决定镜头怎么到达机位：`orbit` 绕主体，`above` 从上方，`below` 穿过街面（LiDAR 看不到的地下），`previous` 从上一站直接飞来（`arc` 是航线拱起的高度）。
  - `exposure` 是曝光补偿（EV），用于点稀疏的长焦近景。
  - `project: false` 表示只显示照片、不投影。
  - `photos: [...]` 显示一排照片，用于记不清具体位置的那组。
- 机位 `vantage` 有两种写法：「目标点 + 方位 + 距离」，或「位置 + 方位角 + 俯仰」，`subject` 是主体距离，也是对焦距离。
  - Liberty 由太阳方位和雕像的角大小解出。
  - 金门三张用后方交会解出：从点云里取塔顶、Salesforce 和 Transamerica 塔顶的三维位置，配上照片里的像素位置求相机位姿。p16 的解落在 Marshall's Beach 沙面上，p17、p18 落在 Conzelman Road。
- 页面数据：点云约 15 MiB（六块），深度图约 4 MiB（18 张）；每块只在用到时才下载。

### 照片的深度模型（scenes.json）

网络只给相对深度，形状对，但没有尺度，远近之间还会弯曲。每张照片的深度模型由三部分锚点定出真实距离：

- 读照片写下的场景模型：
  - `subject` 是对焦距离。
  - `anchors` 是已知距离的点或框，例如一个 1.7 m 的人在画面里占多高。
  - `ground` 是地平面：地平线在画面两侧的位置，镜头离地多高，取样区域。
  - `far` 是天空所在的远限。
  - `note` 显示在 Develop 里。
- 解出机位的照片另有 `lidar`（atlas stop 的 id）：从机位看 LiDAR 得到的距离。`lidarRegion` 限定可信区域（沙滩和水会变，桥不会）。
- 拟合方法：
  - 先用单调曲线把相对深度映射到对数深度。
  - 再解一个边缘感知的最小二乘修正：沿颜色和深度的边缘断开，所以悬崖和沙滩各自按各自的锚点修正。
  - 最后把深度边缘对齐到照片的颜色边缘。
- 改了场景模型就重跑 `node depth.mjs <id>`。工具会报告各锚点的误差，并在 `.cache/phantom-scenes/<id>.jpg` 写出带锚点的深度预览，靠这张图判断模型是否合理。
- 地平线和镜头高度的读法：
  - 镜头在人眼高度时，行人的头都落在地平线上。
  - 镜头更低时，近处人物的脚和远处人物的脚之间的关系能同时解出地平线和镜头高度。
  - 积水里的倒影属于地面，不在地面下方。

## 发布

`main` 受 [pages.yml](../.github/workflows/pages.yml) 管理：

- 向 `main` 发 PR：只构建和检查。
- 推送或合并到 `main`：构建、检查、测试通过后部署到 GitHub Pages。
- 每年 1 月 1 日自动重建一次，让页脚年份更新。
- 回滚：`git revert` 对应提交再推送，同一流程重新发布。

工作流中的官方 Actions 固定到提交 SHA；升级时核对 release 与 SHA。依赖升级同时更新 `package.json` 和 `package-lock.json`。

## 域名与 Cloudflare

- 域名在 Cloudflare Registrar 注册（自动续费，DNSSEC 由 Cloudflare 管理），DNS 由 Cloudflare 托管并代理到 GitHub Pages；`CNAME` 由构建按 `site.json` 的 `url` 生成。
- HTTPS 跳转、HSTS、缓存规则和 robots.txt 的 AI 爬虫设置都在 Cloudflare 后台，不在仓库里。
