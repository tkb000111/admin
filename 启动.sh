#!/usr/bin/env bash
# 酷炫后台管理 — 启动脚本
#
# 架构：内部双进程双端口，对外统一单端口。
#
#   外部用户 → 网关 18090（Node，服务页面 + 代理 /api）
#                  └→ 后端 18091（Java，只处理 /api）
#
# 对外只有一个地址，用户感知不到内部有两个服务；
# 升级页面只需替换前端产物并重启网关，不必重启 Java 业务服务。
#
# 端口策略：固定端口 + 重启即替换。本项目旧实例占着漂移端口时会先杀掉再起；
# 固定端口被外来程序占用则明确报错退出，不静默换端口（桌面版应用固定占 18080/18081）。
#
# 用法：
#   ./启动.sh           起服务，显示本机 + 局域网地址
#   ./启动.sh 穿透       额外启动 cpolar，再显示一个外网地址
#   ./启动.sh 前端       只重新构建前端产物（不重启后端）
#   ./启动.sh 开发       开发模式：spring-boot:run + devtools，重新编译即自动重启（不打包）
#   ./启动.sh 状态       看运行状态与地址
#   ./启动.sh 停止       停止网关、后端与穿透
#
# 说明：只动本项目容器（scaffold-mysql 3308 / scaffold-redis 6379），
#       不碰积木台（tkb-mysql 3307）和建材报价（bm_quotation_db 3306）。

set -euo pipefail

PROJECT_DIR="/Users/mac/CodeBuddy/酷炫后台管理"
JAVA_HOME_DIR="$HOME/dev-tools/jdk-17.0.20.1+1/Contents/Home"
SECRET_FILE="$HOME/dev-tools/scaffold-jwt-secret.txt"
JAR="$PROJECT_DIR/scaffold-system/scaffold-admin/target/scaffold-admin-0.1.0-SNAPSHOT.jar"
GATEWAY="$PROJECT_DIR/gateway/server.mjs"
CPOLAR="/usr/local/bin/cpolar"

export JAVA_HOME="$JAVA_HOME_DIR"
export PATH="$JAVA_HOME/bin:$PATH"

MODE="${1:-启动}"
OUTER_PORT=18090   # 对外（固定，桌面版占 18080/18081，故开发栈用 18090 起）
INNER_PORT=18091   # 后端（内部，固定）
DEV_PORT=18085     # 开发后端（固定）

backend_pid() { pgrep -f "scaffold-admin-0.1.0-SNAPSHOT.jar" | head -1; }
gateway_pid() { pgrep -f "gateway/server.mjs" | head -1; }
cpolar_pid()  { pgrep -f "cpolar http" | head -1; }
dev_pid()     { pgrep -f "spring-boot:run" | head -1; }

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# 端口归属裁定：$1=端口 $2=名称 $3=本项目进程 PID（可空）
#   · 本进程已在期望端口 → 保留不动
#   · 本进程在别的端口（历史漂移）→ 杀掉，稍后在新固定端口重起
#   · 端口被外来程序占用 → 明确报错退出，不静默逃逸
claim_port() {
  local port=$1 label=$2 own="${3:-}"
  if [ -n "$own" ] && lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | grep -qx "$own"; then
    return 0
  fi
  if [ -n "$own" ]; then
    kill "$own" 2>/dev/null || true
    echo "· $label 旧实例在漂移端口，已停止（将在 :$port 重起）"
    for _ in $(seq 1 10); do port_in_use "$port" || break; sleep 1; done
  fi
  if port_in_use "$port"; then
    local holders
    holders=$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')
    echo "✗ 端口 $port 被其他程序占用（PID: $holders）。请先关闭它，或修改本脚本顶部的端口常量。" >&2
    exit 1
  fi
}

lan_ip() { ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true; }

public_url() {
  curl -s --max-time 5 http://localhost:4040/api/tunnels 2>/dev/null \
    | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    for t in d.get("tunnels", []):
        if t.get("proto") == "http":
            print(t.get("public_url", "")); break
except Exception:
    pass' 2>/dev/null || true
}

show_status() {
  echo "── 进程 ──"
  [ -n "$(backend_pid)" ] && echo "  后端(内部) $INNER_PORT：运行中" || echo "  后端：未运行"
  [ -n "$(gateway_pid)" ] && echo "  网关(对外) $OUTER_PORT：运行中" || echo "  网关：未运行"
  [ -n "$(dev_pid)" ] && echo "  开发后端 $DEV_PORT：运行中" || true
  [ -n "$(cpolar_pid)" ]  && echo "  穿透：运行中" || echo "  穿透：未运行"
  echo "── 地址 ──"
  if [ -n "$(gateway_pid)" ]; then
    IP=$(lan_ip)
    echo "  本机    http://localhost:$OUTER_PORT"
    [ -n "$IP" ] && echo "  局域网  http://$IP:$OUTER_PORT"
    U=$(public_url); [ -n "$U" ] && echo "  外网    $U"
  fi
}

