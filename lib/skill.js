/**
 * dsh-keil-ide — the `keil-stm32-project` Skill (Node/host half).
 *
 * A short workflow guide so an Agent knows WHEN and HOW to use the
 * `keil_project` tool, instead of hand-editing uvprojx XML.
 */
export const SKILL_NAME = 'keil-stm32-project';

const CONTENT = `# Keil / STM32 工程（uvprojx）工作流

给 Keil MDK 工程新增代码模块时，**不要手工编辑 \`.uvprojx\`**（它是 XML，格式敏感，极易改坏）。
用 \`keil_project\` 工具，它会同时完成「建文件」和「挂进工程分组」。

## 新增一个模块（最常见）

1. 先想清楚文件放哪个目录、对应哪个分组。约定：**目录名即分组名**。
   例如 GPIO 模块放 \`Hardware/gpio.c\` 与 \`Hardware/gpio.h\` → 归入 \`Hardware\` 分组
   （已存在就复用，不存在就自动新建）。
2. 调一次工具，把内容一起写进去：

   \`\`\`
   keil_project({
     action: "add",
     file: "Hardware/gpio.c",
     content: "<完整的 C 源码>"
   })
   \`\`\`

   一般还需要配套的头文件，再调一次：

   \`\`\`
   keil_project({ action: "add", file: "Hardware/gpio.h", content: "<头文件内容>" })
   \`\`\`

3. 若要放进**已有分组**（例如统一放 \`User\`），显式传 \`group: "User"\`。

## 工程是怎么定位的（先看这个，别改错工程）

按优先级：

1. **显式传 \`project\`** —— 永远最高，是唯一确定性入口。
2. **会话工作区**：在会话工作目录（cwd）下自动发现 \`.uvprojx\`
   - 恰好 1 个 → 自动绑定
   - 多个 → 返回候选清单，**不替你猜**，请用 \`project\` 指定其中一个
   - 0 个 → 明确报"本工作区未发现 Keil 工程"，**绝不会静默用别的工程的**
3. **本工作区上次的绑定**（跨重启保留）
4. **IDE 面板打开过、且位于本工作区内的工程**

每次返回都带 \`project\` 和 \`projectSource\`（\`explicit\` / \`workspace\` / \`panel\` / \`hint\`），
\`message\` 第一行也写明工程名与来源。**动手改之前先确认来源是不是你以为的那个工程。**

> 绑定只决定"改哪个工程"。如果**会话工作区和工程目录不是同一个**，
> 通用 \`read\`/\`write\`/\`edit\` 仍会被沙箱挡住（而本工具走宿主进程、不受影响）。
> 建议把会话工作区直接设成工程目录本身，两条链就一致了。

**IDE 面板会自动跟随会话工作区**：点开面板即自动载入该工作区的工程——恰好 1 个直接载入，
多个给候选列表让用户选（选过就记住），0 个显示"本工作区未发现 Keil 工程"并保留手动入口。
所以用户说"给这个工程加个模块"时，通常不必追问工程路径：先 \`action: "info"\` 确认来源即可。

## 其它动作

| action | 用途 |
|---|---|
| \`info\` | 工程概览：芯片、调试器、Target、分组、文件数、**Include / Define** |
| \`list\` | 列出分组与文件，每条带 FileType；与扩展名不符会标 ⚠ 并给出建议值 |
| \`link\` | 只把**已经存在**的文件挂进工程，不写文件 |
| \`remove\` | \`add\` 的逆操作：摘掉工程条目，**默认不删磁盘文件**（要删传 \`deleteFile: true\`） |
| \`repair\` | 修复工程：文件类型按扩展名纠正、工程用到的目录补进 include 路径 |
| \`build\` | 编译（UV4 \`-b\`），返回错误/警告与 \`Program Size\`；\`force: true\` 等价于全量重编 |
| \`rebuild\` | 全量重编（UV4 \`-r\`）——**想确认新模块真的参与编译时用它**，避免增量跳过 |
| \`clean\` | 清理中间产物（UV4 \`-c\`） |
| \`flash\` | 用工程里配好的调试器（如 ST-Link）烧录到芯片 |

### \`add\` 的三种结果（看返回字段，别只看一句话）

| 情况 | message | \`contentWritten\` | \`entryExisted\` |
|---|---|---|---|
| 新建文件 + 挂进工程 | 已加入工程：… | true | false |
| 条目已在，且这次传了 \`content\` | 内容已写入 …；工程条目已存在 | true | true |
| 条目已在，且没传 \`content\` | 内容未改写（未提供 content）…；工程条目已存在 | false | true |

条目已存在但 FileType 不对时，\`add\` 会**就地自愈**并返回 \`fileTypeFixed: {from,to}\`——
所以修完 Bug 1 之后只要重跑一次 \`add\` 即可，不用手工删条目重来。

## 已知的坑（不必重复踩）

- **\`.h\` 的 FileType 必须是 5**。写成 8 会让 UV4 把头文件当源文件编译，报
  \`C4065E: type of input file '…h' unknown\`。8 是 C++ 源文件的类型。
- **uvprojx 里有 3 个 \`<IncludePath>\`**，真正生效的只有
  \`TargetArmAds > Cads > VariousControls\` 里那个；\`<TargetOption>\` 下那个是空的，
  \`<Aads>\` 下那个是给汇编用的。\`add\` 会自动把新文件的顶层目录追加进去，
  \`remove\` 在目录不再被引用时会对称地摘掉它。
- 工程若被旧版本改坏（头文件类型写成 8、缺 include 路径）导致编译不过，
  跑一次 \`action: "repair"\` 就能修好——它是纯增量的，不动分组与文件顺序。
- \`remove\` **不会折叠空分组**（摘光一个分组的文件后分组仍在），这是刻意的，
  避免静默改变工程结构。
- \`build\` 是增量：\`-b\` 在"工程已是最新"时会直接跳过编译。要确认新模块真的参与编译，
  用 \`rebuild\`，不要靠改写源文件去刷 mtime。

## 约定

- 不传 \`project\` 就用 **IDE 面板里当前打开的工程**；不确定时先 \`action: "info"\` 确认。
- 路径可写相对工程目录（\`Hardware/gpio.c\`）或绝对路径。
- 写完文件可以用编辑器打开检查；再次 \`add\` 同一个文件是安全的（会提示已在工程中）。
- 编译报错时读 \`build\` 返回的 \`issues\`（含 \`文件(行号)\`），直接改对应位置后重新 \`build\`。
`;

