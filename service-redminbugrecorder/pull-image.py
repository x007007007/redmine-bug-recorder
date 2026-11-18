#!/usr/bin/env python3
# Docker Hub 不可达时(本机 Docker Desktop 代理链路损坏,daemon 侧拉取黑洞),
# 从可用的镜像源(默认 registry.orangejx.cn)在宿主机侧直接下载 redmine 镜像层,
# 组装成 docker load 归档并导入。零第三方依赖。
#
# 用法: python3 pull-image.py [repo] [tag] [registry]
# 默认: python3 pull-image.py library/redmine 6.0 https://registry.orangejx.cn
# 导入后镜像名为 redmine:<tag>。幂等:已有同名镜像时跳过(--force 重导)。
import gzip
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import hashlib

REPO = sys.argv[1] if len(sys.argv) > 1 else 'library/redmine'
TAG = sys.argv[2] if len(sys.argv) > 2 else '6.0'
REG = sys.argv[3] if len(sys.argv) > 3 else 'https://registry.orangejx.cn'
LOCAL_NAME = 'redmine:' + TAG
PLAT = 'linux/arm64'
ACCEPT = ('application/vnd.oci.image.index.v1+json,'
          'application/vnd.docker.distribution.manifest.list.v2+json,'
          'application/vnd.oci.image.manifest.v1+json,'
          'application/vnd.docker.distribution.manifest.v2+json')


def req(url, accept=None):
    headers = {'User-Agent': 'docker/27.0', 'Accept': accept or ACCEPT}
    r = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(r, timeout=120) as resp:
        return resp.read()


def api(path, accept=None):
    return req(f'{REG}/v2/{path}', accept)


def main():
    have = subprocess.run(['docker', 'image', 'inspect', LOCAL_NAME],
                          capture_output=True).returncode == 0
    if have and '--force' not in sys.argv:
        print(f'✓ {LOCAL_NAME} 已存在,跳过(--force 重导)')
        return

    print(f'== 解析 {REPO}:{TAG} ({PLAT}) @ {REG} ==')
    index = json.loads(api(f'{REPO}/manifests/{TAG}'))
    if 'manifests' in index:  # 多架构索引 → 选 arm64
        target = None
        for m in index['manifests']:
            p = m.get('platform') or {}
            if p.get('os') == 'linux' and p.get('architecture') == 'arm64' and p.get('variant', 'v8') == 'v8':
                target = m['digest']
        if not target:
            sys.exit('✗ 索引中没有 linux/arm64 条目')
        print('arm64 manifest:', target)
        manifest = json.loads(api(f'{REPO}/manifests/{target}'))
        man_digest = target
    else:
        manifest = index
        man_digest = None

    cfg_digest = manifest['config']['digest']
    layers = [l['digest'] for l in manifest['layers']]
    print(f'config: {cfg_digest}, 层数: {len(layers)}')

    work = tempfile.mkdtemp(prefix='redmine-load-')
    try:
        print('下载 config…')
        cfg_blob = api(f'{REPO}/blobs/{cfg_digest}')
        cfg_hex = cfg_digest.split(':', 1)[1]
        assert hashlib.sha256(cfg_blob).hexdigest() == cfg_hex, 'config 哈希不匹配'
        cfg_path = os.path.join(work, cfg_hex + '.json')
        with open(cfg_path, 'wb') as f:
            f.write(cfg_blob)

        layer_files = []
        for i, dig in enumerate(layers):
            name = f'layer{i:02d}.tar'
            path = os.path.join(work, name)
            gz_path = path + '.gz'
            print(f'下载层 {i + 1}/{len(layers)}: {dig[:20]}…')
            blob = api(f'{REPO}/blobs/{dig}')
            want = dig.split(':', 1)[1]
            got = hashlib.sha256(blob).hexdigest()
            if got != want:
                sys.exit(f'✗ 层哈希不匹配 {dig}')
            with open(gz_path, 'wb') as f:
                f.write(blob)
            # docker load 要求的 diff_id 是未压缩 tar 的 sha256,解压落盘
            with gzip.open(gz_path, 'rb') as src, open(path, 'wb') as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
            os.remove(gz_path)
            layer_files.append(name)
            print(f'  ✓ {name} ({os.path.getsize(path) // 1048576} MiB 解压后)')

        out_path = os.path.join(work, 'load.tar')
        with tarfile.open(out_path, 'w') as tf:
            for fn in os.listdir(work):
                if fn != 'load.tar':
                    tf.add(os.path.join(work, fn), arcname=fn)
            mf = [{'Config': cfg_hex + '.json', 'RepoTags': [LOCAL_NAME], 'Layers': layer_files}]
            import io
            data = json.dumps(mf).encode()
            info = tarfile.TarInfo('manifest.json')
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))

        print('docker load 导入…')
        subprocess.run(['docker', 'load', '-i', out_path], check=True)
        print(f'✓ 完成: {LOCAL_NAME}')
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
