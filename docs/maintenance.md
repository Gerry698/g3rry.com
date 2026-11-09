# 维护手册

## 改什么、在哪改

| 目标 | 文件 |
| --- | --- |
| 站点信息、粒子图案、旧首页文案 | `content/site.json` |
| 照片顺序、描述、精选 | `content/photos.json`（优先用 `npm run photos`） |
| 共用页面结构、导航、页脚 | `src/layout.html` |
| 旧首页（`/legacy/`）、摄影页结构 | `src/index.html`、`src/photos.html` |
| 外观与响应式布局 | `src/styles.css` |
| 粒子效果 / 画廊交互 | `src/particles.js` / `src/gallery.js` |
| 首页（雪山） | `content/mountain.json`、`src/mountain/`（见下文"山"） |
| 其他年代 | `content/eras.json`、`scripts/eras/`、`src/eras/`（见下文"其他年代"） |
| 解谜（/strata/） | 私有目录 `D:\Claude\g3rry.com-hunt\`、`scripts/strata/`、`src/strata/`、`hunt/`（见下文"解谜"） |
| 留言板页面、文案 | `src/guestbook.html`、`src/guestbook.js`、`content/site.json` 的 `guestbook` |
| 留言板后端与后台 | `guestbook/`，见[留言板手册](guestbook.md) |
| 页面转场（进出页的黑场） | `src/veil.js`、`src/veil.css`（见下文"转场与刘海屏"） |
| 构建与检查 | `scripts/build.mjs`、`scripts/check.mjs` |

页面带有 Content-Security-Policy（由 `scripts/build.mjs` 的 `policy()` 生成，写进 `src/layout.html` 的 meta）：只允许本站资源和 Cloudflare Web Analytics，留言页额外放行 Turnstile。引入任何外部脚本、字体或图片前，先在那里放行，否则浏览器会拦截。

首页是雪山（见下文"山"）。原来的首页（首屏照片、精选、粒子小实验）保留在 `/legacy/`：`noindex`、不进 sitemap、站内只有 `/eras/` 把它列作 2025 年，`check.mjs` 会检查这三点；它的文案仍在 `site.json` 的 `hero`、`photography.featuredTitle` 和 `phantom`。`site.json` 里 `hero.photoId` 指定那张首屏照片（也是普通页面的分享图），`phantom.shapes` 的第一项是默认图案。图片 `sizes` 定义在 `build.mjs` 顶部的 `sizes` 对象里，修改 `styles.css` 的网格列数或断点时同步更新它。

## 照片

- 数组顺序就是画廊顺序；`move` 不改 ID。每张照片有自己的页面 `/photos/<id>/`（见下文 Phantom）；旧的单张链接 `/photos/#photo-p16` 仍在画廊里打开快速预览，预览里有到照片页的入口。
- `featured: true` 的照片进雪山 Photography 营地的三张小图和旧首页精选，至少保留一张。
- `add` 生成网页母版（长边 ≤ 3200px，无元数据），不保存相机原片。所有修改命令都支持 `--dry-run`。
- 工具运行时持有 `.cache/photos.lock`；进程异常退出后，确认没有照片命令在跑再删掉它。
- 构建用 `sharp` 生成 320–1920 共六档宽度的 AVIF 和 WebP，外加一份 1920 宽 JPEG（无 JS 时的链接和"Open image"目标）。编码结果缓存在 `.cache/images`，CI 也会复用。
- AVIF 质量 60 是对照 WebP 测过 PSNR 后定的：每张都不低于 WebP，体积约小两成。调参数前先做同样的对比。

## 粒子图案

素材放 `image/`（PNG 或 JPG，亮且不透明的区域会变成粒子），在 `site.json` 的 `phantom.shapes` 中登记。构建时会缩到 900px 以内并压缩，原图不必预先处理。

## 山（首页 /）

