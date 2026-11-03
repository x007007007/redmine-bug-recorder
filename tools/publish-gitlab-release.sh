#!/bin/sh
# 在 GitLab tag 流水线里运行:等 GitHub Actions 打好包,下载后放进 Generic Package,
# 再创建 GitLab Release。打包不在这里做。
set -eu

: "${CI_COMMIT_TAG:?需要 git tag}"
: "${CI_API_V4_URL:?}"
: "${CI_PROJECT_ID:?}"
: "${CI_PROJECT_PATH:?}"
: "${CI_SERVER_URL:?}"
: "${CI_JOB_TOKEN:?}"

case "$CI_COMMIT_TAG" in
  v*.*.*) ;;
  *) echo "tag 必须是 vX.Y.Z,当前是 $CI_COMMIT_TAG"; exit 1 ;;
esac

repo="x007007007/redmine-bug-recorder"
ver="${CI_COMMIT_TAG#v}"
files="bug-recorder-chrome-v${ver}.zip bug-recorder-firefox-v${ver}.xpi bug-recorder-source-v${ver}.zip"
api="https://api.github.com/repos/${repo}/releases/tags/${CI_COMMIT_TAG}"

release_code=$(curl -sS -o /tmp/gl-release.json -w '%{http_code}' \
  --header "JOB-TOKEN: ${CI_JOB_TOKEN}" \
  "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/releases/${CI_COMMIT_TAG}")
if [ "$release_code" = "200" ]; then
  echo "GitLab Release ${CI_COMMIT_TAG} 已存在,跳过"
  exit 0
fi

echo "等待 GitHub Release ${CI_COMMIT_TAG}"
found=0
i=0
while [ "$i" -lt 30 ]; do
  i=$((i + 1))
  code=$(curl -sS -o /tmp/gh-release.json -w '%{http_code}' \
    -H "Accept: application/vnd.github+json" \
    -H "User-Agent: redmine-bug-recorder-ci" \
    "$api" || true)
  if [ "$code" = "200" ]; then
    missing=0
    for name in $files; do
      if ! jq -e --arg n "$name" '.assets[] | select(.name == $n)' /tmp/gh-release.json >/dev/null; then
        missing=1
      fi
    done
    if [ "$missing" = "0" ]; then
      found=1
      break
    fi
  fi
  echo "第 ${i} 次还没有齐三个安装包 (HTTP ${code}),20 秒后再看"
  sleep 20
done

if [ "$found" != "1" ]; then
  echo "超时:GitHub Release ${CI_COMMIT_TAG} 没有齐安装包。确认 tag 已推到 GitHub,且 package 流水线成功。"
  exit 1
fi

mkdir -p /tmp/bugrec-assets
links="["
sep=""
for name in $files; do
  url=$(jq -r --arg n "$name" '.assets[] | select(.name == $n) | .browser_download_url' /tmp/gh-release.json)
  echo "下载 ${name}"
  curl -fsSL -L -o "/tmp/bugrec-assets/${name}" "$url"
  echo "上传 ${name} 到 GitLab Package Registry"
  curl -fsS --header "JOB-TOKEN: ${CI_JOB_TOKEN}" \
    --upload-file "/tmp/bugrec-assets/${name}" \
    "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/generic/redmine-bug-recorder/${CI_COMMIT_TAG}/${name}" \
    -o /tmp/pkg-upload.json
  file_id=$(jq -r '.id' /tmp/pkg-upload.json)
  if [ -z "$file_id" ] || [ "$file_id" = "null" ]; then
    echo "上传 ${name} 没有返回文件 id"
    cat /tmp/pkg-upload.json
    exit 1
  fi
  download="${CI_SERVER_URL}/${CI_PROJECT_PATH}/-/package_files/${file_id}/download"
  links="${links}${sep}{\"name\":\"${name}\",\"url\":\"${download}\",\"link_type\":\"package\"}"
  sep=","
done
links="${links}]"

jq -n \
  --arg tag "$CI_COMMIT_TAG" \
  --arg ver "$ver" \
  --argjson assets "$links" \
  '{
    name: $tag,
    tag_name: $tag,
    description: ("版本 " + $ver + "。安装包由 GitHub Actions 按同一 git tag 构建,本页是正式发布。\n\n不可商用。商业使用必须先联系作者 x007007007@hotmail.com 取得书面授权。"),
    assets: { links: $assets }
  }' > /tmp/gl-release-body.json

echo "创建 GitLab Release ${CI_COMMIT_TAG}"
curl -fsS --request POST \
  --header "JOB-TOKEN: ${CI_JOB_TOKEN}" \
  --header "Content-Type: application/json" \
  --data @/tmp/gl-release-body.json \
  "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/releases" \
  -o /tmp/gl-release-created.json
jq -r '.tag_name + " " + (._links.self // .description)' /tmp/gl-release-created.json
