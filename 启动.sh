#!/usr/bin/env bash
# 酷炫后台管理 — 单端口启动脚本
#
# 用法：
#   ./启动.sh           起服务，显示本机 + 局域网地址
#   ./启动.sh 穿透       额外启动 cpolar，再显示一个外网地址
#   ./启动.sh 状态       看运行状态与地址
#   ./启动.sh 停止       停止服务与穿透
#
# 说明：
#   - 前端已打进后端 jar，只需一个进程、一个端口，不再需要 Node/Vite
#   - 默认端口 18080；若被占用会自动顺延（18081、18082…），界面显示实际端口
#   - 只动本项目容器（scaffold-mysql 3308 / scaffold-redis 6379），
#     不碰积木台（tkb-mysql 3307）和建材报价（bm_quotation_db 3306）

set -euo pipefail

PROJECT_DIR="/Users/mac/CodeBuddy/酷炫后台管理"
JAVA_HOME_DIR="$HOME/dev-tools/jdk-17.0.20.1+1/Contents/Home"
SECRET_FILE="$HOME/dev-tools/scaffold-jwt-secret.txt"
JAR="$PROJECT_DIR/scaffold-system/scaffold-admin/target/scaffold-admin-0.1.0-SNAPSHOT.jar"
CPOLAR="/usr/local/bin/cpolar"

export JAVA_HOME="$JAVA_HOME_DIR"
export PATH="$JAVA_HOME/bin:$PATH"

MODE="${1:-启动}"
BASE_PORT=18080

backend_pid() { pgrep -f "scaffold-admin-0.1.0-SNAPSHOT.jar" | head -1; }
cpolar_pid()  { pgrep -f "cpolar http" | head -1; }

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

# 从 BASE_PORT 起找一个空闲端口
pick_port() {
  local p=$BASE_PORT
  while port_in_use "$p"; do
    p=$((p + 1))
    [ "$p" -gt $((BASE_PORT + 50)) ] && { echo "找不到空闲端口（已试 $BASE_PORT ~ $((BASE_PORT+50))）" >&2; exit 1; }
  done
  echo "$p"
}

lan_ip() { ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true; }

# 从 cpolar 本地管理接口读公网地址
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

case "$MODE" in
  状态)
    echo "── 容器 ──"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | grep -E "NAMES|scaffold-" || echo "  未运行"
    echo "── 进程 ──"
    [ -n "$(backend_pid)" ] && echo "  后端：运行中 (PID $(backend_pid))" || echo "  后端：未运行"
    [ -n "$(cpolar_pid)" ]  && echo "  穿透：运行中 (PID $(cpolar_pid))" || echo "  穿透：未运行"
    echo "── 地址 ──"
    if [ -n "$(backend_pid)" ]; then
      # 从日志里读实际端口
      P=$(grep -aoE "Tomcat started on port [0-9]+" /tmp/scaffold-backend.log 2>/dev/null | tail -1 | grep -oE "[0-9]+")
      P=${P:-$BASE_PORT}
      IP=$(lan_ip)
      echo "  本机    http://localhost:$P"
      [ -n "$IP" ] && echo "  局域网  http://$IP:$P"
      U=$(public_url); [ -n "$U" ] && echo "  外网    $U"
    fi
    exit 0
    ;;
  停止)
    [ -n "$(cpolar_pid)" ]  && kill "$(cpolar_pid)"  && echo "已停止穿透"
    [ -n "$(backend_pid)" ] && kill "$(backend_pid)" && echo "已停止后端"
    echo "（容器保留，下次秒启）"
    exit 0
    ;;
  启动|穿透|"")
    ;;
  *)
    echo "用法：./启动.sh [启动|穿透|状态|停止]"; exit 1;;
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

# 3. 选端口
PORT=$(pick_port)
[ "$PORT" != "$BASE_PORT" ] && echo "· 端口 $BASE_PORT 被占用，改用 $PORT"

# 4. 后端
if [ -n "$(backend_pid)" ]; then
  echo "· 后端已在运行"
else
  cd "$PROJECT_DIR/scaffold-system/scaffold-admin"
  nohup java -jar "$JAR" --server.port="$PORT" > /tmp/scaffold-backend.log 2>&1 &
  echo "✓ 后端启动中"
fi

# 5. 等后端就绪
READY=0
for _ in $(seq 1 40); do
  curl -s --max-time 3 "http://localhost:$PORT/api/health" >/dev/null 2>&1 && { READY=1; break; }
  sleep 2
done
[ "$READY" = "1" ] && echo "✓ 服务就绪" || echo "⚠ 后端启动较慢，请查看 /tmp/scaffold-backend.log"

# 6. 穿透（可选）
if [ "$MODE" = "穿透" ]; then
  if [ ! -x "$CPOLAR" ]; then
    echo "⚠ 未找到 cpolar（$CPOLAR），跳过外网地址"
  elif [ -z "$(cpolar_pid)" ]; then
    nohup "$CPOLAR" http "$PORT" > /tmp/scaffold-cpolar.log 2>&1 &
    echo "· 正在建立穿透…"
    for _ in $(seq 1 20); do
      [ -n "$(public_url)" ] && break
      sleep 1
    done
  fi
fi

IP=$(lan_ip)
U=$(public_url)

echo ""
echo "════════════════════════════════════════"
echo "  本机     http://localhost:$PORT"
[ -n "$IP" ] && echo "  局域网   http://$IP:$PORT"
if [ -n "$U" ]; then echo "  外网     $U"; else echo "  外网     （./启动.sh 穿透 可开启）"; fi
echo "────────────────────────────────────────"
echo "  账号 admin / admin123   验证码看页面"
echo "════════════════════════════════════════"
