#!/usr/bin/env bash
# 酷炫后台管理 — 启动脚本
#
# 架构：内部双进程双端口，对外统一单端口。
#
#   外部用户 → 网关 18080（Node，服务页面 + 代理 /api）
#                  └→ 后端 18081（Java，只处理 /api）
#
# 对外只有一个地址，用户感知不到内部有两个服务；
# 升级页面只需替换前端产物并重启网关，不必重启 Java 业务服务。
#
# 用法：
#   ./启动.sh           起服务，显示本机 + 局域网地址
#   ./启动.sh 穿透       额外启动 cpolar，再显示一个外网地址
#   ./启动.sh 前端       只重新构建前端产物（不重启后端）
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
OUTER_PORT=18080   # 对外
INNER_PORT=18081   # 后端（内部）

backend_pid() { pgrep -f "scaffold-admin-0.1.0-SNAPSHOT.jar" | head -1; }
gateway_pid() { pgrep -f "gateway/server.mjs" | head -1; }
cpolar_pid()  { pgrep -f "cpolar http" | head -1; }

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

pick_port() {
  local p=$1
  while port_in_use "$p"; do p=$((p + 1)); done
  echo "$p"
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
  [ -n "$(backend_pid)" ] && echo "  后端(内部) $(cat /tmp/scaffold-inner-port 2>/dev/null || echo $INNER_PORT)：运行中" || echo "  后端：未运行"
  [ -n "$(gateway_pid)" ] && echo "  网关(对外) $(cat /tmp/scaffold-outer-port 2>/dev/null || echo $OUTER_PORT)：运行中" || echo "  网关：未运行"
  [ -n "$(cpolar_pid)" ]  && echo "  穿透：运行中" || echo "  穿透：未运行"
  echo "── 地址 ──"
  if [ -n "$(gateway_pid)" ]; then
    P=$(cat /tmp/scaffold-outer-port 2>/dev/null || echo $OUTER_PORT)
    IP=$(lan_ip)
    echo "  本机    http://localhost:$P"
    [ -n "$IP" ] && echo "  局域网  http://$IP:$P"
    U=$(public_url); [ -n "$U" ] && echo "  外网    $U"
  fi
}

case "$MODE" in
  状态) show_status; exit 0 ;;
  停止)
    [ -n "$(cpolar_pid)" ]  && kill "$(cpolar_pid)"  && echo "已停止穿透"
    [ -n "$(gateway_pid)" ] && kill "$(gateway_pid)" && echo "已停止网关"
    [ -n "$(backend_pid)" ] && kill "$(backend_pid)" && echo "已停止后端"
    echo "（容器保留，下次秒启）"
    exit 0
    ;;
  前端)
    echo "重新构建前端产物…"
    (cd "$PROJECT_DIR/scaffold-vue" && npm run build 2>&1 | tail -3)
    # 只重启网关，后端业务服务不动
    if [ -n "$(gateway_pid)" ]; then
      kill "$(gateway_pid)"; sleep 1
      P=$(cat /tmp/scaffold-outer-port 2>/dev/null || echo $OUTER_PORT)
      B=$(cat /tmp/scaffold-inner-port 2>/dev/null || echo $INNER_PORT)
      GATEWAY_PORT="$P" BACKEND_PORT="$B" nohup node "$GATEWAY" > /tmp/scaffold-gateway.log 2>&1 &
      sleep 2
      echo "✓ 网关已重载，页面已更新（后端未重启）"
    else
      echo "· 网关未运行，产物已更新"
    fi
    exit 0
    ;;
  启动|穿透|"") ;;
  *) echo "用法：./启动.sh [启动|穿透|前端|状态|停止]"; exit 1;;
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
echo "✓ 数据库与缓存就绪"

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

# 3. 后端（内部端口）
INNER=$(pick_port $INNER_PORT)
echo "$INNER" > /tmp/scaffold-inner-port
if [ -n "$(backend_pid)" ]; then
  echo "· 后端已在运行"
else
  cd "$PROJECT_DIR/scaffold-system/scaffold-admin"
  nohup java -jar "$JAR" --server.port="$INNER" > /tmp/scaffold-backend.log 2>&1 &
  echo "✓ 后端启动中（内部 :$INNER）"
  for _ in $(seq 1 40); do
    curl -s --max-time 3 "http://localhost:$INNER/api/health" >/dev/null 2>&1 && break
    sleep 2
  done
  echo "✓ 后端就绪"
fi

# 4. 网关（对外端口）
if [ ! -d "$PROJECT_DIR/scaffold-vue/dist" ]; then
  echo "· 首次运行，构建前端产物…"
  (cd "$PROJECT_DIR/scaffold-vue" && npm run build >/dev/null 2>&1)
fi
OUTER=$(pick_port $OUTER_PORT)
echo "$OUTER" > /tmp/scaffold-outer-port
if [ -n "$(gateway_pid)" ]; then
  echo "· 网关已在运行"
else
  GATEWAY_PORT="$OUTER" BACKEND_PORT="$INNER" nohup node "$GATEWAY" > /tmp/scaffold-gateway.log 2>&1 &
  echo "✓ 网关启动中（对外 :$OUTER）"
  sleep 2
fi

# 5. 穿透（可选）
if [ "$MODE" = "穿透" ]; then
  if [ ! -x "$CPOLAR" ]; then
    echo "⚠ 未找到 cpolar（$CPOLAR），跳过外网地址"
  elif [ -z "$(cpolar_pid)" ]; then
    nohup "$CPOLAR" http "$OUTER" > /tmp/scaffold-cpolar.log 2>&1 &
    echo "· 正在建立穿透…"
    for _ in $(seq 1 20); do [ -n "$(public_url)" ] && break; sleep 1; done
  fi
fi

IP=$(lan_ip); U=$(public_url)
echo ""
echo "════════════════════════════════════════"
echo "  对外只有一个地址，内部两个服务："
echo "    网关 :$OUTER  ←  页面 + /api 转发"
echo "    后端 :$INNER  ←  Java 业务（不直接对外）"
echo "────────────────────────────────────────"
echo "  本机     http://localhost:$OUTER"
[ -n "$IP" ] && echo "  局域网   http://$IP:$OUTER"
if [ -n "$U" ]; then echo "  外网     $U"; else echo "  外网     （./启动.sh 穿透 可开启）"; fi
echo "────────────────────────────────────────"
echo "  账号 admin / admin123   验证码看页面"
echo "  改页面后：./启动.sh 前端  （不重启后端）"
echo "════════════════════════════════════════"
