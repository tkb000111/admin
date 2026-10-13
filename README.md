# 通用后台管理脚手架

用于后续后台管理系统开发的 Spring Boot + Vue 底座。包含认证、菜单与按钮权限、数据权限、组织管理、字典、参数、日志、工作台和代码生成骨架；新增项目在此基础上实现业务模块。

## 开发入口

- [项目地图](PROJECT_MAP.md)：按功能定位页面、接口、服务、SQL 和权限。
- [设计规范](DESIGN.md)：珍珠玻璃主题、组件复用及交互规范。
- [开发约定](AGENTS.md)、[更新日志](changelog.md)。
- [后端架构](docs/backend-architecture.md)、[前后端接口约定](docs/frontend-backend-integration.md)、[前端架构](docs/admin-redesign-architecture.md)。

## 目录与技术栈

| 目录 | 用途 | 技术栈 |
| --- | --- | --- |
| `scaffold-system` | 后端 Maven 多模块工程 | Java 17+、Spring Boot 3.5、MyBatis、MySQL、Redis、JWT |
| `scaffold-vue` | 管理后台 | Vue 3、TypeScript、Vite 6、Vue Router 4、GSAP 3，自有组件库 |
| `scaffold-system/sql` | 首次初始化脚本 | `V1__init_schema.sql` 建表，`V2__seed_data.sql` 初始化数据 |
| `docs` | 当前架构说明 | 后端架构、前后端接口约定和前端组件架构 |

当前包含工作台和 10 个管理页面；建筑、工作流模块已移除。

## 本地启动

准备 JDK 17 或更新版本、Maven、Node.js 22+、MySQL 5.7+ 和 Redis；前后端依赖均使用项目现有配置。

后端读取进程环境变量，不会自动加载 `.env` 文件；可在 IDE 运行配置或启动终端中设置：

| 变量 | 中文说明 | 默认值 |
| --- | --- | --- |
| `JWT_SECRET` | JWT 签名密钥，至少 32 字节且不能全为空白 | 必填，无默认值 |
| `DB_HOST` / `DB_PORT` | MySQL 地址 / 端口 | `localhost` / `3306` |
| `DB_NAME` | 数据库名称 | `scaffold_system` |
| `DB_USERNAME` / `DB_PASSWORD` | 数据库账号 / 密码 | 本地开发默认账号；按实际环境配置 |
| `DB_TIMEZONE` | 数据库连接与会话时区 | `+08:00` |
| `REDIS_HOST` / `REDIS_PORT` | Redis 地址 / 端口 | `localhost` / `6379` |
| `REDIS_PASSWORD` | Redis 密码 | 空；按实际环境配置 |
| `VITE_API_PROXY_TARGET` | 前端开发代理的后端地址 | `http://localhost:8080` |

可在启动后端的终端中生成本机密钥；生成结果保留在当前进程环境，不写入仓库：

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
```

使用 IDE 时将密钥配置到运行环境。未配置或不足 32 字节时后端启动失败；保留同一密钥可让重启前的有效 token 继续验签，更换密钥会使旧 token 失效。

首次创建空的 `scaffold_system` 库后，按顺序导入两份 SQL；mysql 客户端须使用 `--default-character-set=utf8mb4`，并通过 `--init-command="SET time_zone='+08:00'"` 设置会话时区。也可在 IDE 运行 `scaffold-admin` 中的 `com.scaffold.admin.util.DbInit`，该工具使用同一组 `DB_*` 变量并按版本顺序初始化；参数 `fix` 会删除整个目标库，仅在核实库名、备份且明确同意重建时使用。

```bash
# 在 scaffold-system 目录构建与启动后端
mvn -pl scaffold-admin -am package -DskipTests
java -jar scaffold-admin/target/scaffold-admin-0.1.0-SNAPSHOT.jar
```

```bash
# 在 scaffold-vue 目录启动前端；首次使用先 npm ci
npm run dev
```

浏览器访问 `http://localhost:5173`，后端本地端口为 `8080`；前端统一通过 `/api` 代理访问后端。

种子库管理员为 `admin`，开发密码为 `admin123`；仅用于本地开发，接入实际环境前请修改密码并配置自己的数据库与 Redis 凭据。种子组织和用户为示例，电话留空，邮箱使用 `example.com`。验证码使用页面显示的字符。超级管理员可见全部启用且可见的已注册菜单，并拥有全部操作权限；其余种子角色默认未授予菜单，需在角色管理中分配。无可用菜单的账号登录后显示“暂未分配可用菜单”。

