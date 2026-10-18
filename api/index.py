import os
import sys

# Vercel Serverless 실행 환경에서 루트 디렉터리의 모듈(app.py)을 인식할 수 있도록 sys.path 추가
current_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(current_dir)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from app import app

# Vercel 서버리스 환경에서 PATH_INFO가 /api/index 또는 /api/index.py로 전달되는 문제를 보정하는 WSGI 미들웨어
class VercelPathFixMiddleware:
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO", "")
        for prefix in ["/api/index.py", "/api/index"]:
            if path.startswith(prefix):
                environ["PATH_INFO"] = path[len(prefix):] or "/"
                break
        return self.wsgi_app(environ, start_response)

app.wsgi_app = VercelPathFixMiddleware(app.wsgi_app)
handler = app