case "$MODE" in
  状态) show_status; exit 0 ;;
  停止)
    [ -n "$(cpolar_pid)" ]  && kill "$(cpolar_pid)"  && echo "已停止穿透"
    [ -n "$(gateway_pid)" ] && kill "$(gateway_pid)" && echo "已停止网关"
    [ -n "$(backend_pid)" ] && kill "$(backend_pid)" && echo "已停止后端"
    pkill -f "spring-boot:run" 2>/dev/null && echo "已停止开发后端（mvn）"
    # spring-boot:run 会 fork 出独立 JVM，pkill 抓不到，按端口兜底清理
    for _ in $(seq 1 5); do
      pids=$(lsof -nP -iTCP:"$DEV_PORT" -sTCP:LISTEN -t 2>/dev/null || true)
      [ -z "$pids" ] && break
      echo "$pids" | xargs kill 2>/dev/null || true
      sleep 1
    done
    rm -f /tmp/scaffold-dev-port
    echo "（容器保留，下次秒启）"
    exit 0
    ;;
  前端)
    echo "重新构建前端产物…"
    (cd "$PROJECT_DIR/scaffold-vue" && npm run build 2>&1 | tail -3)
    # 只重启网关（换新产物），后端业务服务不动；端口固定，不再读临时文件
    if [ -n "$(gateway_pid)" ]; then
      kill "$(gateway_pid)" 2>/dev/null || true
      for _ in $(seq 1 10); do port_in_use "$OUTER_PORT" || break; sleep 1; done
      if port_in_use "$OUTER_PORT"; then
        echo "✗ 端口 $OUTER_PORT 仍被占用，稍后再试" >&2; exit 1
      fi
      GATEWAY_PORT="$OUTER_PORT" BACKEND_PORT="$INNER_PORT" nohup node "$GATEWAY" > /tmp/scaffold-gateway.log 2>&1 &
      sleep 2
      echo "✓ 网关已重载（:$OUTER_PORT），页面已更新（后端未重启）"
    else
      echo "· 网关未运行，产物已更新"
    fi
    exit 0
    ;;
  启动|穿透|开发|"") ;;
  *) echo "用法：./启动.sh [启动|穿透|前端|开发|状态|停止]"; exit 1;;
esac

# 1. 容器
for c in scaffold-mysql scaffold-redis; do
  if [ "$(docker ps -aq -f name=^${c}$)" ]; then
    [ "$(docker ps -q -f name=^${c}$)" ] || docker start "$c" >/dev/null 2>&1
  fi
done
for _ in $(seq 1 30); do
  docker exec scaffold-mysql mysqladmin ping -h 127.0.0.1 -uroot -pscaffold123 --silent 2>/dev/null && break
  sleep 2
done

