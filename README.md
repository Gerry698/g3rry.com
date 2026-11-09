# g3rry.com

Gerry Zhao 的个人网站：摄影画廊、一个粒子动画小实验和留言板。

- 网站：[g3rry.com](https://g3rry.com/)，摄影：[g3rry.com/photos/](https://g3rry.com/photos/)，留言板：[g3rry.com/guestbook/](https://g3rry.com/guestbook/)
- 维护与发布：[维护手册](docs/maintenance.md)，留言板：[留言板手册](docs/guestbook.md)

原生 HTML、CSS 和 JavaScript，浏览器端没有框架；留言页只额外加载 Cloudflare Turnstile。Node.js 负责生成页面、处理照片和检查产物；GitHub Pages 只发布构建出的 `dist/`，前面由 Cloudflare 代理。留言板后端是 `guestbook/` 里的两个 Cloudflare Worker 和一个 D1 数据库。

## 本地运行

需要 Node.js 24。首次获取仓库或锁文件更新后运行一次 `npm ci`，之后：

```powershell
npm run dev      # 构建、检查并在 http://127.0.0.1:4173/ 预览，改动后自动重建
npm run verify   # 发布前：构建 + 产物检查 + 照片工具测试
```

PowerShell 若拦截 `npm.ps1`，改用 `npm.cmd`。

## 管理照片

```powershell
npm run photos -- list
npm run photos -- add "C:/Pictures/evening.jpg" --alt "按真实画面写的描述" --dry-run
npm run photos -- add "C:/Pictures/evening.jpg" --alt "按真实画面写的描述" --featured
npm run photos -- move p16 --before p03
npm run photos -- feature p16 true
npm run photos -- alt p16 "新的描述"
```

`add` 把照片转成网页母版（长边不超过 3200px、按 EXIF 方向转正、去掉全部元数据）存进 `Photo/`。仓库是公开的，相机原片请留在自己的素材库。

## 文件位置

| 路径 | 用途 |
| --- | --- |
| `content/site.json` | 首页文案、粒子图案、站点信息 |
| `content/photos.json` | 照片顺序、描述、是否精选 |
| `content/mountain.json` | `/mountain/` 山形目录页的文案和营地 |
| `content/eras.json` | `/eras/` 其他年代：各年份的名称、一句话和建造说明 |
| `src/` | 页面模板、样式、粒子动画、画廊交互和留言页；`src/mountain/` 是 WebGL2 山形目录页；`src/eras/` 是各年代的脚本和样式 |
| `Photo/` | 照片网页母版 |
| `image/` | 粒子图案素材 |
| `scripts/` | 构建、检查、预览和照片工具；`scripts/eras/` 生成各年代的页面和图片 |
| `guestbook/` | 留言板的两个 Worker、数据库结构和测试 |
| `.github/workflows/pages.yml` | PR 检查与 `main` 发布 |
| `.github/workflows/guestbook.yml` | 留言板 Worker 测试 |