首页是一个用 WebGL2 画的雪山目录页：打开时镜头绕山缓慢旋转，滚轮、点击、方向键或手机上下滑动，镜头沿螺旋小径一站一站爬到峰顶，时辰随海拔从拂晓走到星夜。它以前在 `/mountain/`，那个地址现在是一张转向页（`noindex`，用一小段脚本带上 `#营地` 跳到 `/#营地`，没有脚本时 meta refresh 到首页）。其他页面的主导航是 Home、Photography、The Phantom、Guestbook；分享链接时的预览图是 `src/mountain/social.jpg`（1200×630，用 `?debug&clean` 渲染截取），山形或配色大改后重截一张。

- 文案和营地在 `content/mountain.json`：`intro` 是标题屏，`camps` 按山脚到峰顶排列（3–9 个，最后一个是峰顶）。每个营地有 `id`（也是 `#id` 深链接）、`title`、`description`，可选 `kicker`、`href`（站内路径或 `https://*.g3rry.com/`，缺省时显示 "Trail under construction"）、`time`（`dawn` / `morning` / `noon` / `golden` / `dusk` / `night`）、`model`（营地的主题模型，见下）。
- 主题模型（`props.js`）：`trailhead` 路标、背包和篝火；`photography` 三脚架相机和一排晾着的照片，颜色取自精选照片里最鲜艳的色调（构建时算）；`phantom` 一圈立石，上方的光点平时散着飘，到站时聚成 `site.json` 第一个 Phantom 图案（构建时从 `image/` 取点），鼠标划过会被冲散；`mailboxes` 一排信箱和一盏灯；`summit` 峰顶旗、发光的登顶簿和一串三角旗，旗数等于留言板已公开的留言数（运行时读 `/api/guestbook`，最多 12 面）。峰顶卡片同时显示最新一条留言，Photography 卡片显示三张精选照片。
- 代码在 `src/mountain/`，原生 ES module，无运行时依赖：`terrain.js` 生成山体、营地位置、小径、树和云，`refine.js` 细化山体网格，`detail.js` 散布谷底的云杉、阔叶树、灌木和石块；`camera.js` 定每站机位和转场；`renderer.js` + `shaders.js` 负责渲染（阴影、雾、天空、云、泛光）；`palettes.js` 是各时辰配色；`weather.js` + `weather-shaders.js` 是云海以下的天气（见下）；`props.js` 是帐篷、旗和各营地的主题模型；`scene.js` 把这些组装起来，`worker.js` 在后台线程里跑它（不支持模块 Worker 时退回主线程）；`main.js` 管交互和状态。没有多重采样的低画质档（手机）在合成时做 FXAA 抗锯齿。不支持 WebGL2 时页面显示营地列表，背后铺分享图。
- 天气（`weather.js` + `weather-shaders.js`）：营地的时辰只管云海以上。云海（`DECK`，高度表约 1,700 m，过渡带上下约 200 m）以下的谷底和低处山坡跟访客的本地时间走（日出日落随季节，南半球时区月份倒过来），再叠上当天的天气 `clear` / `cloud` / `fog` / `rain` / `snow`：云海的云团随云量增减，阴天光线变漫射、天色变灰，雨天地面变暗、有雨丝和雨幕，雪天朝上的面积雪、树冠挂雪，雾天谷底是一片雾海，夜里有零星灯火（不落在河里）。镜头在云海上方时（首页远景），谷底的光线向营地配色靠一半（`weather.js` 的 `ABOVE`），免得正午的谷底配着峰顶的星空像贴上去的照片；镜头下到云海以下才是完整的本地时辰。水面在云海以下也取谷底的天色和光照。天气按本地日期确定（刷新不变，按月份取概率），由 `weatherFor(date)` 返回 `{ kind, intensity }`，以后接真实天气只换这一个函数。爬过 Camp II 后谷底逐渐回到营地配色，峰顶和原来完全一样；原有的雪粒子在云海以下由天气接手；"减少动态效果"时雨变成慢速短点。
- 构建把整个目录连同两款 OFL 字体（`@fontsource` 的 Cormorant Garamond、JetBrains Mono 拉丁子集）按内容哈希发布到 `/assets/mountain-<hash>/`，所以模块之间的相对 import 不用改。
- 网格精度：`terrain.js` 的环形网格之上，`refine.js` 先把紧挨山脊和尖峰的顶点挪到脊线和峰尖上（只挪离得最近的那个，不超过半格，网格不会翻折），再把面片明显偏离高度函数的格子细分一级（山脊算足，沟槽只算一部分，否则面会变暗），镜头附近太粗的谷底格子也细分；粗细格子之间用扇形过渡，不留裂缝。网格可疑处还会取格子中心，让对角线顺着山脊走、不横切。颜色仍按原网格决定，细分和吸附只改变光影，不会多出雪斑。参数在 `QUALITY.refine`（`tolerance` 越小细分越多）。改完先看待机画面里山脊和加载线是否贴合，再用 `?debug` 的 `bench()` 看帧时间。
- 谷底细节：`detail.js` 在松树之外散布林缘的云杉、草甸上成片的阔叶树、成丛的灌木和石块（悬崖下的碎石坡最密，草甸上零星几块大石），都避开营地、小径和已有的树，数量上限在 `QUALITY.detail`。它们和松树共用一个着色器，`aPart` 区分树皮、针叶、阔叶和岩石；每棵树的高矮也按种子略有不同。以后哪里要空出地面（比如溪流），在 `detail.js` 的 `open()` 里加一条判断即可。
- 山的形状是确定的：同一份代码每次生成同一座山。改 `terrain.js` 里的 `PEAKS` 和噪声参数会整体改变山形和营地位置；远景里那几座独立的远山在 `FAR_PEAKS`。小径是在山体网格上按坡度寻路得出的，陡处自动走之字形，营地之间改了位置会自己重新找路。
- 水（`water.js` 定形状并生成网格，`water-shaders.js`、`water-renderer.js` 负责画）：融雪小溪从登山口右上方的雪线顺冲沟流下，在约 2 个单位高的崖口跌进山脚的深潭，河从潭口出来，在登山口前面绕过山脚，再穿过平原、从远山的缺口流向天边。水道是高度函数的一部分（`terrain.height()` 先由 `water.carve()` 下切，再铺营地平台），网格怎么采样都带着河道、崖壁和潭；寻路把水当作不可走（`buildTrail` 的 `avoid`），树也不长在水里。水位只降不升，贴着沿途最低的地面；靠近山脚只切窄岸，不碰山体和营地，开场天际线和各站机位不变。水面是逐面平涂的三角形：颜色取当前时辰的天色（深处偏天顶色，按菲涅尔反射天空），面片随波翻动；岸边、急流和瀑布脚下整片三角形泛白并向下游移动；瀑布是三层带条纹的面带，脚下有水雾。改走向就改 `water.js` 顶部的极坐标控制点，改完确认小径不过水、登山口高度不变。`hide('water')` 只隐藏水，用来对比耗时。
- 加载：页面一出现就是黑底，中间一条细线从屏幕两侧向峰顶爬，画的正是开场镜头里山的天际线（主峰加远山；`scripts/mountain-ridge.mjs` 在构建时按 `camera.js` 的 `FOV`、待机机位和营地数描出，营地的平台和页面上一样切进地形，竖屏、横屏各一条，结果和图片编码一起缓存在 `.cache/images`）。线的进度跟着真实步骤走：模块就绪、Worker 建好场景、着色器编译完（驱动支持 `KHR_parallel_shader_compile` 时和场景构建并行）、第一帧画出；两步之间缓慢前移，不会停住。右上角高度表同步从 0 数到开场高度。加载再快，最后一段也用 0.6–1.2 秒画完，不会一下跳满。画到峰顶时峰顶亮起一盏灯，在此之前画面保持全黑、开场镜头停在起点；随后山在这条线下浮现（1.6 s），线停留 0.7 s 后淡出，镜头的环绕从静止用 2.5 s 加速到正常，所以淡出时线和山脊始终对得上。加载期间页面不会跳动：文字一开始就在最终位置（"Scroll or click to climb" 按钮先占位、上线后淡入），两款字体用 `font-display: block` 且已预载，不会先显示较宽的后备字体再换掉；带 `#营地` 打开时加载期间不显示首页文字。改了山形、机位或视场角，构建会自动重描。
- 进入营地页：卡片的 "Enter"、回车、再点一次当前营地，或 Photography 卡片里的小图，都先用营地自己的转场把画面收成全黑再跳转（光圈 / 光点 / 信封 / 帐篷，见下文"转场与刘海屏"）；到站后会预取该营地的页面，黑场通常很短。画面盖满后山停止渲染，把机器让给下一页；按返回键回来时接着动。
- 调试参数：`?debug` 暴露 `window.mountain`（`station(i)` 跳到第 i 站、`pose()`、`time('dusk')`、`weather('rain', .8)` / `weather()`、`hour(22.5)` / `hour()`、`bench()` 测每帧耗时、`hide('bloom')`（`hide('weather')` 关掉天气，`'curtains'`、`'lights'` 单独关雨幕和灯火）、`notes(n, note)` 模拟留言板数据、`pointer(x, y)` 模拟指针）；`?clean` 隐藏文字层；`?timer` 用定时器驱动渲染（后台标签页不跑 requestAnimationFrame 时用）；`?quality=low|high`；`?motion=reduce`；`?weather=clear|cloud|fog|rain|snow` 和 `?hour=0..24`（可带小数）固定谷底的天气和时间，截图（包括重截分享图）时带上，结果才可复现。
## 转场与刘海屏

