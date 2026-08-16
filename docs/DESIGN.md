# Analyze Music — AI 影视配乐管理系统方案

## 1. 项目目标

开发一个运行在本地的 Web 应用，用 AI 自动理解、分类和管理纯音乐，主要服务于视频剪辑配乐选择。

核心使用场景：

```text
本地音乐文件夹
      ↓
批量导入
      ↓
自动提取音乐信息
      ↓
AI 分析情绪 / 电影感 / 叙事作用
      ↓
分析 Build / Climax / Outro 等结构
      ↓
人工检查、编辑
      ↓
搜索 / 筛选
      ↓
一键生成或同步飞书多维表格
```

产品重点不是普通的“音乐管理器”，而是：

> 面向影视剪辑场景的 AI 配乐检索系统。

---

# 2. 第一版范围

V1 聚焦六件事：

1. 本地音乐管理
2. 文件夹批量导入
3. AI 自动分析
4. 音乐分类、筛选、人工编辑
5. 批量任务和进度管理
6. 一键生成 / 同步飞书多维表格

暂时不做：

* 视频自动配乐
* 音乐自动裁切
* 多用户权限
* 云端音乐存储
* 推荐算法
* 向量数据库
* MERT 相似音乐搜索

这些放 V2/V3。

---

# 3. 系统架构

```text
┌──────────────────────────────────────────┐
│            Analyze Music Web             │
│                                          │
│ React + Arco Design                      │
│ Zustand + TanStack Query                 │
│                                          │
│ 音乐管理 / 导入 / 试听 / 编辑 / 筛选      │
└──────────────────┬───────────────────────┘
                   │ HTTP
                   │ SSE
                   ▼
┌──────────────────────────────────────────┐
│              Node Service                │
│                                          │
│ Fastify                                  │
│                                          │
│ Music API                                │
│ Import Job                               │
│ Analyze Job                              │
│ File Service                             │
│ AI Service                               │
│ Feishu Service                           │
└───────────┬────────────┬─────────────────┘
            │            │
            │            ├──── Qwen3.5-Omni API
            │            │
            │            └──── Feishu CLI
            │
            ▼
┌──────────────────────────────────────────┐
│            Music Analyzer                │
│                                          │
│ FFmpeg / ffprobe                         │
│ Essentia                                 │
│ Python CLI Worker                        │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│               SQLite                    │
│                                          │
│ music                                    │
│ analysis                                 │
│ segments                                 │
│ jobs                                     │
│ feishu_sync                              │
└──────────────────────────────────────────┘
```

整体原则：

**Web 是操作界面，Node 是系统核心，Python/Essentia 是音乐测量工具，Qwen 是音乐语义理解模型，飞书是输出端。**

---

# 4. Monorepo 结构

基于指定的：

`dkplus-pro/monorepo-template`

目前通过 GitHub 连接读取到远程仓库基本为空，因此方案不依赖它内部已有 workspace 结构；如果后续模板增加配置，只需要把下面目录适配进去。

推荐目录：

```text
analyze-music/
│
├── apps/
│   │
│   ├── node-service/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── music/
│   │   │   │   ├── import/
│   │   │   │   ├── analyze/
│   │   │   │   ├── jobs/
│   │   │   │   ├── feishu/
│   │   │   │   └── settings/
│   │   │   │
│   │   │   ├── services/
│   │   │   ├── routes/
│   │   │   └── main.ts
│   │   │
│   │   └── package.json
│   │
│   └── analyze-music/
│       ├── src/
│       │   ├── pages/
│       │   │   └── music/
│       │   ├── components/
│       │   ├── stores/
│       │   ├── api/
│       │   ├── hooks/
│       │   └── router/
│       │
│       └── package.json
│
├── packages/
│   │
│   ├── contracts/
│   │   └── API DTO / Zod Schema
│   │
│   ├── database/
│   │   └── Drizzle Schema
│   │
│   ├── music-domain/
│   │   └── 音乐分类 Taxonomy
│   │
│   ├── feishu/
│   │   └── 飞书 CLI Adapter
│   │
│   └── shared/
│
├── tools/
│   └── music-analyzer/
│       ├── pyproject.toml
│       ├── analyzer/
│       │   ├── audio.py
│       │   ├── rhythm.py
│       │   ├── tonal.py
│       │   └── energy.py
│       └── main.py
│
├── data/
│   ├── music/
│   ├── cache/
│   ├── analysis/
│   └── analyze-music.db
│
└── package.json
```

