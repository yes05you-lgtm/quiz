import os
import sys

# Vercel Serverless 실행 환경에서 루트 디렉터리의 모듈(app.py)을 인식할 수 있도록 sys.path 추가
current_dir = os.path.dirname(os.path.abspath(__file__))
root_dir = os.path.dirname(current_dir)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from app import app

# Vercel이 감지하는 WSGI 애플리케이션 핸들러
app = app
