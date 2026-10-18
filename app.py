import os
import logging
from io import BytesIO
from flask import Flask, render_template, request, jsonify, send_from_directory, make_response
from dotenv import load_dotenv
from pypdf import PdfReader
from google import genai

# .env 환경변수 로드
load_dotenv()

# 로깅 설정 (백엔드 로그: 요청, 응답, 오류 출력)
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s in %(module)s: %(message)s"
)
logger = logging.getLogger(__name__)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, "templates"),
    static_folder=os.path.join(BASE_DIR, "static")
)
app.config["SECRET_KEY"] = os.getenv("FLASK_SECRET_KEY", "default-dev-secret-key")
# 업로드 용량 제한 (최대 16MB)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024

# 허용된 문제 유형 및 난이도 목록
ALLOWED_QUIZ_TYPES = {
    "multiple_choice_4": "객관식 (4지선다)",
    "multiple_choice_5": "객관식 (5지선다)",
    "short_answer": "주관식 (단답형)",
    "descriptive": "서술형"
}
ALLOWED_DIFFICULTIES = {
    "easy": "쉬움",
    "medium": "보통",
    "hard": "어려움"
}


@app.route("/")
@app.route("/api/index")
@app.route("/api/index.py")
def index():
    """메인 페이지 라우트"""
    return render_template("index.html")


@app.route("/manifest.json")
def manifest():
    """PWA 매니페스트 서빙 라우트"""
    return send_from_directory("static", "manifest.json", mimetype="application/manifest+json")


@app.route("/sw.js")
def service_worker():
    """PWA 서비스 워커 서빙 라우트 (루트 스코프 허용 헤더 포함)"""
    response = make_response(send_from_directory("static", "sw.js"))
    response.headers["Content-Type"] = "application/javascript"
    response.headers["Service-Worker-Allowed"] = "/"
    return response


