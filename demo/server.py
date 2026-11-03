#!/usr/bin/env python3
"""本地测试服务器(纯 stdlib)。

两个角色:
  python3 demo/server.py            # 应用演示页,端口 8123(提供 /api/* 与静态页)
  python3 demo/server.py redmine    # 假 Redmine,端口 8124(REST API 足够插件联调)

假 Redmine 会把收到的 issue / 附件写到 demo/.fake-redmine/ 下,便于验证。
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEMO_DIR = Path(__file__).resolve().parent
FAKE_STORE = DEMO_DIR / ".fake-redmine"

BOOKS = [{"title": "三体", "category": "sci-fi"}, {"title": "代码整洁之道", "category": "tech"}]
SESSIONS = set()


class AppHandler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self):
        if self.path == "/api/books":
            return self._json(200, {"books": BOOKS})
        if self.path.startswith("/api/"):
            return self._json(404, {"message": "not found"})
        # 静态文件(仅限 demo 目录)
        from urllib.parse import unquote

        name = "index.html" if self.path == "/" else unquote(self.path.split("?")[0].lstrip("/"))
        f = (DEMO_DIR / name).resolve()
        if f.is_file() and str(f).startswith(str(DEMO_DIR)):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(f.stat().st_size))
            self.end_headers()
            self.wfile.write(f.read_bytes())
        else:
            self.send_error(404)

    def do_POST(self):
        data = self._body()
        if self.path == "/api/login":
            if data.get("username") == "demo" and data.get("password") == "demo123":
                SESSIONS.add("token-demo")
                return self._json(200, {"ok": True, "token": "token-demo"})
            return self._json(401, {"message": "用户名或密码错误(提示: demo/demo123)"})
        if self.path == "/api/books":
            BOOKS.append({"title": data.get("title", ""), "category": data.get("category", "")})
            return self._json(200, {"ok": True})
        if self.path == "/api/books/delete":
            BOOKS[:] = [b for b in BOOKS if b["title"] != data.get("title")]
            return self._json(200, {"ok": True})
        if self.path == "/api/fail":
            return self._json(500, {"message": "Internal Server Error: 库存服务连接超时 (mock)"})
        return self._json(404, {"message": "not found"})

    def log_message(self, fmt, *args):  # noqa: N802
        print(f"[app] {self.address_string()} {fmt % args}", flush=True)


class FakeRedmineHandler(BaseHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        key = self.headers.get("X-Redmine-API-Key")
        if key != "test-key":
            self._json(401, {"errors": ["API key 无效(测试环境请填 test-key)"]})
            return False
        return True

    def _save(self, name, data):
        FAKE_STORE.mkdir(parents=True, exist_ok=True)
        (FAKE_STORE / name).write_bytes(data if isinstance(data, bytes) else data.encode("utf-8"))

    def do_GET(self):
        if self.path.startswith("/users/current.json"):
            if not self._authed():
                return
            return self._json(200, {"user": {"login": "tester", "firstname": "测", "lastname": "试员"}})
        if self.path.startswith("/projects.json"):
            return self._json(
                200,
                {"projects": [{"id": 1, "name": "演示项目"}, {"id": 2, "name": "先锋园区"}]},
            )
        if self.path.startswith("/trackers.json"):
            return self._json(200, {"trackers": [{"id": 1, "name": "Bug"}, {"id": 2, "name": "功能"}]})
        if self.path.startswith("/enumerations/issue_priorities.json"):
            return self._json(
                200,
                {"issue_priorities": [{"id": 1, "name": "低"}, {"id": 2, "name": "正常"}, {"id": 3, "name": "高"}]},
            )
        return self._json(404, {"errors": ["not found"]})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n)
        path_only = self.path.split("?", 1)[0]
        if path_only in ("/uploads.json", "/uploads"):
            if not self._authed():
                return
            # filename 参数
            fname = "upload.bin"
            for part in self.path.split("?")[-1].split("&"):
                if part.startswith("filename="):
                    from urllib.parse import unquote

                    fname = unquote(part.split("=", 1)[1])
            FAKE_STORE.mkdir(parents=True, exist_ok=True)
            (FAKE_STORE / fname).write_bytes(raw)
            print(f"[fake-redmine] 收到附件 {fname} ({len(raw)} bytes)", flush=True)
            return self._json(201, {"upload": {"id": 1, "token": "1.abcdef123456"}})
        if self.path.startswith("/issues.json"):
            if not self._authed():
                return
            try:
                payload = json.loads(raw.decode("utf-8"))
            except Exception:
                return self._json(422, {"errors": ["无效 JSON"]})
            issue = payload.get("issue", {})
            ups = issue.get("uploads", [])
            issue["id"] = 101
            self._save("last-issue.json", json.dumps(payload, ensure_ascii=False, indent=2))
            print(
                f"[fake-redmine] 创建 issue #101 「{issue.get('subject')}」 "
                f"project={issue.get('project_id')} tracker={issue.get('tracker_id')} "
                f"priority={issue.get('priority_id')} 附件 {len(ups)} 个, 描述 {len(issue.get('description', ''))} 字符",
                flush=True,
            )
            return self._json(201, {"issue": {"id": 101}})
        return self._json(404, {"errors": ["not found"]})

    def log_message(self, fmt, *args):  # noqa: N802
        print(f"[fake-redmine] {fmt % args}", flush=True)


def main():
    role = sys.argv[1] if len(sys.argv) > 1 else "app"
    if role == "redmine":
        server = ThreadingHTTPServer(("127.0.0.1", 8124), FakeRedmineHandler)
        print("[fake-redmine] http://127.0.0.1:8124  (API Key: test-key)", flush=True)
    else:
        server = ThreadingHTTPServer(("127.0.0.1", 8123), AppHandler)
        print("[app] http://127.0.0.1:8123  (演示应用,登录 demo/demo123)", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