`data/` 不进入 Git。

---

# 5. 技术栈

## Web

```text
React
Vite
TypeScript
Arco Design
Zustand
TanStack Query
React Router
WaveSurfer.js
```

职责划分：

### Zustand

只管理客户端状态：

```text
当前筛选条件
当前选择歌曲
播放器状态
批量导入进度
UI状态
```

### TanStack Query

管理服务器状态：

```text
音乐列表
音乐详情
删除/编辑
分析任务
分页
缓存
刷新
```

不要把所有 API 数据都放 Zustand。

---

# 6. Node Service

推荐：

```text
Node.js
TypeScript
Fastify
Zod
Drizzle ORM
SQLite
execa
```

不建议 V1 上 NestJS。

当前项目是本地单体服务，Fastify 足够，而且比较容易控制：

```text
HTTP API
SSE
文件上传
本地进程
任务队列
```

Node Service 是系统真正的 orchestrator。

例如：

```text
用户点击「AI分析」
        ↓
Node 创建 AnalysisJob
        ↓
ffprobe
        ↓
Essentia
        ↓
Qwen3.5-Omni
        ↓
JSON 校验
        ↓
SQLite
        ↓
SSE 通知前端
```

---

# 7. 数据库

V1 使用：

```text
SQLite
+
Drizzle ORM
```

完全足够。

推荐表：

```text
music_tracks
music_analysis
music_segments
analysis_jobs
import_jobs
feishu_sync_records
app_settings
```

---

# 8. music_tracks

保存一首音乐的基础数据。

```text
id
title

original_filename
relative_path
managed_path

file_hash
file_size
format

duration
sample_rate
bit_rate
channels

bpm
key
mode

created_at
updated_at
```

使用 SHA-256：

```text
file_hash
```

用于判断重复音乐。

同一个文件再次导入时：

```text
hash exists
↓
跳过
```

---

# 9. music_analysis

AI分析结果。

建议不要把全部字段直接塞进 `music_tracks`。

```text
id
music_id

analysis_version
model
prompt_version

primary_emotion
secondary_emotions

valence
arousal
tension

narrative_functions

cinematic_styles
cinematic_score

scale
epicness
intimacy

instrumentation
textures

trajectory

dialogue_friendly
montage_friendly
beat_editability
loopability
ending_quality

recommended_scenes
not_recommended_scenes

summary

confidence

raw_ai_result

created_at
```

这样以后：

```text
Analyzer V1
Analyzer V2
Analyzer V3
```

都可以保留下来。

---

# 10. music_segments

这个表对以后自动剪辑很重要。

```text
id
music_id

start_time
end_time

type

energy
tension

description
```

例如：

```text
0.0   → 14.3     Intro
14.3  → 38.1     Theme
38.1  → 76.4     Build
76.4  → 103.2    Climax
103.2 → 130.8    Resolve
130.8 → 148.5    Outro
```

以后 Waveform 可以直接显示这些结构。

---

# 11. 音乐分类体系

不要设计成：

```text
悲伤
开心
紧张
```

而是按影视剪辑需求拆成六组。

---

## A. 情绪 Emotion

### Primary Emotion

固定枚举：

```text
Calm
Warm
Hopeful
Joyful
Romantic

Nostalgic
Melancholic
Sad
Lonely

Mysterious
Suspenseful
Tense
Dark
Oppressive

Powerful
Inspiring
Triumphant
Epic

Dreamy
Ethereal
Reflective
```

允许：

```text
primary_emotion = Nostalgic
```

以及：

```text
secondary_emotions = [
  Warm,
  Melancholic
]
```

---

## B. 三个连续情绪指标

### Valence

```text
-5 ---------------- 0 ---------------- +5

负面                                  正面
```

### Arousal

```text
1 ------------------------------- 10

平静                                激烈
```

### Tension

```text
1 ------------------------------- 10

松弛                                紧张
```

这三个值比单纯“悲伤/快乐”更有搜索价值。

---