@app.route("/generate", methods=["POST"])
def generate_quiz():
    """PDF 파일과 퀴즈 옵션을 받아 Gemini API로 퀴즈를 생성하는 REST API 라우트"""
    logger.info("=== 퀴즈 생성 요청 수신 ===")

    # 1. API 키 확인 (.env에서만 읽기)
    load_dotenv(override=True)
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "YOUR_GEMINI_API_KEY_HERE" or api_key.strip() == "":
        logger.error("오류: GEMINI_API_KEY가 .env 파일에 설정되지 않았습니다.")
        return jsonify({
            "success": False,
            "error": ".env 파일에 유효한 GEMINI_API_KEY가 설정되지 않았습니다. API 키를 등록 후 다시 시도해주세요."
        }), 500

    # 2. 파일 업로드 검증
    if "pdf_file" not in request.files:
        logger.warning("검증 실패: 업로드된 파일이 없습니다.")
        return jsonify({"success": False, "error": "PDF 파일을 선택해 주세요."}), 400

    file = request.files["pdf_file"]
    if file.filename == "":
        logger.warning("검증 실패: 파일 이름이 비어 있습니다.")
        return jsonify({"success": False, "error": "선택된 파일이 없습니다."}), 400

    if not file.filename.lower().endswith(".pdf"):
        logger.warning(f"검증 실패: 지원되지 않는 파일 형식 ({file.filename})")
        return jsonify({"success": False, "error": "PDF 파일만 업로드할 수 있습니다."}), 400

    # 3. 폼 필드 입력 검증
    quiz_type_key = request.form.get("quiz_type", "").strip()
    difficulty_key = request.form.get("difficulty", "").strip()
    num_questions_raw = request.form.get("num_questions", "").strip()

    if quiz_type_key not in ALLOWED_QUIZ_TYPES:
        logger.warning(f"검증 실패: 올바르지 않은 문제 유형 ({quiz_type_key})")
        return jsonify({"success": False, "error": "올바른 문제 유형을 선택해 주세요."}), 400

    if difficulty_key not in ALLOWED_DIFFICULTIES:
        logger.warning(f"검증 실패: 올바르지 않은 난이도 ({difficulty_key})")
        return jsonify({"success": False, "error": "올바른 난이도를 선택해 주세요."}), 400

    try:
        num_questions = int(num_questions_raw)
        if not (1 <= num_questions <= 30):
            raise ValueError()
    except (ValueError, TypeError):
        logger.warning(f"검증 실패: 올바르지 않은 문항 수 ({num_questions_raw})")
        return jsonify({"success": False, "error": "문항 수는 1 이상 30 이하의 정수를 입력해 주세요."}), 400

    quiz_type_label = ALLOWED_QUIZ_TYPES[quiz_type_key]
    difficulty_label = ALLOWED_DIFFICULTIES[difficulty_key]

    logger.info(f"요청 파라미터 - 파일명: {file.filename}, 유형: {quiz_type_label}, 난이도: {difficulty_label}, 문항수: {num_questions}")

    # 4. PDF 텍스트 추출
    try:
        pdf_bytes = file.read()
        pdf_reader = PdfReader(BytesIO(pdf_bytes))
        total_pages = len(pdf_reader.pages)
        extracted_text = ""

        for page_idx, page in enumerate(pdf_reader.pages):
            page_text = page.extract_text()
            if page_text:
                extracted_text += page_text + "\n"

        extracted_text = extracted_text.strip()
        logger.info(f"PDF 파싱 완료: 총 {total_pages}페이지, 추출 텍스트 길이: {len(extracted_text)}자")

        if not extracted_text or len(extracted_text) < 30:
            logger.warning("검증 실패: PDF에서 추출된 텍스트가 없거나 너무 적습니다.")
            return jsonify({
                "success": False,
                "error": "PDF 파일에서 텍스트를 추출할 수 없습니다. 스캔 이미지 전용 PDF가 아닌 텍스트가 포함된 PDF인지 확인해 주세요."
            }), 400

    except Exception as e:
        logger.error(f"PDF 파싱 중 오류 발생: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": f"PDF 파일을 읽는 도중 오류가 발생했습니다: {str(e)}"}), 500

    # 5. 프롬프트 엔지니어링
    # 텍스트가 너무 길 경우 앞부분 약 30,000자까지 활용
    max_context_chars = 30000
    if len(extracted_text) > max_context_chars:
        logger.info(f"PDF 텍스트가 길어 상위 {max_context_chars}자만 프롬프트에 포함합니다.")
        context_text = extracted_text[:max_context_chars] + "\n...(이하 생략)..."
    else:
        context_text = extracted_text

    system_instruction = (
        "당신은 시험 문제 출제 전문 교수이자 수능 출제위원급 AI 전문가입니다. "
        "제공된 본문 내용을 면밀히 분석하여 핵심 개념을 평가할 수 있는 고품질 퀴즈를 한국어로 제작하세요."
    )

    prompt = f"""[출제 지침]
- 본문 내용을 바탕으로 다음 조건에 정확히 맞춰 퀴즈를 생성하세요.
- 문제 유형: {quiz_type_label}
- 난이도: {difficulty_label}
- 문항 수: 총 {num_questions}문제
- 언어: 한국어
- 출력 포맷: 깔끔하고 가독성 높은 Markdown 문법 사용

[문항별 출력 형식 필수 요구사항]
각 문제는 아래 형식을 엄격히 지켜 작성해 주세요.

### 문제 [번호]. [문제 질문]
(문제 유형이 객관식인 경우 각 보기를 ①, ②, ③, ④, ⑤ 형식으로 줄바꿈하여 나열)
(문제 유형이 주관식/서술형인 경우 답변 작성 가이드 명시)

<details>
<summary><b>정답 및 해설 보기 (클릭)</b></summary>

- **정답**: [명확한 정답 표기]
- **해설**: [해당 답이 정답인 이유와 본문 근거 상세 설명]
</details>

---

[본문 내용]
{context_text}
"""

    # 6. Gemini API 호출
    try:
        logger.info("Gemini API 호출 시작 (모델: gemini-3.8-flash)...")
        client = genai.Client(api_key=api_key)

        response = client.models.generate_content(
            model="gemini-3.8-flash",
            contents=prompt,
            config={
                "system_instruction": system_instruction,
                "temperature": 0.4
            }
        )

        generated_quiz = response.text
        if not generated_quiz:
            raise ValueError("Gemini API에서 빈 응답이 반환되었습니다.")

        logger.info(f"Gemini API 응답 성공 (생성된 글자수: {len(generated_quiz)}자)")
        return jsonify({
            "success": True,
            "quiz": generated_quiz
        })

    except Exception as e:
        logger.error(f"Gemini API 호출 중 오류 발생: {str(e)}", exc_info=True)
        return jsonify({
            "success": False,
            "error": f"AI 퀴즈 생성 중 오류가 발생했습니다: {str(e)}"
        }), 500


if __name__ == "__main__":
    logger.info("Flask 개발 서버 시작: http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
