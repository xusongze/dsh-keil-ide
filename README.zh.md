# dsh-keil-ide

**DeepSeek Harness 的 Keil MDK / STM32 IDE 模式。**

一个用于浏览和编辑 `.c` / `.h` 的侧边面板，外加一个 **`keil_project` 工具**和一个**技能**，
让 Agent 能新建外设模块（GPIO、USART 串口、TIM 定时器、PWM、ADC、I²C、SPI、EXTI 中断、
OLED 驱动……）、挂进 `uvprojx` 工程、用 UV4 编译、并烧录到芯片。

> English docs: [README.md](README.md)

---

## 为什么需要它

让 Agent「加一个 GPIO 初始化文件」，通常你只会得到磁盘上的一个文件，而 Keil 工程根本不知道它存在——
于是编译报 `cannot open source input file "gpio.h"`，或者 UV4 把 `.h` 当源文件去编译（`C4065E`）。
手工改 `.uvprojx` XML 正是把工程改坏的方式。

这个插件把**工程本身**变成一等对象：Agent 建文件的同时写入 `<File>` 条目、维护 C 语言 include 路径，
然后直接编译、烧录——全程不需要任何人碰 XML。

---

## 功能

### 面板（客户端）

| | |
|---|---|
| **两种位置** | 从左侧边栏 **IDE** 进入的全宽面板，或与对话并排的右侧停靠面板（输入框的 **IDE** 开关）。 |
| **两种浏览模式** | *目录*模式浏览任意文件夹；*工程*模式解析 `uvprojx`，分组可折叠（`Start`、`Library`、`System`、`User`……）并显示每组文件数。 |
| **编辑器** | 基于 DSH 的 Shiki 主题令牌做语法高亮、行号、错误跳转、可调字体与字号（10–26px，会记住）。 |
| **只读保护** | 磁盘上标为只读的文件在树里显示琥珀色锁形角标；编辑器进入只读态，保存被拒——**两层**：面板一次、宿主再一次。点分组头的锁即可一键保护整个标准库分组。 |
| **状态弹窗** | 左下角从左侧滑入的提示，用于只读变更、保存被拦等状态更新。 |
| **自动绑定** | 面板跟随**会话工作区**：打开即自动载入该工作区的 Keil 工程。恰好 1 个 → 直接载入；多个 → 列表选择（按工作区记住）；0 个 → 明确显示「本工作区未发现 Keil 工程」，**绝不**回落到别的目录。 |
| **编译输出** | UV4 日志、错误/警告计数、`Program Size`，以及可点击跳转到出错行的错误列表。 |

### 工具（宿主侧，Agent 可见）

`keil_project`，支持这些 action：

| action | 作用 |
|---|---|
| `info` | 工程概览：芯片、调试器、Target、分组、文件数、**Include / Define**。 |
| `list` | 列出分组与文件及各自 `FileType`；与扩展名矛盾的条目标 ⚠。 |
| `add` | 新建（或写入）`.c`/`.h` **并**挂进工程分组。分组按文件所在目录自动匹配，没有就新建；同时维护 include 路径。 |
| `link` | 把已有文件挂进工程，不写文件。 |
| `remove` | `add` 的逆操作：摘掉工程条目（磁盘文件默认保留，除非传 `deleteFile: true`），并在无人引用时摘掉 include 路径。 |
| `repair` | 修复旧版本改坏的工程：按扩展名纠正所有 `FileType`，把工程用到的目录补进 include 路径。 |
| `build` | UV4 `-b`（增量）。`force: true` 等价 `-r`。 |
| `rebuild` | UV4 `-r`——想确认新模块真的参与编译就用它。 |
| `clean` | UV4 `-c`。 |
| `flash` | UV4 `-f`，用工程里配好的调试器（如 ST-Link）。 |

工程定位优先级如下，且每次返回都带上来源（`projectSource`）：

1. 显式传入的 `project` 参数——永远最高；
2. **会话工作区**（自动发现，深度 ≤4，跳过构建产物目录）；
3. 该工作区上次记住的绑定；
4. IDE 面板打开过、且**位于**该工作区内的工程。

工作区里没有 Keil 工程时会明确报出来，而不是悄悄去改别的工程。

### 技能

`keil-stm32-project`——Agent 按需加载的工作流说明：何时用工具、目录→分组的约定，
以及那些不必重复踩的坑（`.h` 必须是 `FileType` 5；`uvprojx` 里有三个 `<IncludePath>`，
只有 `Cads > VariousControls` 那个生效；`build` 是增量的，验证要用 `rebuild`）。

### 附带

- 面向纯 C 练习的**单文件 GCC 轻量编译**（非工程模式）。
- 边栏底部的**重启**控制。

---

## 环境要求

- **Windows**（Keil 层）——`UV4.exe` 仅 Windows。其余部分（浏览、编辑、只读、面板）跨平台可用，
  Keil 类操作会给出清晰错误而不是崩溃。
- **Keil MDK 5**。通过 `HKLM\SOFTWARE\WOW6432Node\Keil\Products\MDK` 检测，其次查常见安装路径。
- `flash` 需要工程里已配置调试器（ST-Link、J-Link 等）。
- **Node 20+**，以及 DeepSeek Harness。
- MDK-Lite 的 32KB 限制影响链接步骤，不影响烧录。

---

## 安装