# 12. Narrative Function

这是影视配乐中非常重要的一组。

固定标签：

```text
Opening
Atmosphere

Discovery
Wonder

Reflection
Memory
Connection
Romance

Build
Suspense
Tension

Conflict
Reveal
Loss

Climax
Triumph

Resolution
Ending
```

例如：

```text
Primary Emotion:
Sad

Narrative:
Memory
```

与：

```text
Primary Emotion:
Sad

Narrative:
Loss
```

剪辑用途完全不同。

---

# 13. Cinematic Style

建议固定：

```text
Minimal Cinematic
Emotional Cinematic
Ambient Cinematic

Orchestral Cinematic
Hybrid Cinematic

Epic Cinematic
Dark Cinematic
Suspense Cinematic

Documentary
Drama
Neo-Classical
Trailer
Soundscape
```

同时提供：

```text
cinematic_score: 1~10
```

代表：

> 整体具有多强的影视配乐感。

---

# 14. Cinematic Scale

单独做：

```text
scale: 1~10
```

大致理解：

```text
1                       10

私人                       史诗
极简                      大场景
Solo Piano               Trailer
人物独处                  战争大片
```

再单独提供：

```text
epicness
intimacy
```

避免：

> “有电影感” = “一定很史诗”

这种错误分类。

---

# 15. Instrumentation

固定标签：

```text
Piano
Strings
Violin
Cello

Brass
Woodwinds

Acoustic Guitar
Electric Guitar

Synth
Ambient Pad

Percussion
Drums

Bass
Choir

Sound Design
```

模型允许多选。

---

# 16. Texture

用于描述声音质感：

```text
Warm
Cold

Bright
Dark

Soft
Harsh

Organic
Synthetic

Intimate
Spacious

Minimal
Dense

Dreamy
Ethereal

Raw
Clean
```

例如：

```text
Piano
Strings

Warm
Intimate
Spacious
```

比简单写：

```text
钢琴曲
```

更适合选配乐。

---

# 17. Trajectory

表示整首音乐的发展模式。

固定枚举：

```text
Flat

Slow Build
Fast Build

Build → Climax

Build → Climax → Resolve

Wave

Multiple Peaks

Drop → Rebuild

Continuous Rise
Continuous Fall
```

这一项对剪辑尤其重要。

---

# 18. Cue Points

同时保存具体时间点：

```text
intro_end

theme_start

build_start

climax_start

peak_time

drop_time

outro_start
```

例如：

```text
Theme       00:14

Build       00:41

Climax      01:22

Peak        01:31

Outro       02:08
```

前端 Waveform 直接画 Marker。

---

# 19. 剪辑实用评分

AI另外输出五项：

```text
dialogue_friendly
montage_friendly
beat_editability
loopability
ending_quality
```

全部：

```text
1 ~ 10
```

### Dialogue Friendly

代表适不适合：

```text
采访
旁白
人物对白
```

### Montage Friendly

代表适不适合：

```text
旅行蒙太奇
产品 montage
城市 montage
成长 montage
```

### Beat Editability

代表：

> 是否容易卡点剪辑。

---

# 20. Scene Tags

生成：

```text
recommended_scenes
```

固定标签例如：

```text
人物独处
人物回忆
成长
爱情
分别

旅途
公路
城市空镜
自然风景

采访
纪录片
品牌片

发现
探索

调查
悬疑
危机

追逐
冲突
战争

胜利
结尾
```

同时可以保存：

```text
not_recommended_scenes
```

---

# 21. AI 分析方案

采用：

```text
确定性分析
+
AI语义分析
```

不要全部交给大模型猜。

---

## 第一层：Essentia

负责：

```text
BPM
Beat positions
Key
Scale
Loudness
Dynamic
Spectral
Onset
Rhythm
Tonal
```

Essentia 官方的 MusicExtractor 可以直接提取 spectral、time-domain、rhythm、tonal 等大量音乐 descriptor，其 Rhythm/Tonal 模块也直接覆盖 BPM、beat positions、key、scale 等信息。

Node 不直接运行复杂 DSP。

第一版采用：

```text
Node
 ↓
child_process
 ↓
Python CLI
 ↓
Essentia
 ↓
JSON stdout
```

例如：

