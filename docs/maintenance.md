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
| 留言板页面、文案 | `src/guestbook.html`、`src/guestbook.js`、`content/site.json` 的 `guestbook` |
| 留言板后端与后台 | `guestbook/`，见[留言板手册](guestbook.md) |
| 页面转场（进出页的黑场） | `src/veil.js`、`src/veil.css`（见下文"转场与刘海屏"） |
| 构建与检查 | `scripts/build.mjs`、`scripts/check.mjs` |

页面带有 Content-Security-Policy（由 `scripts/build.mjs` 的 `policy()` 生成，写进 `src/layout.html` 的 meta）：只允许本站资源和 Cloudflare Web Analytics，留言页额外放行 Turnstile。引入任何外部脚本、字体或图片前，先在那里放行，否则浏览器会拦截。

首页是雪山（见下文"山"）。原来的首页（首屏照片、精选、粒子小实验）保留在 `/legacy/`：`noindex`、不进 sitemap、站内没有任何链接，`check.mjs` 会检查这三点；它的文案仍在 `site.json` 的 `hero`、`photography.featuredTitle` 和 `phantom`。`site.json` 里 `hero.photoId` 指定那张首屏照片（也是普通页面的分享图），`phantom.shapes` 的第一项是默认图案。图片 `sizes` 定义在 `build.mjs` 顶部的 `sizes` 对象里，修改 `styles.css` 的网格列数或断点时同步更新它。

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
- 代码在 `src/mountain/`，原生 ES module，无运行时依赖：`terrain.js` 生成山体、营地位置、小径、树和云，`refine.js` 细化山体网格，`detail.js` 散布谷底的云杉、阔叶树、灌木和石块；`camera.js` 定每站机位和转场；`renderer.js` + `shaders.js` 负责渲染（阴影、雾、天空、云、泛光）；`palettes.js` 是各时辰配色；`weather.js` + `weather-shaders.js` 是云海以下的天气（见下）；`beyond*.js` 是主路线之外的两个章节，`audio.js` 是声音（都见下）；`props.js` 是帐篷、旗和各营地的主题模型；`scene.js` 把这些组装起来，`worker.js` 在后台线程里跑它（不支持模块 Worker 时退回主线程）；`main.js` 管交互和状态。没有多重采样的低画质档（手机）在合成时做 FXAA 抗锯齿。不支持 WebGL2 时页面显示营地列表，背后铺分享图。
- 天气（`weather.js` + `weather-shaders.js`）：营地的时辰只管云海以上。云海（`DECK`，高度表约 1,700 m，过渡带上下约 200 m）以下的谷底和低处山坡跟访客的本地时间走（日出日落随季节，南半球时区月份倒过来），再叠上当天的天气 `clear` / `cloud` / `fog` / `rain` / `snow`：云海的云团随云量增减，阴天光线变漫射、天色变灰，雨天地面变暗、有雨丝和雨幕，雪天朝上的面积雪、树冠挂雪，雾天谷底是一片雾海，夜里有零星灯火（不落在河里）。镜头在云海上方时（首页远景），谷底的光线向营地配色靠一半（`weather.js` 的 `ABOVE`），免得正午的谷底配着峰顶的星空像贴上去的照片；镜头下到云海以下才是完整的本地时辰。水面在云海以下也取谷底的天色和光照。天气按本地日期确定（刷新不变，按月份取概率），由 `weatherFor(date)` 返回 `{ kind, intensity }`，以后接真实天气只换这一个函数。爬过 Camp II 后谷底逐渐回到营地配色，峰顶和原来完全一样；原有的雪粒子在云海以下由天气接手；"减少动态效果"时雨变成慢速短点。
- 构建把整个目录连同两款 OFL 字体（`@fontsource` 的 Cormorant Garamond、JetBrains Mono 拉丁子集）按内容哈希发布到 `/assets/mountain-<hash>/`，所以模块之间的相对 import 不用改。
- 网格精度：`terrain.js` 的环形网格之上，`refine.js` 先把紧挨山脊和尖峰的顶点挪到脊线和峰尖上（只挪离得最近的那个，不超过半格，网格不会翻折），再把面片明显偏离高度函数的格子细分一级（山脊算足，沟槽只算一部分，否则面会变暗），镜头附近太粗的谷底格子也细分；粗细格子之间用扇形过渡，不留裂缝。网格可疑处还会取格子中心，让对角线顺着山脊走、不横切。颜色仍按原网格决定，细分和吸附只改变光影，不会多出雪斑。参数在 `QUALITY.refine`（`tolerance` 越小细分越多）。改完先看待机画面里山脊和加载线是否贴合，再用 `?debug` 的 `bench()` 看帧时间。
- 谷底细节：`detail.js` 在松树之外散布林缘的云杉、草甸上成片的阔叶树、成丛的灌木和石块（悬崖下的碎石坡最密，草甸上零星几块大石），都避开营地、小径和已有的树，数量上限在 `QUALITY.detail`。它们和松树共用一个着色器，`aPart` 区分树皮、针叶、阔叶和岩石；每棵树的高矮也按种子略有不同。以后哪里要空出地面（比如溪流），在 `detail.js` 的 `open()` 里加一条判断即可。
- 山的形状是确定的：同一份代码每次生成同一座山。改 `terrain.js` 里的 `PEAKS` 和噪声参数会整体改变山形和营地位置；远景里那几座独立的远山在 `FAR_PEAKS`。小径是在山体网格上按坡度寻路得出的，陡处自动走之字形，营地之间改了位置会自己重新找路。
- 水（`water.js` 定形状并生成网格，`water-shaders.js`、`water-renderer.js` 负责画）：融雪小溪从登山口右上方的雪线顺冲沟流下，在约 2 个单位高的崖口跌进山脚的深潭，河从潭口出来，在登山口前面绕过山脚，再穿过平原、从远山的缺口流向天边。水道是高度函数的一部分（`terrain.height()` 先由 `water.carve()` 下切，再铺营地平台），网格怎么采样都带着河道、崖壁和潭；寻路把水当作不可走（`buildTrail` 的 `avoid`），树也不长在水里。水位只降不升，贴着沿途最低的地面；靠近山脚只切窄岸，不碰山体和营地，开场天际线和各站机位不变。水面是逐面平涂的三角形：颜色取当前时辰的天色（深处偏天顶色，按菲涅尔反射天空），面片随波翻动；岸边和瀑布脚下整片三角形泛白并向下游移动。白水（溪流的陡段和瀑布）不反射天空，按哑光、略透光的表面打光（`water-shaders.js` 的 `whiteWater`），比雪略暗，不会在泛光里发亮。瀑布是一整条封闭的分面水柱：横截面是前凸后平的椭圆，始终垂直于下落轨迹（出崖口时平、往下渐竖），所以从侧面、上方看都有厚度；泡沫条纹按整块面片顺流下滑，落点有一圈起伏的低多边形水花和淡淡的水雾。潭四周的崖壁按方位起伏（`pool.edge`），瀑布正下方保持原样，好和溪流接上。溪流比低档地形网格的格子还窄，所以整体抬高一点（`STREAM_LIFT`），地形不会盖住水。改走向就改 `water.js` 顶部的极坐标控制点，改完确认小径不过水、登山口高度不变。`hide('water')` 只隐藏水，用来对比耗时。
- 加载：页面一出现就是黑底，中间一条细线从屏幕两侧向峰顶爬，画的正是开场镜头里山的天际线（主峰加远山；`scripts/mountain-ridge.mjs` 在构建时按 `camera.js` 的 `FOV`、待机机位和营地数描出，营地的平台和页面上一样切进地形，竖屏、横屏各一条，结果和图片编码一起缓存在 `.cache/images`）。线的进度跟着真实步骤走：模块就绪、Worker 建好场景、着色器编译完（驱动支持 `KHR_parallel_shader_compile` 时和场景构建并行）、第一帧画出；两步之间缓慢前移，不会停住。右上角高度表同步从 0 数到开场高度。加载再快，最后一段也用 0.6–1.2 秒画完，不会一下跳满。画到峰顶时峰顶亮起一盏灯，在此之前画面保持全黑、开场镜头停在起点；随后山在这条线下浮现（1.6 s），线停留 0.7 s 后淡出，镜头的环绕从静止用 2.5 s 加速到正常，所以淡出时线和山脊始终对得上。加载期间页面不会跳动：文字一开始就在最终位置（"Scroll or click to climb" 按钮先占位、上线后淡入），两款字体用 `font-display: block` 且已预载，不会先显示较宽的后备字体再换掉；带 `#营地` 打开时加载期间不显示首页文字。改了山形、机位或视场角，构建会自动重描。
- 进入营地页：卡片的 "Enter"、回车、再点一次当前营地，或 Photography 卡片里的小图，都先用营地自己的转场把画面收成全黑再跳转（光圈 / 光点 / 信封 / 帐篷，见下文"转场与刘海屏"）；到站后会预取该营地的页面，黑场通常很短。画面盖满后山停止渲染，把机器让给下一页；按返回键回来时接着动。
- 支线章节（`beyond.js` 建模，`beyond-shaders.js`、`beyond-renderer.js` 负责画）：主路线之外还有两站，写在 `content/mountain.json` 的 `beyond` 里（`below` 山之心、`above` Moonward；字段同营地，另有 `pending`（没有 `href` 时卡片上那行字）和 `below.eras`（0–8，山之心保存的"年代"数））。删掉某一项，页面上就没有那一站，对应的模型也不生成。
  - **山之心（The Heart，`#heart`）。** 瀑布旁、朝登山口那一侧的崖壁上有一座石门（两块立石加盖石，门洞里悬着一枚发光的金色碎晶，门槛上长着几簇冷色晶体），和营地的道具一起画，位置由 `placeCave()` 沿潭壁算出；门前的树和灌木会被清掉。洞内是另一个独立的小场景：一枚由多根晶体组成的"心"悬在静水上，按 2.6 s 一拍（两下）搏动，光沿晶体和岩壁向外传；`eras` 枚不同色的小晶体绕着它转，岩壁上同样数量的青色光脉一圈圈环绕（每一条代表保存的一个旧版本，以后接"历代页面"时改 `eras` 并给 `below` 加 `href` 即可）。池面是真实的镜像（整个洞腔倒过来画一遍在水面下，再盖一层水面），洞顶的水滴会在池面荡开涟漪，点一下池面也会。洞内外互不可见：镜头进出都穿过黑场（`main.js` 里 `travel.through`），所以洞腔不需要和山体对得上。
  - **Moonward（`#moonward`）。** 越过峰顶继续上升：月亮是一个带环形山和月海的分面球体（`buildMoon()`，平时在夜色配色给的方向上 300 单位外，和原来天空里那个圆盘一样大；白天按配色的 `moon` 值半透明叠加），到这一站时它靠近到峰顶上方（`MOON.near`），谷底合成一片雾海（云海云量和谷底雾在 `renderer.js` 里随 `sky` 加上去），星空加一层更细的星、银河显出暖色核心和尘带，偶尔有流星；一串星点从峰顶旗杆连到月亮近侧边缘，随上升逐颗点亮。配色是 `palettes.js` 的 `sky`（`deep` 控制深空层）。月面的受光方向是为了好看定的（盈凸月、交界线上有环形山的长影），不按太阳位置算。
  - **怎么去。** 右侧路线两端各多一个标记（线上方一弯月牙、线下方一枚菱形，用几个点和主线隔开），点它、点山上的石门或月亮、或者打开 `/#heart`、`/#moonward` 都直接过去。滚轮、方向键和滑动也能到，但要两次：在开场画面往回滚（或在峰顶继续往上）第一次只是"叫"它一下（底部出现一行提示、标记闪烁、石门或星路亮起、响一声），4.5 秒内再来一次才出发。这样顺着主路线滚到头的人不会被带走，想去的人不用找入口。在支线站点里和营地一样：有 `href` 时出现 "Enter"（转场是 `geode` / `eclipse`），没有时显示 `pending` 那行字。
