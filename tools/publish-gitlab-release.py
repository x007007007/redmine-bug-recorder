#!/usr/bin/env python3
"""等 GitHub Actions 打好包,下载后放进 GitLab Package Registry,再创建 GitLab Release。"""
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TAG = os.environ["CI_COMMIT_TAG"]
API = os.environ["CI_API_V4_URL"].rstrip("/")
PROJECT_ID = os.environ["CI_PROJECT_ID"]
PROJECT_PATH = os.environ["CI_PROJECT_PATH"]
SERVER = os.environ["CI_SERVER_URL"].rstrip("/")
JOB_TOKEN = os.environ["CI_JOB_TOKEN"]

assert TAG.count(".") == 2 and TAG.startswith("v"), f"tag 必须是 vX.Y.Z,当前是 {TAG}"

REPO = "x007007007/redmine-bug-recorder"
VER = TAG[1:]
FILES = (
    f"bug-recorder-chrome-v{VER}.zip",
    f"bug-recorder-firefox-v{VER}.xpi",
    f"bug-recorder-source-v{VER}.zip",
)
PACKAGE = "redmine-bug-recorder"


def request(method, url, data=None, headers=None, timeout=180):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def gitlab(method, path, data=None, content_type=None):
    headers = {"JOB-TOKEN": JOB_TOKEN}
    if content_type:
        headers["Content-Type"] = content_type
    return request(method, f"{API}{path}", data=data, headers=headers)


def release_exists():
    quoted = urllib.parse.quote(TAG, safe="")
    status, _body = gitlab("GET", f"/projects/{PROJECT_ID}/releases/{quoted}")
    return status == 200


def wait_github_assets():
    url = f"https://api.github.com/repos/{REPO}/releases/tags/{urllib.parse.quote(TAG, safe='')}"
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "redmine-bug-recorder-ci",
    }
    print(f"等待 GitHub Release {TAG}")
    for attempt in range(1, 31):
        status, body = request("GET", url, headers=headers, timeout=60)
        if status == 200:
            payload = json.loads(body)
            by_name = {item["name"]: item["browser_download_url"] for item in payload.get("assets", [])}
            if all(name in by_name for name in FILES):
                return by_name
        print(f"第 {attempt} 次还没有齐三个安装包 (HTTP {status}),20 秒后再看")
        time.sleep(20)
    raise SystemExit(f"超时:GitHub Release {TAG} 没有齐安装包。确认 tag 已推到 GitHub,且 package 流水线成功。")


def upload(name, blob):
    quoted_name = urllib.parse.quote(name)
    quoted_tag = urllib.parse.quote(TAG, safe="")
    path = f"/projects/{PROJECT_ID}/packages/generic/{PACKAGE}/{quoted_tag}/{quoted_name}"
    print(f"上传 {name} 到 GitLab Package Registry")
    status, body = gitlab("PUT", path, data=blob, content_type="application/octet-stream")
    assert status in (200, 201), f"上传 {name} 失败 HTTP {status}: {body[:300]!r}"
    parsed = json.loads(body) if body else {}
    file_id = parsed.get("id")
    if file_id:
        return file_id
    return lookup_file_id(name)


def lookup_file_id(name):
    query = urllib.parse.urlencode({
        "package_type": "generic",
        "package_name": PACKAGE,
        "package_version": TAG,
    })
    status, body = gitlab("GET", f"/projects/{PROJECT_ID}/packages?{query}")
    assert status == 200, f"查询包失败 HTTP {status}: {body[:300]!r}"
    packages = json.loads(body)
    assert packages, f"上传 {name} 后没有找到包 {PACKAGE} {TAG}"
    package_id = packages[0]["id"]
    status, body = gitlab("GET", f"/projects/{PROJECT_ID}/packages/{package_id}/package_files")
    assert status == 200, f"查询包文件失败 HTTP {status}: {body[:300]!r}"
    matches = [item["id"] for item in json.loads(body) if item.get("file_name") == name]
    assert matches, f"包里没有 {name}"
    return max(matches)


def create_release(links):
    description = (
        f"版本 {VER}。安装包由 GitHub Actions 按同一 git tag 构建,本页是正式发布。\n\n"
        "不可商用。商业使用必须先联系作者 x007007007@hotmail.com 取得书面授权。"
    )
    payload = {
        "name": TAG,
        "tag_name": TAG,
        "description": description,
        "assets": {"links": links},
    }
    print(f"创建 GitLab Release {TAG}")
    status, body = gitlab(
        "POST",
        f"/projects/{PROJECT_ID}/releases",
        data=json.dumps(payload).encode(),
        content_type="application/json",
    )
    assert status in (200, 201), f"创建 Release 失败 HTTP {status}: {body[:500]!r}"
    created = json.loads(body)
    print(created.get("tag_name"), created.get("_links", {}).get("self", ""))


def main():
    if release_exists():
        print(f"GitLab Release {TAG} 已存在,跳过")
        return
    assets = wait_github_assets()
    stage = Path("/tmp/bugrec-assets")
    stage.mkdir(parents=True, exist_ok=True)
    links = []
    for name in FILES:
        print(f"下载 {name}")
        status, blob = request("GET", assets[name], timeout=180)
        assert status == 200 and blob, f"下载 {name} 失败 HTTP {status}"
        file_id = upload(name, blob)
        links.append({
            "name": name,
            "url": f"{SERVER}/{PROJECT_PATH}/-/package_files/{file_id}/download",
            "link_type": "package",
        })
    create_release(links)


if __name__ == "__main__":
    main()