```bash
python tools/music-analyzer/main.py \
  --input xxx.wav \
  --output json
```

得到：

```json
{
  "bpm": 78.4,
  "key": "D",
  "mode": "minor",
  "loudness": -16.3
}
```

V1 不需要长期运行 Python 服务。

---

# 22. 第二层：Qwen3.5-Omni

默认音乐 AI：

```text
Qwen3.5-Omni
```

百炼当前的 Qwen3.5-Omni 原生支持 Audio 输入，因此适合直接让模型听纯音乐；当前 Plus 型号文档也显示支持批量推理。

主要负责：

```text
Emotion

Narrative Function

Cinematic Style

Instrumentation

Texture

Dialogue Friendly

Montage Friendly

Recommended Scenes
```

不要让 Qwen 判断：

```text
BPM = ?
```

这种确定性信息。

---

# 23. 模型输出严格控制

Qwen 当前该型号没有原生 Structured Output，因此应用层必须自己校验。

流程：

```text
Qwen
 ↓
JSON Text
 ↓
extract JSON
 ↓
Zod.parse()
 ↓
失败？
 ├─ No → 保存
 │
 └─ Yes
      ↓
  repair prompt
      ↓
  retry
```

核心 Schema 放到：

```text
packages/music-domain
```

AI不允许自由创造标签。

---

# 24. GPT-4o 的定位

V1 不需要使用 GPT-4o。

标准 `gpt-4o` API 当前主要接受文本和图片输入，不是直接音频分析模型；OpenAI 另有专门的 audio model。

所以当前：

```text
Qwen = 听音乐

Essentia = 测音乐
```

已经足够。

后续可以让 GPT：

```text
Qwen结果
+
DSP结果
 ↓
GPT
 ↓
质量检查 / 标签二次校准
```

但不应该增加到 MVP。

---

# 25. 音乐管理页面

左侧：

```text
Analyze Music

音乐管理
```

目前只保留一个一级菜单。

以后可以扩展：

```text
音乐管理
分析任务
飞书同步
设置
```

---

# 26. 音乐管理顶部

建议布局：

```text
音乐管理

[搜索________________]

情绪 [全部]
Narrative [全部]
Cinematic [全部]
分析状态 [全部]

                         [导入音乐] [批量分析] [同步飞书]
```

---

# 27. 音乐列表

Arco Table：

```text
☐

名称

▶

时长

BPM

主情绪

Narrative

电影感

Trajectory

Climax

对白友好

AI状态

飞书状态

操作
```

例如：

```text
Remember Me

▶

02:36

76

怀旧

Memory

8.4

Build→Climax→Resolve

01:24

9

已完成

已同步
```

---

# 28. 行操作

每行：

```text
▶ 试听

查看

编辑

重新分析

同步飞书

删除
```

点击音乐进入 Drawer，而不是单独页面。

---

# 29. 音乐 Drawer

右侧打开：

```text
Remember Me.wav

▶ ━━━━━━━━━━━━━━━━━━━━━

     Build       Peak
       ↓           ↓
───────|───────────|────────

BPM
76

Key
D Minor

主情绪
怀旧

次情绪
温暖 / 忧伤

Narrative
Memory / Reflection

Cinematic
8 / 10

Dialogue Friendly
9 / 10

推荐：
人物回忆
纪录片
旅途

[编辑]

[重新分析]
```

Waveform 后面非常值得加。

---

# 30. 新增音乐

点击：

```text
[导入音乐]
```

弹出：

```text
导入音乐

[选择文件]

[选择文件夹]

支持：
MP3
WAV
FLAC
M4A
AAC
OGG
```

选择文件夹之后：

```text
扫描中...

发现 382 个文件

有效音乐       361

已存在          18

不支持           3
```

用户确认：

```text
[开始导入]
```

---

# 31. 本地文件夹选择需要特别处理

浏览器的 File System Access API 可以让用户通过 `showDirectoryPicker()` 选择本地目录并枚举其中的文件。

但纯 Web 前端获得的是浏览器的文件/目录 Handle，不应该把它当成 Node 可以永久保存的真实服务器路径。

因此我建议 V1 采用：

## Managed Import

```text
用户选择文件夹
      ↓
浏览器枚举文件
      ↓
发送到 localhost Node
      ↓
Node 写入：

data/music/
```

