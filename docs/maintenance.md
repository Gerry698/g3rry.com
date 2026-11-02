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
| 山形目录页 | `content/mountain.json`、`src/mountain/`（见下文"山"） |
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

## 山（/mountain/）

一个用 WebGL2 画的雪山目录页：打开时镜头绕山缓慢旋转，滚轮、点击、方向键或手机上下滑动，镜头沿螺旋小径一站一站爬到峰顶，时辰随海拔从拂晓走到星夜。页面目前 `noindex`，不在导航和 sitemap 里。

- 文案和营地在 `content/mountain.json`：`intro` 是标题屏，`camps` 按山脚到峰顶排列（3–9 个，最后一个是峰顶）。每个营地有 `id`（也是 `#id` 深链接）、`title`、`description`，可选 `kicker`、`href`（站内路径，缺省时显示 "Trail under construction"）、`time`（`dawn` / `morning` / `noon` / `golden` / `dusk` / `night`）。
- 代码在 `src/mountain/`，原生 ES module，无运行时依赖：`terrain.js` 生成山体、营地位置、小径、树和云；`camera.js` 定每站机位和转场；`renderer.js` + `shaders.js` 负责渲染（阴影、雾、天空、云、泛光）；`palettes.js` 是各时辰配色；`props.js` 是帐篷、旗和石堆；`main.js` 管交互和状态。
- 构建把整个目录连同两款 OFL 字体（`@fontsource` 的 Cormorant Garamond、JetBrains Mono 拉丁子集）按内容哈希发布到 `/assets/mountain-<hash>/`，所以模块之间的相对 import 不用改。
- 山的形状是确定的：同一份代码每次生成同一座山。改 `terrain.js` 里的 `PEAKS` 和噪声参数会整体改变山形和营地位置；远景里那几座独立的远山在 `FAR_PEAKS`。小径是在山体网格上按坡度寻路得出的，陡处自动走之字形，营地之间改了位置会自己重新找路。
- 调试参数：`?debug` 暴露 `window.mountain`（`station(i)` 跳到第 i 站、`pose()`、`time('dusk')`、`bench()` 测每帧耗时、`hide('bloom')`）；`?clean` 隐藏文字层；`?timer` 用定时器驱动渲染（后台标签页不跑 requestAnimationFrame 时用）；`?quality=low|high`；`?motion=reduce`。

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