- **转场。** `src/veil.js` 以普通脚本放在每个页面的 `<head>` 里（第一次绘制前就运行，也负责给 `<html>` 加 `js` 类）。山上进入营地时调用 `g3veil.leave({ effect, href, origin })`：画面按效果收成全黑，再跳转，并在 `sessionStorage` 里记下效果；目标页从第一帧起就是黑的（`veil.css` 的 `html.veil-hold`），等页面准备好再用同一个效果打开。普通页面等字体和首图解码；`<html data-veil-wait>` 的页面（实验页、照片页）等引擎发出 `g3:ready`（首帧之后）。各种情况都有上限（1.8 s / 3.5 s），脚本出错时黑场 4 s 后也会自己撤掉。系统开了"减少动态效果"时一律改成短暂淡入淡出。
- **效果与营地的对应**在 `src/mountain/main.js` 的 `VEILS`：`photography` 七叶光圈（相机），`phantom` 光点从点击处扩散成金点再变黑，`mailboxes` 信封折起、盖上金色火漆（去外站，只有离场），`summit` 和其他营地是帐篷门（离场时拉链从上往下拉上，到站时从地面往上拉开、两片门帘向两边分开）。效果画在一张 2D 画布上，新效果加在 `veil.js` 的 `effects` 里，`time` 是 [离场, 进场] 毫秒。调效果时在控制台用 `g3veil.still('iris', .6)` 定格任意一帧，`g3veil.clear()` 撤掉。
- **样式。** `veil.css` 由构建追加到每个页面的样式表末尾（`styles.css`、山和实验页的 CSS），不单独请求。
- **刘海和下巴。** 所有页面都是 `viewport-fit=cover`，文字和按钮用 `env(safe-area-inset-*)` 避开刘海、圆角和底部横条。手机 Safari（iOS 26 起）遇到贴着屏幕边缘的 `position: fixed` 元素，会在状态栏和工具栏下面填一条纯色，这就是上下两条"不可用边框"的来源。所以山的画布不再是 fixed：它放在一个不滚动的页面里、高 `100lvh`，浏览器就把山画到状态栏和工具栏下面。浏览器自己必须填色的地方（状态栏、Android 的 `theme-color`、回弹区）跟着画面顶边的天色走：渲染器每隔一段时间把顶边四个像素异步读回（`renderer.js` 的 `sampleEdge`，不阻塞 GPU），`main.js` 写进 `--tint` 和 `theme-color`。实验页的画布仍是 fixed，但它的底色和页面同为 `#06080b`，填色看不出来。真机效果只能在手机上确认，桌面浏览器的模拟器没有刘海。