优点：

```text
可靠
简单
可以重新分析
播放器随时可读取
不用依赖浏览器权限
```

缺点：

```text
音乐会复制一份
```

---

# 32. V1.1 再增加 Reference Folder

用于大型已有音乐库：

```text
Reference Folder

/Volumes/Music/Cinematic
```

Node 直接索引：

```text
/Volumes/Music/Cinematic
```

而：

```text
不复制文件
```

这适合几百 GB 的现有音乐库。

所以最终系统支持两种：

```text
Managed
复制进系统

Reference
只保存文件路径
```

---

# 33. 批量新增设计

不要：

```text
一次 POST 500 个音乐文件
```

采用 Import Session。

API：

```text
POST /api/import-sessions
```

返回：

```json
{
  "id": "imp_001"
}
```

然后发送 manifest：

```text
POST /api/import-sessions/:id/manifest
```

内容：

```json
[
  {
    "clientId": "1",
    "name": "a.wav",
    "size": 28300124
  },
  {
    "clientId": "2",
    "name": "b.mp3",
    "size": 5300124
  }
]
```

服务器先：

```text
检查格式
检查重复
创建任务
```

再按文件上传。

---

# 34. 导入进度

前端应该展示两层进度。

## 总进度

```text
导入音乐

██████████████░░░░ 72%

234 / 324

已完成   230
处理中     4
失败       2
跳过      18
```

## 文件级

```text
✓ aaa.wav

✓ bbb.mp3

⟳ ccc.flac
   上传 63%

… ddd.wav

× eee.mp3
  文件损坏
```

---

# 35. SSE

批量任务进度推荐：

```text
Server-Sent Events
```

而不是轮询。

Node：

```text
GET /api/import-jobs/:id/events
```

发送：

```json
{
  "type": "progress",
  "completed": 124,
  "total": 300
}
```

前端：

```text
EventSource
 ↓
Zustand
 ↓
Progress UI
```

这里不需要 WebSocket。

因为进度主要是：

```text
Server → Browser
```

单方向。

---

# 36. Import Job 状态

```text
PENDING

SCANNING

IMPORTING

COMPLETED

PARTIAL_FAILED

FAILED
```

每个文件：

```text
PENDING

UPLOADING

IMPORTED

DUPLICATE

FAILED
```

注意：

> 导入 ≠ AI分析。

两者必须分开。

---

# 37. AI Analysis Job

音乐导入成功：

```text
IMPORT DONE
```

之后才能：

```text
ANALYZE
```

状态：

```text
QUEUED

EXTRACTING

AI_ANALYZING

VALIDATING

COMPLETED

FAILED
```

例如页面：

```text
Track 001     ✓ 完成

Track 002     AI分析中

Track 003     提取BPM

Track 004     等待

Track 005     失败
```

---

# 38. 为什么导入和分析分离

不要：

```text
导入
 ↓
强制等待AI
 ↓
才能看到音乐
```

应该：

```text
导入
 ↓
音乐立即进入数据库
 ↓
后台分析
```

因此用户很快就能看到：

```text
361首音乐已添加
```

即使：

```text
330首待AI分析
```

也没有问题。

---

# 39. 本地任务队列

V1 不建议 Redis + BullMQ。

增加 Redis 会让本地安装明显复杂。

使用 SQLite Job Queue：

```text
analysis_jobs
```

Node Worker：

```text
while running:

    获取 QUEUED Job

    ↓

    标记 PROCESSING

    ↓

    分析

    ↓

    COMPLETED / FAILED
```

限制并发：

```text
Essentia:
2~4

Qwen:
2~5
```

都放配置。

后面变服务器再换：

```text
BullMQ
Redis
```

---

# 40. API 设计

## Music

```text
GET
/api/music

GET
/api/music/:id

PATCH
/api/music/:id

DELETE
/api/music/:id
```

---

## Import

```text
POST
/api/import-sessions

POST
/api/import-sessions/:id/manifest

PUT
/api/import-sessions/:id/files/:fileId

GET
/api/import-sessions/:id

GET
/api/import-sessions/:id/events
```

---

## Analyze