# 1.5 端口转发探活：容器"Up"不代表宿主端口通（OrbStack 曾出现转发静默死亡，
#     后端能起但所有 API 报错，登录页提示"无法连接服务"）。不通就重启容器恢复。
port_ready() { bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" 2>/dev/null; }
for pair in "scaffold-mysql 3308" "scaffold-redis 6379"; do
  set -- $pair
  if ! port_ready "$2"; then
    echo "· $1 的宿主端口 $2 转发失效，重启容器恢复…"
    docker restart "$1" >/dev/null 2>&1
    for _ in $(seq 1 15); do port_ready "$2" && break; sleep 2; done
  fi
done
if port_ready 3308 && port_ready 6379; then
  echo "✓ 数据库与缓存就绪（端口已验证）"
else
  echo "✗ 容器端口仍不通（3308/6379），请检查 OrbStack 或 Docker 网络后重试" >&2
  exit 1
fi

# 2. 密钥（固定，避免重启后已登录用户被踢下线）
if [ ! -f "$SECRET_FILE" ]; then
  mkdir -p "$(dirname "$SECRET_FILE")"
  openssl rand -hex 32 > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
fi
export JWT_SECRET="$(cat "$SECRET_FILE")"
export DB_HOST=127.0.0.1 DB_PORT=3308 DB_NAME=scaffold_system
export DB_USERNAME=root DB_PASSWORD=scaffold123 DB_TIMEZONE='+08:00'
export REDIS_HOST=127.0.0.1 REDIS_PORT=6379

# 2.5 开发模式：spring-boot:run + devtools，重新编译即自动重启，不走打包与网关
if [ "$MODE" = "开发" ]; then
  # 固定端口 + 替换旧实例（mvn 包装进程与它 fork 的 java 都要清理，按端口精确定位）
  if [ -n "$(dev_pid)" ]; then
    pkill -f "spring-boot:run" 2>/dev/null || true
    for _ in $(seq 1 10); do
      port_in_use "$DEV_PORT" || break
      lsof -nP -iTCP:"$DEV_PORT" -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null || true
      sleep 1
    done
    echo "· 旧开发后端已停止（将在 :$DEV_PORT 重起）"
  fi
  if port_in_use "$DEV_PORT"; then
    holders=$(lsof -nP -iTCP:"$DEV_PORT" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ')
    echo "✗ 端口 $DEV_PORT 被其他程序占用（PID: $holders）。请先关闭它，或修改本脚本顶部的端口常量。" >&2
    exit 1
  fi
  echo "✓ 开发后端启动中（:$DEV_PORT，首次需编译全部模块，稍候）"
  echo "  · 改代码后：在 scaffold-system 目录执行  mvn -pl scaffold-admin -am compile -q  → 自动重启"
  echo "  · 前端另开终端：VITE_API_PROXY_TARGET=http://localhost:$DEV_PORT npm run dev"
  cd "$PROJECT_DIR/scaffold-system"
  export SERVER_PORT="$DEV_PORT"
  export PATH="$JAVA_HOME/bin:$HOME/dev-tools/apache-maven-3.9.16/bin:$PATH"
  exec mvn -pl scaffold-admin -am spring-boot:run
fi

# 3. 后端（固定内部端口）
claim_port "$INNER_PORT" 后端 "$(backend_pid)"
if port_in_use "$INNER_PORT"; then
  echo "· 后端已在 :$INNER_PORT 运行，保持不变"
else
  cd "$PROJECT_DIR/scaffold-system/scaffold-admin"
  nohup java -jar "$JAR" --server.port="$INNER_PORT" > /tmp/scaffold-backend.log 2>&1 &
  echo "✓ 后端启动中（内部 :$INNER_PORT）"
  for _ in $(seq 1 40); do
    curl -s --max-time 3 "http://localhost:$INNER_PORT/api/health" >/dev/null 2>&1 && break
    sleep 2
  done
  echo "✓ 后端就绪"
fi

# 4. 网关（固定对外端口）
claim_port "$OUTER_PORT" 网关 "$(gateway_pid)"
if port_in_use "$OUTER_PORT"; then
  echo "· 网关已在 :$OUTER_PORT 运行，保持不变"
else
  if [ ! -d "$PROJECT_DIR/scaffold-vue/dist" ]; then
    echo "· 首次运行，构建前端产物…"
    (cd "$PROJECT_DIR/scaffold-vue" && npm run build >/dev/null 2>&1)
  fi
  GATEWAY_PORT="$OUTER_PORT" BACKEND_PORT="$INNER_PORT" nohup node "$GATEWAY" > /tmp/scaffold-gateway.log 2>&1 &
  echo "✓ 网关启动中（对外 :$OUTER_PORT）"
  sleep 2
fi

# 5. 穿透（可选）
if [ "$MODE" = "穿透" ]; then
  if [ ! -x "$CPOLAR" ]; then
    echo "⚠ 未找到 cpolar（$CPOLAR），跳过外网地址"
  elif [ -z "$(cpolar_pid)" ]; then
    nohup "$CPOLAR" http "$OUTER_PORT" > /tmp/scaffold-cpolar.log 2>&1 &
    echo "· 正在建立穿透…"
    for _ in $(seq 1 20); do [ -n "$(public_url)" ] && break; sleep 1; done
  fi
fi

IP=$(lan_ip); U=$(public_url)
echo ""
echo "════════════════════════════════════════"
echo "  对外只有一个地址，内部两个服务："
echo "    网关 :$OUTER_PORT  ←  页面 + /api 转发"
echo "    后端 :$INNER_PORT  ←  Java 业务（不直接对外）"
echo "────────────────────────────────────────"
echo "  本机     http://localhost:$OUTER_PORT"
[ -n "$IP" ] && echo "  局域网   http://$IP:$OUTER_PORT"
if [ -n "$U" ]; then echo "  外网     $U"; else echo "  外网     （./启动.sh 穿透 可开启）"; fi
echo "────────────────────────────────────────"
echo "  账号 admin / admin123   验证码看页面"
echo "  改页面后：./启动.sh 前端  （不重启后端）"
echo "  端口固定不变；被占用会明确报错，不会静默换端口"
echo "════════════════════════════════════════"