### 开发模式（后端保存即重启）

日常迭代用 `./启动.sh 开发`：以 `spring-boot:run` 启动开发后端（默认 `18085`，被占自动顺延），已启用 devtools，**不打包、不经网关**。

```bash
./启动.sh 开发        # 终端一：开发后端（首次编译全部模块，约一分钟）
# 改完 Java 代码后（任何模块），在 scaffold-system 目录执行：
mvn -pl scaffold-admin -am compile -q     # 增量数秒，触发自动重启
# 终端二：前端 dev server（HMR，即改即见）
VITE_API_PROXY_TARGET=http://localhost:18085 npm run dev
```

后端访问 `http://localhost:<开发端口>`，前端访问 `http://localhost:5173`。devtools 仅在开发模式生效，打成 jar 运行（含 `./启动.sh` 与桌面版）时自动关闭。发布前仍按上方正式流程打包并跑测试。

手机 / 局域网联调：`VITE_API_PROXY_TARGET=http://localhost:18085 npm run dev:lan`（前端监听全网卡），同一 Wi-Fi 下设备访问 `http://<本机局域网IP>:5173`；接口仍由 dev server 统一代理，后端无需额外对局域网开放。

## 新业务模块

往基座里加东西有两种姿势，走**完全相同的登记链路**（菜单表一条数据 + `src/composables/auth.ts` 的 `PAGE_MAP` 一条登记 + 权限码），区别只是插在菜单树的哪一层；导航功能列、标签缓存、命令面板与权限显隐自动生效，外壳代码零改动。

**方式 A：插入独立功能**（一个新的业务系统，与「后台管理」平级）

1. 在菜单管理页（或 SQL）插一个顶级目录（`dir` 类型），配图标与排序。
2. 把该目录授权给相应角色（`sys_role_menu`）——未授权的角色在功能列里看不到它。
3. 其下按方式 B 挂模块，其余链路完全一致。

**方式 B：插入模块**（挂进某个已有功能）

1. 先设计业务表与中文字段含义；默认包含 `create_by`、`update_by`、`create_time`、`update_time` 四个审计字段。
2. 复用 `scaffold-common` 的返回、分页与异常，以及 `scaffold-framework` 的权限、数据权限、操作日志能力。
3. 前端列表复用 `ListPage`、`useListPage` / `useTreeListPage`；表单复用 `FormDialog`、`Field` 和现有控件，操作复用 `PermissionButton`。
4. 在 `src/api` 接入统一 HTTP 客户端，在 `src/composables/auth.ts` 的 `PAGE_MAP` 登记页面，再添加菜单和按钮权限。
5. 按角色配置菜单和数据范围，验证低权限账号的真实接口拒绝行为、查询、分页、导出及表单校验。
6. 同步项目地图、相关接口说明和更新日志。

代码生成初始配置为空，按需导入当前数据库的真实表，支持字段信息查看、配置说明保存、7 个文件预览和 ZIP 下载。导入为一次性快照：源表结构变更后用「重新同步」按数据库最新元数据重建列配置（确认状态重置为待确认），「取消导入」只删除生成配置不动源表，源表已删除时列表会标记提示。输出为开发骨架：Controller、Service、Mapper 的业务 CRUD 仍需实现，前端页面需按统一组件规范补齐；下载不会自动写入本工程。

## 验证

不连接数据库和 Redis 的测试与编译：

```bash
# 在 scaffold-system 目录
mvn -pl scaffold-framework -am test
mvn -pl scaffold-admin -am package -DskipTests
```

完整后端集成测试需要配置上述环境变量并准备独立校验库：

```bash
# 在 scaffold-system 目录；建议用独立校验库，测试会写入夹具和日志
mvn -pl scaffold-admin -am test
```

```bash
# 在 scaffold-vue 目录
npm run test:unit
npm run build
# 已安装 Python Playwright 与 Chromium 时，可验证真实浏览器会话与权限
python3 scripts/session-regression.py
```

浏览器回归脚本只创建并删除自己生成的测试角色和用户，不清空表；管理员密码可通过 `SCAFFOLD_TEST_PASSWORD` 覆盖。测试与构建成功不能代替业务页面验收。

## 许可证

本项目代码采用 [MIT License](LICENSE)，允许商用、修改和分发，使用时保留版权及许可证声明。

第三方依赖遵循各自的许可证。GSAP 使用 [Standard "No Charge" License](https://gsap.com/community/standard-license/)，不属于本项目的 MIT 授权范围；使用与再分发时须遵守其条款并保留原有声明。
