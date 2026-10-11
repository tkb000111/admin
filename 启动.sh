#!/usr/bin/env bash
# 酷炫后台管理（scaffold-master）本地一键启动
# 用法：./启动.sh 开发 | ./启动.sh 停止 | ./启动.sh 状态
# 说明：只起本项目的容器（scaffold-mysql 3308 / scaffold-redis 6379），
#       不碰积木台（tkb-mysql 3307）和建材报价（bm_quotation_db 3306）。

set -euo pipefail

PROJECT_DIR="/Users/mac/CodeBuddy/酷炫后台管理"
JAVA_HOME_DIR="$HOME/dev-tools/jdk-17.0.20.1+1/Contents/Home"
MAVEN_DIR="$HOME/dev-tools/apache-maven-3.9.16/bin"
SECRET_FILE="$HOME/dev-tools/scaffold-jwt-secret.txt"
JAR="$PROJECT_DIR/scaffold-system/scaffold-admin/target/scaffold-admin-0.1.0-SNAPSHOT.jar"

export JAVA_HOME="$JAVA_HOME_DIR"
export PATH="$JAVA_HOME/bin:$MAVEN_DIR:$PATH"

MODE="${1:-开发}"

backend_pid() { pgrep -f "scaffold-admin-0.1.0-SNAPSHOT.jar" | head -1; }
frontend_pid() { pgrep -f "vite" | head -1; }

case "$MODE" in
  状态)
    echo "── 容器 ──"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -E "NAMES|scaffold-" || echo "  未运行"
    echo "── 进程 ──"
    [ -n "$(backend_pid)" ] && echo "  后端 8080：运行中 (PID $(backend_pid))" || echo "  后端 8080：未运行"
    [ -n "$(frontend_pid)" ] && echo "  前端 5173：运行中 (PID $(frontend_pid))" || echo "  前端 5173：未运行"
    echo "── 访问 ──"
    echo "  http://localhost:5173   账号 admin / admin123"
    exit 0
    ;;
  停止)
    [ -n "$(backend_pid)" ] && kill "$(backend_pid)" && echo "已停止后端"
    [ -n "$(frontend_pid)" ] && kill "$(frontend_pid)" && echo "已停止前端"
    echo "（容器保留，下次秒启；要连容器一起停：docker stop scaffold-mysql scaffold-redis）"
    exit 0
    ;;
  开发|"")
    ;;
  *)
    echo "用法：./启动.sh [开发|停止|状态]"; exit 1;;
esac

# 1. 容器
for c in scaffold-mysql scaffold-redis; do
  if [ "$(docker ps -aq -f name=^${c}$)" ]; then
    [ "$(docker ps -q -f name=^${c}$)" ] || docker start "$c" >/dev/null
  fi
done
echo "✓ 容器就绪"

# 等待 MySQL 可用
for _ in $(seq 1 30); do
  docker exec scaffold-mysql mysqladmin ping -h 127.0.0.1 -uroot -pscaffold123 --silent 2>/dev/null && break
  sleep 2
done
echo "✓ MySQL 就绪 (3308)"

# 2. 密钥（固定，避免重启后登录态失效）
if [ ! -f "$SECRET_FILE" ]; then
  mkdir -p "$(dirname "$SECRET_FILE")"
  openssl rand -hex 32 > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
fi
export JWT_SECRET="$(cat "$SECRET_FILE")"
export DB_HOST=127.0.0.1 DB_PORT=3308 DB_NAME=scaffold_system
export DB_USERNAME=root DB_PASSWORD=scaffold123 DB_TIMEZONE='+08:00'
export REDIS_HOST=127.0.0.1 REDIS_PORT=6379

# 3. 后端
if [ -n "$(backend_pid)" ]; then
  echo "· 后端已在运行"
else
  cd "$PROJECT_DIR/scaffold-system/scaffold-admin"
  nohup java -jar "$JAR" > /tmp/scaffold-backend.log 2>&1 &
  echo "✓ 后端启动中 (日志 /tmp/scaffold-backend.log)"
fi

# 4. 前端
if [ -n "$(frontend_pid)" ]; then
  echo "· 前端已在运行"
else
  cd "$PROJECT_DIR/scaffold-vue"
  # VITE_HOST=0.0.0.0 + allowedHosts 放行：让局域网和内网穿透域名都能访问
  # 原理：外部只连前端 5173，/api 由 Vite 在本机转发到后端 8080，所以后端无需穿透
  VITE_HOST=0.0.0.0 VITE_ALLOWED_HOSTS=all \
    nohup npm run dev > /tmp/scaffold-frontend.log 2>&1 &
  echo "✓ 前端启动中 (日志 /tmp/scaffold-frontend.log)"
fi

# 5. 等后端就绪
for _ in $(seq 1 40); do
  curl -s --max-time 3 http://localhost:8080/api/health >/dev/null 2>&1 && break
  sleep 2
done

echo ""
echo "════════════════════════════════════"
echo "  访问：http://localhost:5173"
echo "  账号：admin     密码：admin123"
echo "  验证码：页面上显示什么填什么"
echo "════════════════════════════════════"