```text
POST
/api/music/:id/analyze

POST
/api/music/batch-analyze

GET
/api/analysis-jobs

POST
/api/analysis-jobs/:id/retry
```

---

## Audio

```text
GET
/api/music/:id/audio

GET
/api/music/:id/waveform
```

必须支持：

```text
HTTP Range
```

否则播放时会很难正常 seek。

---

# 41. 搜索

第一版先做结构化筛选。

例如：

```text
Emotion:
Nostalgic

Narrative:
Memory

Cinematic:
>= 7

Dialogue:
>= 8

Trajectory:
Build → Climax
```

Node 转成 SQLite SQL。

---

# 42. V2 再做自然语言搜索

例如：

```text
“找一个适合人物回忆，
前面比较安静，
后面稍微有希望，
能压旁白的音乐。”
```

转换：

```text
emotion:
nostalgic

narrative:
memory

valence:
-2 ~ +2

dialogue:
>= 8

trajectory:
slow_build
```

不需要第一版就上向量数据库。

---

# 43. 飞书设计

飞书不作为主数据库。

关系：

```text
SQLite
   │
   │ Source of Truth
   │
   ▼
Node
   │
   ▼
Feishu Adapter
   │
   ▼
lark-cli
   │
   ▼
飞书多维表格
```

官方 Lark/Feishu CLI 当前已经覆盖 Base 的表、字段、记录、视图等核心能力，因此很适合作为第一版同步 Adapter。

---

# 44. Feishu Adapter

定义接口：

```ts
interface MusicExporter {
  createLibrary(): Promise<void>

  syncMusic(
    tracks: Music[]
  ): Promise<SyncResult>

  deleteMusic(
    trackId: string
  ): Promise<void>
}
```

实现：

```text
FeishuCliExporter
```

内部：

```text
Node
 ↓
execa
 ↓
lark-cli
```

以后可以：

```text
FeishuCliExporter

替换为

FeishuOpenApiExporter
```

业务代码完全不用改。

---

# 45. 飞书按钮

音乐管理右上：

```text
[飞书]
```

打开：

```text
飞书音乐库

状态：
未创建

[创建飞书多维表格]
```

创建以后：

```text
飞书音乐库

已连接

上次同步：
2026-08-10 15:05

本地：
382

飞书：
371

待新增：
8

待更新：
3

[同步到飞书]
```

---

# 46. 飞书表格字段

飞书不要输出内部所有数据。

只输出人类有价值的数据：

```text
Track ID

名称

时长

BPM

Key

主情绪

次情绪

Narrative

Cinematic Style

Cinematic Score

Scale

乐器

Texture

Trajectory

Build

Climax

Outro

Dialogue Friendly

Montage Friendly

推荐场景

AI描述

更新时间
```

大约 20～25 个字段。

不要同步：

```text
Embedding

Raw AI JSON

日志

模型内部数据

完整Energy Curve

Job

Cache
```

---

# 47. 飞书同步表

SQLite：

```text
feishu_sync_records
```

字段：

```text
music_id

base_token
table_id
record_id

local_updated_at

last_synced_at

sync_status
```

同步判断：

```text
local_updated_at
>
last_synced_at

↓

UPDATE
```

没有：

```text
record_id

↓

CREATE
```

---

# 48. 人工编辑必须优先于 AI

这是很重要的设计。

不要：

```text
AI重新分析
↓
覆盖人工标签
```

建议：

```text
AI Value

primary_emotion_ai
=
Sad


Human Override

primary_emotion_manual
=
Nostalgic
```

最终：

```text
effective value

manual ?? ai
```

UI：

```text
AI判断
Sad

人工修改
Nostalgic ✓
```

这样以后可以积累：

```text
AI预测
vs
人工判断
```

这批数据将来可以用于优化分类器。

---

# 49. 设置

虽然第一版左侧可以只展示：

```text
音乐管理
```

后台仍应该有 Settings 数据。

例如：

```text
Bailian API Key

Qwen Model

Analysis Concurrency

Music Storage Path

FFmpeg Path

Python Path

Feishu CLI Path

Feishu App
```

API Key 只能存在：

```text
Node 环境
```

不能发到 React。

---

# 50. Analysis Version

每次分析必须记录：

```text
analysis_version

model

prompt_version
```