## Phantom 实验页（/phantom/）与照片页（/photos/<id>/）

两种页面共用一套引擎 `src/phantom/`（原生 WebGL2，无依赖；构建时整个目录按内容取哈希输出到 `assets/phantom-<hash>/`），文案与参数在 `content/phantom.json`。引擎按页面里有哪些 `data-chapter` 段落装配章节，每页的 `lab-config` 只带本页要显示的内容。

- **实验页**（`src/phantom/page.html`）介绍技术，每章一个例子：`example.develop` 是 Develop 的示例照片，`example.atlas` 是 Atlas 示例经过的 stop。
- **照片页**（`src/phantom/photo.html`，每张照片一页）只有 02 Develop 和 03 Atlas。Atlas 的路线由构建自动选：照片有自己的 stop 时是「地球 → 城市俯瞰 → 机位」；同一地点（`place` 相同）另有已解算的 stop 时，借用那个机位看街景、不放那张照片，太阳按本张的拍摄时刻；否则只到城市俯瞰。所在城市不是 `live` 时没有 Atlas。
- 每张照片都必须有 `photos` 元数据和深度模型（`scenes.json` + `scenes/<id>.bin`），否则构建失败。

| 章节 | 内容 | 数据 |
| --- | --- | --- |
| Ignite | 旧首页粒子小实验的 GPU 版，指针力场、点击冲击波、长曝光快门 | `site.json` 的 `phantom.shapes` |
| Sculpt | 图案挤出成浮雕，物理相机（焦距、光圈、薄透镜景深、九叶光斑）| 同上 |
| Develop | 每张照片单独的度量深度模型还原成点云；景深按原片的光圈和对焦距离；等亮线 / 等深线（以米计）模式 | `content/phantom/scenes.json`、`content/phantom/scenes/<id>.bin` |
| Atlas | 地球 → 各地 LiDAR 点云，按拍摄那一刻的太阳打光 → 在拍摄位置把照片投回场景，再收拢成照片自己的深度点云 | `content/phantom/atlas/` |