/**
 * Register the skill on the host context. The `skills` service is a soft
 * dependency: absent, the plugin still works, just without the guide.
 */
export function installSkill(ctx) {
  if (!ctx || typeof ctx.inject !== 'function') return;
  ctx.inject(['skills'], (scoped) => {
    const skills = (scoped && scoped.skills) || (typeof scoped.get === 'function' ? scoped.get('skills') : null);
    if (!skills || typeof skills.register !== 'function') return;
    scoped.effect(() => {
      const dispose = skills.register({
        name: SKILL_NAME,
        // The catalog only shows this summary, and the model decides from it
        // whether to load the body — so it is written with the words a user
        // would actually type about an STM32 project.
        description: '用 keil_project 工具操作 Keil MDK / STM32 的 uvprojx 工程：新建或挂载 .c/.h 源文件'
          + '（GPIO、USART 串口、TIM 定时器、PWM、ADC、I2C、SPI、EXTI 外部中断、OLED 等外设初始化与驱动），'
          + '按目录自动归入工程分组、维护 include 路径、编译 / 全量重编 / 清理、烧录下载到芯片、'
          + '把标准库设为只读防手滑。不要手工编辑 .uvprojx。'
          + ' — Keil MDK / STM32 (uvprojx) project work with the keil_project tool: create or link'
          + ' .c/.h peripheral modules (GPIO, USART, TIM, PWM, ADC, I2C, SPI, EXTI, OLED), file them into'
          + ' project groups by directory, keep the C include path correct, build / rebuild / clean,'
          + ' flash to the chip, and lock standard-library files read-only. Never hand-edit the .uvprojx.',
        whenToUse: '当用户提出下列任一要求时：给 STM32 / Keil 工程加一个模块或文件、写外设驱动或初始化代码、'
          + '把文件挂进工程、编译或重新编译、烧录 / 下载到单片机、'
          + '修「编译不过 / 找不到头文件 gpio.h / C4065E」这类工程问题，'
          + '或任何需要让代码进入 Keil µVision 工程的场合。'
          + ' — Use when the user asks to add a module or file to an STM32 / Keil project, write'
          + ' peripheral or init code, link a file into the project, build or rebuild it, flash or'
          + ' download it to the chip, or fix a build failure such as a missing gpio.h or C4065E.',
        content: CONTENT,
        source: 'dsh-keil-ide',
      });
      return () => { try { dispose(); } catch { /* ignore */ } };
    }, 'dsh-ide: keil skill');
  });
}