例如：

```text
analysis_version:
1.2.0

model:
qwen3.5-omni-plus

prompt_version:
cinematic-v3
```

以后修改 Taxonomy 时：

```text
筛选：

analysis_version < 2

↓

批量重新分析
```

否则几千首音乐以后无法升级数据。

---

# 51. 推荐开发顺序

## Phase 1 — 基础工程

完成：

```text
Monorepo

React Admin

Node Service

SQLite

Music CRUD
```

验收：

```text
音乐管理页面正常运行

CRUD正常
```

---

## Phase 2 — 文件导入

完成：

```text
选择文件

选择文件夹

扫描

查重

批量上传

Import Job

SSE Progress
```

验收：

```text
一次导入 500 首

UI不卡死

有整体进度

单首失败不会导致整个任务失败
```

---

## Phase 3 — 音乐试听

完成：

```text
Audio Range

播放器

Waveform

音乐详情 Drawer
```

---

## Phase 4 — Essentia

完成：

```text
duration

BPM

key

mode

beat

loudness

energy
```

Essentia 官方已有面向大型音乐集合批处理的 MusicExtractor，可以作为这一阶段的基础。

---

## Phase 5 — AI

完成：

```text
Qwen3.5-Omni

Taxonomy

Zod Validation

Retry

Analysis Job
```

---

## Phase 6 — Cinematic

完成：

```text
Emotion

Narrative

Cinematic

Texture

Trajectory

Dialogue Friendly

Scene Tags
```

---

## Phase 7 — Cue Point

完成：

```text
Intro

Build

Climax

Peak

Drop

Outro
```

显示到：

```text
Waveform
```

---

## Phase 8 — 飞书

完成：

```text
Feishu Adapter

lark-cli

创建表

创建字段

新增记录

更新记录

增量同步
```

---

# 52. MVP 最终体验

用户打开：

```text
http://localhost:5173
```

看到：

```text
Cinematic Music Library

音乐：0
```

点击：

```text
导入音乐
```

选择：

```text
/MyMusic/Cinematic/
```

系统：

```text
扫描...

发现 682 首音乐

重复 21

准备导入 661
```

点击：

```text
开始
```

显示：

```text
████████████░░░░░ 63%

416 / 661
```

导入完成：

```text
661 首已添加

[开始AI分析]
```

后台：

```text
FFmpeg
 ↓
Essentia
 ↓
Qwen
```

页面逐渐出现：

```text
Track             Emotion    Narrative   Cinematic

Remember          Nostalgic  Memory      8.6

Journey           Hopeful    Build       7.9

Dark Room         Tense      Suspense    9.1
```

然后用户筛选：

```text
Narrative:
Memory

Cinematic:
>= 8

Dialogue:
>= 8
```

得到：

```text
23首
```

试听：

```text
▶ Remember
▶ Home
▶ Last Summer
```

最后：

```text
[创建飞书音乐库]
```

系统自动同步。

---

# 53. 第一版最终技术选型

建议锁定：

```text
Monorepo
现有 monorepo-template

Frontend
React
Vite
TypeScript
Arco Design
Zustand
TanStack Query

Backend
Node.js
Fastify
Zod
Drizzle ORM

Database
SQLite

Jobs
SQLite Job Queue
SSE

Audio
FFmpeg
ffprobe
Essentia

DSP Runtime
Python CLI

AI
Qwen3.5-Omni

Feishu
lark-cli

Storage
Local Filesystem
```

---

# 54. 最重要的几个架构决定

第一：

```text
SQLite 是真实数据库

飞书只是输出端
```

第二：

```text
导入
和
AI分析

必须分成两个 Job
```

第三：

```text
能计算的音乐数据
→ Essentia

需要理解的音乐数据
→ Qwen
```

第四：

```text
AI只能选择固定 Taxonomy

不能自由发明标签
```

第五：

```text
人工修改永远优先于 AI
```

第六：

```text
所有 AI 结果都有 version
```

第七：

```text
先做结构化筛选

后做向量搜索
```

按照这个边界实现，V1 不会过度复杂，但数据库、AI 分析和 UI 结构都能直接支撑后面的“相似音乐”“自然语言找配乐”“视频自动推荐音乐”。