- 粒子数按实测 GPU 时间在 6.5 万到 104 万之间自动选档。
- 照片的 EXIF（焦距、光圈、时间）手工记在 `content/phantom.json` 的 `photos` 里，因为 `Photo/` 母版不含元数据。相机时钟按美东标准时间（UTC−5）走：
  - 纽约那批比当地夏令时慢 50 分钟，即时钟还快了约 10 分钟。这是由 p12 定出的：照片里太阳中心离地平线 1.3°，只有 20:17 EDT 时太阳在那个高度，Atlas 算出的太阳也落在照片里太阳的位置。
  - 旧金山那批比太平洋时间快 3 小时，只用 p16 的阳光核对过，精度在十几分钟以内。
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
- 拍摄时刻的光：
  - 构建时由 EXIF 和行程的时钟修正算出每个 stop 的拍摄时间（UTC，存进 `light`），页面用 NOAA 算法求太阳方位和高度（含大气折射）。
  - 太阳方向的阴影贴图贴合当前点云，被照到的点偏暖，处在阴影里的点偏冷，太阳本身也画在它真实的方向上。
  - 镜头到站的过程中，太阳从拍摄前两小时走到按下快门那一刻；俯瞰段先用下一张照片拍摄前两小时的光。
  - 取景器显示太阳的方位、高度和当地时间。
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

### Atlas 收件箱与发布流程

新照片和新地点走"投稿 → 处理 → 上线"的流程：

- **收件箱。** 私有的 claude.ai 页面 https://claude.ai/artifact/Y75neHHpPBjm9s2Z1PzwYo，源文件是 `tools/atlas-inbox/inbox.html`。改了站点或 stop 后，运行 `node tools/atlas-inbox/build.mjs` 刷新页面里的地图数据，再按同一个 URL 重新发布。
- **本机收件箱。** 同一个页面由 `tools/atlas-inbox/local.mjs` 在 http://127.0.0.1:4190/ 提供（桌面快捷方式「Atlas Inbox」运行 `open-inbox.cmd`，关掉窗口即停止）。照片原样存进 `D:\Claude\g3rry.com-inbox\blobs`（保留 EXIF/GPS，不缩图、无 20 MB 上限），投稿存为 `submissions/<id>.json`。只接受本机页面的请求；目录可用 `ATLAS_INBOX_DIR` 改。手机仍用上面的 claude.ai 页面；`/phantom-publish` 两边都读。
- **一条投稿包含：**
  - 照片；
  - 一个 pin（来自照片 GPS、粘贴的坐标或 Google 地图链接，或地图上的粗略点选）；
  - 地点和经过。
