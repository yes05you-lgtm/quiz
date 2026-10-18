# 📚 AI Quiz Generator (PDF 맞춤형 AI 퀴즈 생성기)

사용자가 PDF 문서를 업로드하면 최신 **Google Gemini API**가 문서의 핵심 내용을 분석하여 맞춤형 퀴즈와 상세한 정답/해설을 자동으로 생성해 주는 풀스택 웹 애플리케이션입니다.

생성된 퀴즈는 웹 화면에서 바로 확인하고 복사할 수 있으며, 정답 및 해설이 제외된 **수험용 PDF 시험지**로 바로 다운로드하여 인쇄하거나 시험에 활용할 수 있습니다.

---

## 🌟 주요 기능 (Key Features)

1. **다중 PDF 문서 업로드 및 자동 텍스트 추출 (최대 5개)**
   - Drag & Drop 또는 파일 탐색기를 통해 **최대 5개의 PDF 파일** 동시 업로드 및 개별 삭제 지원 (파일당 최대 16MB)
   - 여러 문서의 내용을 종합적으로 분석하여 균형 잡힌 퀴즈 출제
   - `pypdf`를 이용해 문서 내 텍스트를 메모리 상에서 안전하게 추출 및 전처리

2. **다양한 문제 유형 및 난이도 설정**
   - **문제 유형**: 객관식(4지선다), 객관식(5지선다), 주관식(단답형), 서술형
   - **난이도**: 쉬움 (기본 개념), 보통 (응용 및 이해), 어려움 (심층 분석 및 복합)
   - **문항 수**: 1개부터 최대 30개까지 자유롭게 지정

3. **Google Gemini 최신 AI 모델 연동**
   - 체계적인 프롬프트 엔지니어링을 적용하여 고품질 문제 및 근거 중심의 상세 해설 생성
   - 빠른 응답 속도와 우수한 한국어 처리 능력을 가진 `gemini-3.8-flash` 활용

4. **학습자 친화적인 인터랙티브 UI**
   - 정답 및 해설은 `<details>` 아코디언으로 숨김 처리하여 자가 학습에 최적화
   - 원클릭 클립보드 텍스트 복사 기능

5. **인쇄용 PDF 시험지 다운로드 기능**
   - 학생 또는 수험생 배포용으로 **정답 및 해설을 자동으로 제외**
   - 상단에 **[시험 일자 / 수험 번호 / 성명 / 득점란]**이 포함된 정규 시험지 양식 적용
   - `page-break-inside: avoid` 인쇄 규칙을 적용하여 문제가 페이지 중간에서 끊기지 않도록 깔끔한 블록 배치

6. **철저한 보안 및 로깅**
   - Gemini API Key는 `.env` 파일에서만 로드하며 Git 저장소 추적에서 원천 제외
   - 백엔드 콘솔에 요청 파라미터, PDF 파싱 결과, API 상태 및 에러 로그 상세 출력

---

## 🛠 기술 스택 (Tech Stack)

### Backend
- **Language**: Python 3.14+
- **Framework**: Flask 3.1+
- **AI SDK**: Google GenAI SDK (`google-genai`)
- **PDF Parser**: `pypdf`
- **Config**: `python-dotenv`

### Frontend
- **Core**: Semantic HTML5, Modern CSS3 (Grid/Flexbox, CSS Variables), Vanilla JavaScript (ES6+)
- **Libraries**:
  - [marked.js](https://marked.js.org/) (Markdown ➔ HTML 실시간 렌더링)
  - [html2pdf.js](https://ekoopmans.github.io/html2pdf.js/) (클라이언트 사이드 고품질 PDF 변환 및 다운로드)

---

## 📂 프로젝트 구조 (Directory Structure)

```text
quiz/
├── app.py                  # Flask 백엔드 서버 및 Gemini API 라우트
├── requirements.txt        # 프로젝트 필수 패키지 목록
├── .env                    # 비밀 API Key 보관 (Git 제외)
├── .env.example            # 환경변수 템플릿 파일
├── .gitignore              # Git 추적 제외 파일 목록
├── README.md               # 프로젝트 설명서
├── templates/
│   └── index.html          # 메인 UI 템플릿
└── static/
    ├── css/
    │   └── style.css       # 반응형 레이아웃 및 시험지 인쇄 스타일
    └── js/
        └── app.js          # 비동기 통신, 유효성 검사, PDF 생성 로직
```

---

## 🚀 시작하기 (Getting Started)

### 1. 저장소 클론 (Clone Repository)

```powershell
git clone https://github.com/yes05you-lgtm/quiz.git
cd quiz
```

### 2. 가상환경 생성 및 활성화

```powershell
# 가상환경 생성
py -m venv venv

# 가상환경 활성화 (Windows PowerShell 기준)
.\venv\Scripts\Activate.ps1
```

### 3. 패키지 설치

```powershell
py -m pip install -r requirements.txt
```

### 4. 환경변수 설정 (`.env`)

1. `.env.example` 파일을 복사하여 `.env` 파일을 만듭니다:
   ```powershell
   cp .env.example .env
   ```
2. [Google AI Studio](https://aistudio.google.com/app/apikey)에서 발급받은 실제 Gemini API Key를 입력합니다:
   ```env
   GEMINI_API_KEY=AIzaSy...여기에_발급받은_키_입력
   FLASK_SECRET_KEY=quiz-secret-key-12345
   ```

### 5. 서버 실행

```powershell
py app.py
```

브라우저에서 **`http://127.0.0.1:5000`** 으로 접속하여 애플리케이션을 사용합니다.

---

## 📖 사용 방법 (How to Use)

1. **PDF 파일 선택**: 공부하고 싶은 교재, 요약본, 논문 등의 PDF 파일을 업로드합니다.
2. **옵션 선택**: 원하는 문제 유형(객관식 4지/5지, 주관식, 서술형), 난이도, 문항 수를 선택합니다.
3. **[AI 퀴즈 생성하기]** 버튼 클릭: AI가 문서를 분석하고 문제를 출제합니다.
4. **퀴즈 풀이**: 우측 영역에서 문제를 풀고, 정답이 궁금할 때는 **'정답 및 해설 보기'**를 클릭하여 확인합니다.
5. **시험지 다운로드**: **`📄 PDF 시험지 다운로드`** 버튼을 누르면 정답이 제외된 인쇄용 시험지를 다운로드할 수 있습니다.

---

## 🔒 라이선스 및 보안 안내 (Security)

- 본 프로젝트의 API Key는 서버 환경변수(`.env`)로만 엄격히 관리되며, 절대 프론트엔드로 노출되거나 Git 저장소에 커밋되지 않습니다.