DSH 插件本质上是某个 **profile** `node_modules` 里的包，并在该 profile 的 `package.json`
的 `dsh.profile.bundles` 里声明。profile 位于 `~/.dsh/profiles/<profile名>`
（桌面版用 `desktop`）。

### 从 GitHub 安装（无需 npm 账号）

```bash
cd ~/.dsh/profiles/desktop
npm install github:xusongze/dsh-keil-ide
```

需要锁版本的话：

```bash
npm install github:xusongze/dsh-keil-ide#v1.0.0
```

然后把包名加进该 profile 的 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-keil-ide"
      ]
    }
  }
}
```

**在 `bundles` 里声明了却没安装，DSH 会拒绝启动**，所以这两处必须一致。
之后**重启 DeepSeek Harness**——客户端包只在启动时加载。

### 从 npm 安装

```bash
cd ~/.dsh/profiles/desktop
npm install dsh-keil-ide
```

同样要改 `dsh.profile.bundles`。发到 npm 也会让插件出现在 **DSH 插件市场**里
（插件市场是从 npm registry 解析插件的）。

### 手动复制

```bash
git clone https://github.com/xusongze/dsh-keil-ide.git
cp -r dsh-keil-ide ~/.dsh/profiles/desktop/node_modules/dsh-keil-ide
```

然后把 `"dsh-keil-ide"` 加进 `dsh.profile.bundles`。

### 验证

重启后：边栏出现 **IDE** 入口、输入框出现 **IDE** 开关、Agent 的工具列表里出现 `keil_project`。

---

## 使用

### 在面板里

1. 点开 **IDE** 入口（或右侧停靠面板）——面板会绑定到你的会话工作区。
2. 用*目录*模式浏览，或让它在*工程*模式载入工作区里的 `uvprojx`。
3. 编辑后 `Ctrl+S` 保存；工程的 **编译 / 烧录** 按钮在工具栏；底部错误列表可点击跳转。
4. 保护标准库：展开某个分组，点分组头的锁——整组变为只读并显示角标。

### 从对话里

直接描述任务即可：

> 给 led 工程加一个 GPIO 模块，用 PA0 控制 LED，然后编译烧录。

Agent 会调 `keil_project`：先 `add` `Hardware/gpio.c` 与 `Hardware/gpio.h`
（自动新建 `Hardware` 分组、自动修好 include 路径），再 `build`，再 `flash`。

**最顺的用法是让对话的工作区就是工程目录**（或其祖先目录）；否则显式给出 `.uvprojx` 路径。

---

## 配置

| 环境变量 | 作用 |
|---|---|
| `DSH_IDE_ALLOW_REMOTE=1` | 完全关闭本地来源门禁，用于局域网 / 远程 DSH。 |
| `DSH_IDE_ALLOWED_HOSTS=a.local,b.internal` | 在保留其余门禁的前提下，额外允许某些（经本地代理的）`Host` 名。 |

其余状态在 `~/.dsh/dsh-ide-project.json`（工作区 → 工程绑定）以及面板自身的开关里
（字体、分组折叠、每个工作区选过的工程）。

---

## 安全

本插件会读写、编译、烧录**本地文件**，因此它的 HTTP 路由有多重门禁：

1. **仅回环来源**——非回环 `remoteAddress` 一律拒绝；带 `Forwarded` / `X-Forwarded-For` /
   `X-Real-IP` 的请求同样拒绝。
2. **仅回环 `Host`**——这是防 **DNS rebinding** 的那一道：恶意域名解析到 `127.0.0.1` 后，
攻击页面与本服务变成**同源**，同源请求**不发 CORS 预检**，`Content-Type` 检查在这条路上无效，
只有 `Host` 能拦。
3. **带 body 的请求必须是 JSON `Content-Type`**——这会为普通跨站 POST 强制一次 CORS 预检。

`flash` 与 `build` 会启动 `UV4.exe`，即用本地程序执行本地工程文件——与你自己在 Keil 里点编译等价。

---

## 开发

纯 ESM 包，无构建步骤：

```
lib/index.js      宿主侧：HTTP 路由、工程/工具/技能接线
lib/project.js    uvprojx 解析 + 定向文本编辑（从不整体重排）
lib/keil.js       UV4.exe 检测、spawn、编译日志解析
lib/tool.js       keil_project 工具定义与执行
lib/skill.js      工作流技能
lib/util.js       fs/exec 助手、只读属性
client/client.js  整个浏览器侧（面板、编辑器、文件树、弹窗）
```

测试会在临时目录里跑一份真实 Keil 工程的副本：

```bash
node test-ide-keil.mjs      # uvprojx 解析/编辑、include 路径、日志解析
node test-ide-tool.mjs      # 工具动作、分组匹配、注册接线
node test-ide-client.mjs    # 客户端包、词法着色、会话工作区桥接
node test-ide-host.mjs      # HTTP 路由
node test-ide-binding.mjs   # 工作区 → 工程 解析（7 个场景）
node test-ide-workspace.mjs # 面板自动载入验收
node test-ide-readonly.mjs  # 只读属性与拦截
```

测试默认指向 `C:/Users/.../stm32project/led/Project.uvprojx` 作 fixture 并规范化其副本；
换成你自己的工程请改各文件里的 `src` 常量。

---

## 许可证

MIT — 见 [LICENSE](LICENSE)。