- **存储。** 投稿存在页面自己的数据库里，只有所有者能读写；照片存在页面的资源存储里。超过 20 MB 的原图先在浏览器里缩到 3200 px 再上传，焦距、光圈、时间、GPS 在缩图前读出、记进投稿。
- **处理。** 在 Claude Code 里运行 `/phantom-publish`（用户级技能 `C:\Users\16937\.claude\skills\phantom-publish`）。流程：读出待处理的投稿 → 定位、加进画廊和 Atlas、生成深度模型 → 构建并上线 → 在收件箱里回写结果和链接。拿不准的地方会在收件箱里提问，不会直接上线。
- **配套工具：**
  - `tools/phantom-data/resect.mjs`：后方交会，用 LiDAR 里的地标解出机位。
  - `tools/phantom-data/grid.mjs`：带刻度的裁切图，用来读地标和地平线的像素位置。

## 其他年代（/eras/）

同一个站按八个过去的年份各重做一遍：1996、1999、2003、2007、2011、2014、2018、2023，每个版本只用那一年真有的技术，内容来自同一份数据（照片、地点、EXIF、留言板实时读取）。入口是 `/eras/`（全站页脚 "Other years"），它在 sitemap 里；各年份的页面都带 `noindex`。

- 文案在 `content/eras.json`：每年的 `name`、`line`（目录上的一句话）、`colophon`（"How it was built" 的段落），`dial: true` 的年份在目录上有 "Arrive by modem"。年份必须递增，且每年都要有对应的生成模块。
- `versions` 是站点自己的真实版本，排在重做的年份之后：2025 是旧首页 `/legacy/`，2026 是现在的首页（雪山）`/`。年份环从 2026 绕回 1996，各年代页上的 Time Ring 都用年份标注，不写 "Now"。
- 生成：`scripts/eras/index.mjs` 依次调用 `scripts/eras/y<年份>.mjs`，每个模块写自己年份的页面和图片到 `dist/eras/<年份>/`；`src/eras/<年份>/` 里的脚本和样式原样复制（文件名不加哈希，查看源代码本身就是内容的一部分）。照片的派生图走和主站相同的 `.cache/images` 缓存。
- 早期年份的图都是代码画的：`scripts/eras/pixels.mjs` 是 5×7 点阵字体和 GIF/PNG 输出（标题、88×31 小徽章、施工路障、计数器数字、Phantom 动图）；`scripts/eras/fonts.mjs` 把 @fontsource 的 WOFF 解包成 TTF，供 sharp 渲染 2007 年的光泽 logo（sharp 读不了 WOFF，直接传会静默换成默认字体）。
- 调制解调器：`src/eras/modem.js` 是作用于 `/eras/` 的 Service Worker，只放慢 1996 和 1999 两年：一条共享的线、最多四个连接、每个响应前 250 ms，速率按"连接速度 ÷ 8 × 0.85"。默认 1996 是 28.8k、1999 是 56K（按 48,000 bps 计）；访客在 `/eras/dialup.html` 或页脚菜单里换速度，设置存在 Cache Storage。拨号音是 `dialup.js` 用 Web Audio 现场合成的。
- 内容安全策略不变：所有年代都没有内联脚本或内联样式，"当年会写成 onMouseOver 属性"的东西都改成外部脚本挂事件。早期年份的 HTML 用大写标签，`check.mjs` 的正则因此全部不区分大小写。
- 访客计数器（1996、1999）请求 `/api/counter`（hunt Worker，见下文"解谜"），接口不通时计数器保持隐藏。
- 检查：每年都要有 `index.html`，目录要链接到每一年，年代页都带 `noindex`，年代脚本里不许出现 `innerHTML` 之类把留言文字当 HTML 的写法。
- 加一个年份：在 `eras.json` 里按顺序加一项，写 `scripts/eras/y<年份>.mjs` 并在 `index.mjs` 的 `builders` 里登记，静态文件放 `src/eras/<年份>/`。各年份页面里的 "Time ring" 会自动接上前后年份。