- 声音（`audio.js`）：全部用 Web Audio 实时合成，没有音频文件，默认关闭；右下角（手机在左上角名字下面）的开关打开后记在 `localStorage`（`g3-sound`、`g3-theme`），`M` 键也能开关。浏览器只允许在点击或按键之后出声，所以记住的"开"要等第一次触碰才开始。三层：
  - **音乐**有三套可选，都是按规则即时生成、不循环的：I Hearth（闷音钢琴加长音和弦，最像"曲子"）、II Thin air（没有节拍，五个长音各按自己的周期出现）、III Lanterns（八音盒，五个音和七个音的两个小音型错开滚动）。每一站有自己的和声、音区和疏密（`HARMONY`：登山口明亮的 D 大调，Photography 偏暖，Phantom 转到关系小调，信箱上行，峰顶是开阔的利底亚，山之心转 D 小调、低而慢，Moonward 高而稀）。进出山之心时调性会变，正在响的音在旧总线上淡出、新的在新总线上开始（`turnPage()`），不会大小调相撞；换曲风同理。
  - **环境声**跟着镜头走：风随海拔和移动变大，瀑布和登山口的篝火按距离和左右方位变化，谷底下雨时在云海以下能听到雨，洞里是低沉的空腔声，峰顶以上只剩很轻的高频气流；混响在室外是厅堂、洞内换成更长更暗的洞穴。
  - **音效**一事一声，都在 `SOUNDS` 里：页面控件（悬停 `hover`、点击 `tap`、开声音 `on`、换曲风 `theme`）；路线（出发 `depart` 随上行/下行变调，进山之心是岩石合拢的低频、去 Moonward 是渐稀的气流加一串上行的玻璃音；到头 `edge`；叫支线 `nudge`）；到站 `arrive` 每个营地一个标志声（登山口篝火噼啪、Photography 快门、Phantom 一串上行的玻璃音、信箱的翻盖和车铃、峰顶的颂钵和旗声、山之心的小调和弦、Moonward 三个高音）；进入页面的转场 `veil`（光圈叶片、拉链、光点、折信封盖火漆、岩石合拢、日食）；山之心的心跳 `heartbeat`（和画面同一个时钟）和水滴 `drip`；Phantom 光点被指针拨开的 `glint`；流星 `meteor`；加载线到顶时的 `light`。
  - 调音量在各乐器和 `SOUNDS` 里的 level，总线在 `build()`。检查时不用靠耳朵：`createAudio({ context })` 接受一个 `OfflineAudioContext`，`advance(秒)` 把音乐写到那一刻，渲染后算峰值和均方根（目前音乐约 −24 至 −27 dBFS，环境声约 −36，音效峰值 −10 至 −35，全部无削波）。页面被转场盖住或切到后台时声音会淡出。
