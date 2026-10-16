# 维护手册 / Maintaining

> 这份文档主要写给本仓库的维护者（中文）。所有命令都可以直接复制运行。

---

## 一、先搞清楚"三份东西"的关系

这是最容易搞混的地方。你的插件实际上存在**三个位置**：

```
① 本地仓库            C:\Users\33549\Documents\deepseek-harness\default-workspace\dsh-keil-ide\
   └─ 带 .git，是我改代码、提交历史的地方。改这里【不会】影响运行中的 DSH。

② 线上仓库            https://github.com/xusongze/dsh-keil-ide
   └─ 别人看代码、下载、提 issue 的地方。和 ① 用 push/pull 同步。

③ 运行中的插件        C:\Users\33549\.dsh\profiles\desktop\node_modules\dsh-keil-ide\
   └─ DSH 启动时【真正加载】的就是这一份。是 ① 的副本。
```

**数据流向：**

```
改 ①  →  node scripts/deploy-local.mjs  →  更新 ③  →  重启 DSH  →  生效
  ↓
git push  →  更新 ②
```

**两条独立的动作，缺一不可：**
- 只 `deploy` 不 `push`：你自己能用了，但 GitHub 上还是旧代码
- 只 `push` 不 `deploy`：GitHub 更新了，但你的 DSH 还跑着旧版本

---

## 二、日常维护：推荐让别人（AI）做

你不需要记住 git。**直接说需求就行**，比如：

> 「给插件加一个功能：xxx，做完测试、提交、推送、部署」

我会完成：改代码 → 跑 9 套测试 → `git commit` → `git push` → `npm run deploy`，然后告诉你**重启 DSH**。

---

## 三、你要会的最小 git 操作（5 条）

打开 PowerShell，`cd` 到本地仓库：

```powershell
cd C:\Users\33549\Documents\deepseek-harness\default-workspace\dsh-keil-ide
```

| 我想干什么 | 命令 |
|---|---|
| 看当前状态（改了什么、有没有没提交的） | `git status` |
| 看提交历史 | `git log --oneline` |
| 把改动记进本地仓库 | `git add -A` 然后 `git commit -m "说明你改了什么"` |
| 上传到 GitHub | `git push` |
| 把 GitHub 上的改动拉下来 | `git pull` |

**完整的一次发布流程**（改完代码之后）：

```powershell
# 0. 先跑测试，全绿才继续
node test/run-all.mjs

# 1. 让 DSH 用上新代码（本地生效）
node scripts/deploy-local.mjs

# 2. 记录到本地仓库
git add -A
git commit -m "feat: 新增 xxx 功能"

# 3. 上传到 GitHub
git push

# 4. 重启 DeepSeek Harness  ← 别忘了这步，否则插件没变
```

> 如果只是改了 **README / CHANGELOG** 这类文档，可以跳过第 1 步和第 4 步。

---

## 四、改版本号发新版（可选）

只用在你希望别人能装到"新版本"时：

1. 改 `package.json` 里的 `"version": "1.0.0"` → 比如 `1.1.0`
2. 在 `CHANGELOG.md` 顶部加一节说明改了什么
3. 然后：

```powershell
git add -A
git commit -m "release: v1.1.0"
git tag -a v1.1.0 -m "dsh-keil-ide 1.1.0"
git push
git push origin v1.1.0
```

别人就能用固定版本安装：

```powershell
npm install github:xusongze/dsh-keil-ide#v1.1.0
```

> 版本号含义（语义化版本）：`1.1.0`
> 第一位 = 不兼容的大改；第二位 = 新增功能；第三位 = 修 bug。

---

## 五、常见问题

### 1. `git push` 报 `Connection closed ... port 22`

**原因**：你开着代理（VPN），代理的 TUN 模式把 `github.com` 解析成假 IP，22 端口不通。

**已修复**：`C:\Users\33549\.ssh\config` 里已配置 GitHub 走 **443** 端口，代理开不开都能推。
如果哪天又出现，检查这个文件是否存在且内容为：

```
Host github.com
  HostName ssh.github.com
  Port 443
  User git
```

### 2. 验证 SSH 是否正常

```powershell
ssh -T git@github.com
```

看到 `Hi xusongze! You've successfully authenticated` 就是正常。
（它会以"错误码 1"结束，这是 GitHub 的正常行为，不是失败。）

### 3. 改了代码但插件没变化

按顺序检查：

1. 跑过 `node scripts/deploy-local.mjs` 了吗？
2. **重启 DSH 了吗？** 插件只在启动时加载，改完必须重启。
3. 重启后确认：边栏有 **IDE** 入口、输入框有 **IDE** 开关、工具列表有 `keil_project`。

### 4. `git push` 被拒绝（`rejected` / `non-fast-forward`）

说明 GitHub 上有你本地没有的提交（比如你在网页上直接改过文件）。先拉下来再推：

```powershell
git pull --rebase
git push
```

### 5. 想在网页上直接改（比如改一个字）

可以。GitHub 网页编辑 → 提交后，本地需要 `git pull` 一次才能同步。

---

## 六、仓库里各文件是干什么的

| 路径 | 作用 |
|---|---|
| `lib/index.js` | 宿主侧主入口：注册 HTTP 路由、接线工具与技能 |
| `lib/project.js` | `uvprojx` 解析与**定向文本编辑**（从不整体重排 XML） |
| `lib/keil.js` | 检测 `UV4.exe`、启动编译/烧录、解析编译日志 |
| `lib/tool.js` | `keil_project` 工具的定义与执行逻辑 |
| `lib/skill.js` | 给 Agent 的工作流技能 |
| `lib/util.js` | 文件/进程助手、只读属性读写 |
| `client/client.js` | **整个浏览器侧**（面板、编辑器、文件树、弹窗） |
| `test/` | 9 套回归测试，`node test/run-all.mjs` 一次跑完 |
| `scripts/deploy-local.mjs` | 把仓库同步到本机 DSH profile |

**改哪里的提示**：
- 改界面、按钮、颜色、动画 → `client/client.js`
- 改 Agent 能用的能力 → `lib/tool.js`
- 改工程解析规则 → `lib/project.js`
- 改编译/烧录行为 → `lib/keil.js`

**改完一定要跑测试**，尤其动了 `lib/project.js` 或 `lib/tool.js` —— 它们直接改用户的工程文件。
