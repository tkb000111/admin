#!/usr/bin/env bash
# 生成打包用的精简 Java 运行环境（runtime/ 不入库，用本脚本重建）
#
# 模块清单里的 java.desktop 不能去掉：Spring Boot 启动时要用 java.beans
# （PropertyEditorSupport），缺了会 NoClassDefFoundError 直接起不来。
set -euo pipefail

JH="${SCAFFOLD_JAVA_HOME:-$HOME/dev-tools/jdk-17.0.20.1+1/Contents/Home}"
cd "$(dirname "$0")"

rm -rf runtime
"$JH/bin/jlink" \
  --add-modules java.base,java.compiler,java.datatransfer,java.desktop,java.instrument,java.logging,java.management,java.naming,java.net.http,java.prefs,java.rmi,java.scripting,java.security.jgss,java.security.sasl,java.smartcardio,java.sql,java.transaction.xa,java.xml,java.xml.crypto,jdk.crypto.ec,jdk.crypto.cryptoki,jdk.httpserver,jdk.unsupported,jdk.zipfs,jdk.management,jdk.jfr \
  --strip-debug --no-man-pages --no-header-files --compress=2 \
  --output runtime

echo "✓ 精简 JRE 已生成：$(du -sh runtime | cut -f1)"
./runtime/bin/java -version 2>&1 | head -1
