#!/bin/sh
# 一键初始化本地 Redmine:等就绪 → 默认数据 → REST 开关/admin/AK → 写 .env。
# 幂等可重复执行。AK 写入同目录 .env(gitignore,勿提交)。
set -eu
cd "$(dirname "$0")"

BASE="${REDMINE_URL:-http://127.0.0.1:13000}"
echo "== 等待 Redmine 就绪: $BASE =="
i=0
while ! curl -sf -o /dev/null "$BASE/"; do
  i=$((i + 1))
  if [ "$i" -ge 150 ]; then echo "✗ 150 次探测后仍未就绪(共约 5 分钟)"; exit 1; fi
  sleep 2
done
echo "✓ Redmine 已就绪"

echo "== 加载默认数据(tracker/状态/优先级/工作流,简体中文) =="
# 已加载过时 rake 会交互式询问是否覆盖,用 n 回答跳过
printf 'n\n' | docker compose exec -T redmine bundle exec rake redmine:load_default_data REDMINE_LANG=zh RAILS_ENV=production || echo "(默认数据已存在,跳过)"

echo "== REST 开关 / admin 密码语言 / 生成 AK =="
docker compose cp init.rb redmine:/tmp/init.rb
OUT=$(docker compose exec -T redmine bundle exec rails runner /tmp/init.rb)
echo "$OUT"

AK=$(printf '%s' "$OUT" | sed -n 's/^AK=//p' | head -1 | tr -d '\r')
if [ -z "$AK" ]; then echo "✗ 未取得 AK"; exit 1; fi

cat > .env <<EOF
# 本地 Redmine 测试服务凭证(勿提交:已在 .gitignore)
REDMINE_URL=$BASE
REDMINE_AK=$AK
ADMIN_USER=admin
ADMIN_PASSWORD=Redmine@2026
EOF
chmod 600 .env
echo "✓ AK 已写入 .env(共 ${#AK} 字符)"

echo "== 验证 REST API =="
curl -sf -H "X-Redmine-API-Key: $AK" "$BASE/users/current.json" | head -c 200
echo ""
echo "✓ 完成"