- 调试参数：`?debug` 暴露 `window.mountain`（`station(i)` 跳到第 i 站、`chapter('heart')` / `chapter('moonward')` 直接到支线、`look(eye, target)` 任意机位（`look()` 撤销）、`pose()`、`time('dusk')`、`weather('rain', .8)` / `weather()`、`hour(22.5)` / `hour()`、`bench()` 测每帧耗时、`hide('bloom')`（`hide('weather')` 关掉天气，`'curtains'`、`'lights'` 单独关雨幕和灯火，`'moon'` 关月亮）、`notes(n, note)` 模拟留言板数据、`pointer(x, y)` 模拟指针、`sound` 是音频对象）；`?clean` 隐藏文字层；`?timer` 用定时器驱动渲染（后台标签页不跑 requestAnimationFrame 时用）；`?quality=low|high`；`?motion=reduce`；`?weather=clear|cloud|fog|rain|snow` 和 `?hour=0..24`（可带小数）固定谷底的天气和时间，截图（包括重截分享图）时带上，结果才可复现。
## 转场与刘海屏

- **转场。** `src/veil.js` 以普通脚本放在每个页面的 `<head>` 里（第一次绘制前就运行，也负责给 `<html>` 加 `js` 类）。山上进入营地时调用 `g3veil.leave({ effect, href, origin })`：画面按效果收成全黑，再跳转，并在 `sessionStorage` 里记下效果；目标页从第一帧起就是黑的（`veil.css` 的 `html.veil-hold`），等页面准备好再用同一个效果打开。普通页面等字体和首图解码；`<html data-veil-wait>` 的页面（实验页、照片页）等引擎发出 `g3:ready`（首帧之后）。各种情况都有上限（1.8 s / 3.5 s），脚本出错时黑场 4 s 后也会自己撤掉。系统开了"减少动态效果"时一律改成短暂淡入淡出。
- **效果与营地的对应**在 `src/mountain/main.js` 的 `VEILS`：`photography` 七叶光圈（相机），`phantom` 光点从点击处扩散成金点再变黑，`mailboxes` 信封折起、盖上金色火漆（去外站，只有离场），`summit` 和其他营地是帐篷门（离场时拉链从上往下拉上，到站时从地面往上拉开、两片门帘向两边分开）；两个支线章节是 `geode`（九片不规则的岩片向中间一点金光合拢）和 `eclipse`（天色变暗，月面从右上滑到正中，边缘一圈日冕，最后一粒光珠熄灭）。效果画在一张 2D 画布上，新效果加在 `veil.js` 的 `effects` 里，`time` 是 [离场, 进场] 毫秒。调效果时在控制台用 `g3veil.still('iris', .6)` 定格任意一帧，`g3veil.clear()` 撤掉。
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