## 解谜（/strata/）

`/strata/` 是一场藏在站里的解谜游戏的枢纽页：一张山体剖面，地表是现在的站（2026），往下依次是其他年代，最底下是"基岩"（HTTP、邮件、DNS、电话线）。每一层埋着一道题，每道题的答案填进本层的格子；从峰顶往下打的钻孔穿过每层一个字母，连起来是最后一步的指令。走完最后一步的人可以在峰顶插一面旗：只有编号、日期和颜色，没有文字，所以不需要审核。枢纽页带 `noindex`、不进 sitemap，入口在 `/eras/` 页底、404 页的源代码和 `robots.txt`。

- **答案不在这个仓库里。** 仓库是公开的，所以这里只有访客本来就能看到的谜面数据和答案的 HMAC 哈希。答案、解法、只有解出来才该看到的文字（重定向链、护林员的回信、BBS）都在本机私有目录 `D:\Claude\g3rry.com-hunt\`（本地 git，不推送）：`SOLUTIONS.md` 是完整设计和解法，`hunt.mjs` 是唯一来源。
- **不要手改** `content/strata.json`、`content/strata/puzzles.json`、`hunt/src/answers.js`：它们由 `node D:\Claude\g3rry.com-hunt\hunt.mjs` 生成（生成器会逐题断言提取结果正确）。改谜题、改答案都在私有目录里改，再重新生成、构建。
- 各年代里埋题的代码都带注释 "a puzzle of /strata/"，在 `scripts/eras/y*.mjs` 和 `src/eras/` 里搜这句就能找到。改这些年代页时注意不要碰坏它们；`check.mjs` 会检查枢纽页、入口、`robots.txt` 指向的目录和每题的答案哈希都在。
- 发布前在私有目录跑 `node audit.mjs`：它只看 `dist/`，像读源代码的玩家一样把站内能解的题全部解一遍，再扫描整个 `dist/` 有没有答案明文。
- 拨号页（`/eras/dialup.html`）可以拨别的号码：号码交给 hunt Worker 判断，拨对了由 `src/eras/board.js` 显示一个终端（BBS）。
- 后端是 `hunt/` 里的 Worker（`g3rry.com/api/hunt*`、`g3rry.com/api/counter*`），D1 数据库 `hunt`：`/api/hunt/check` 校验答案（每个地址每分钟 20 次），`/api/hunt/trail/*` 是一串重定向，`/api/hunt/dial`、`/api/hunt/flag`、`/api/hunt/flags` 是最后一步和旗，`/api/counter` 是 1996、1999 两年的访客计数器。发往 `ranger@g3rry.com` 的邮件由同一个 Worker 自动回信（只回复通过 DMARC 的发件人，每人每天最多 3 封）。测试：`cd hunt; npm test`（Miniflare，用的是假数据）。
- 本地试玩：先 `npm run build`，再用 `.claude/launch.json` 里的 `hunt-api`（端口 7790，读私有目录的密钥和种子）和 `preview-hunt`（端口 4176）。这台机器上 8770–9680 端口被 Windows 保留，所以本地 API 用 7790。

首次上线（每一步都要主人确认）：

```powershell
cd hunt
npx wrangler d1 create hunt                       # 把输出的 database_id 填进 wrangler.jsonc
npx wrangler d1 migrations apply hunt --remote
npx wrangler d1 execute hunt --remote --file D:\Claude\g3rry.com-hunt\seed.sql
npx wrangler secret put HUNT_KEY                  # 值在 D:\Claude\g3rry.com-hunt\secrets.local.json
npx wrangler secret put IP_PEPPER
npx wrangler deploy
```

然后在 Cloudflare 后台：Email Routing 加一条自定义地址 `ranger@g3rry.com` → 发送到 Worker `hunt`（它比 catch-all 优先）；DNS 按 `D:\Claude\g3rry.com-hunt\dns.json` 加 `summits` 的 LOC 和 TXT 记录（仅 DNS，不代理）。改了重定向链、回信或 BBS 的文字，重新生成后再执行一次 `d1 execute ... seed.sql` 即可，不用重新部署。

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
