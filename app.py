import os
import time
import logging
from io import BytesIO
from flask import Flask, render_template, request, jsonify, send_from_directory, make_response
from dotenv import load_dotenv
from pypdf import PdfReader
from google import genai

# .env 환경변수 로드
load_dotenv()

# Gemini 후보 모델 목록 (트래픽 급증/503 오류 발생 시 자동 폴백)
CANDIDATE_MODELS = [
    "gemini-3.8-flash",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest"
]

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
# 업로드 용량 제한 (최대 5개 파일 고려 50MB)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

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


def generate_quiz_with_fallback(client, prompt, system_instruction):
    """
    503 UNAVAILABLE(트래픽 급증) 또는 429(속도 제한) 발생 시
    자동 재시도 및 차순위 후보 모델로 자동 전환하는 견고한 호출 함수
    """
    last_error = None
    for model_name in CANDIDATE_MODELS:
        for attempt in range(2):
            try:
                logger.info(f"Gemini API 호출 시도 (모델: {model_name}, 시도: {attempt + 1}/2)...")
                response = client.models.generate_content(
                    model=model_name,
                    contents=prompt,
                    config={
                        "system_instruction": system_instruction,
                        "temperature": 0.4
                    }
                )
                generated_quiz = response.text
                if generated_quiz and len(generated_quiz.strip()) > 0:
                    logger.info(f"Gemini API 응답 성공 (모델: {model_name}, 글자수: {len(generated_quiz)}자)")
                    return generated_quiz
                else:
                    logger.warning(f"모델 {model_name}에서 빈 응답이 반환되었습니다.")
            except Exception as e:
                err_str = str(e)
                last_error = e
                is_transient = any(kw in err_str.lower() for kw in ["503", "unavailable", "429", "high demand", "overloaded"])
                logger.warning(f"모델 {model_name} 호출 실패 (시도 {attempt + 1}): {err_str}")
                if is_transient:
                    time.sleep(1.2)
                    continue
                else:
                    break

    if last_error:
        raise last_error
    raise RuntimeError("모든 AI 모델에서 응답을 생성하지 못했습니다.")


@app.route("/generate", methods=["POST"])
def generate_quiz():
    """PDF 파일(최대 5개)과 퀴즈 옵션을 받아 Gemini API로 퀴즈를 생성하는 REST API 라우트"""
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

    # 2. 파일 업로드 검증 (최대 5개 지원)
    uploaded_files = request.files.getlist("pdf_files")
    if not uploaded_files:
        uploaded_files = request.files.getlist("pdf_file")

    valid_files = [f for f in uploaded_files if f and f.filename and f.filename.strip() != ""]

    if not valid_files:
        logger.warning("검증 실패: 업로드된 파일이 없습니다.")
        return jsonify({"success": False, "error": "PDF 파일을 1개 이상 선택해 주세요."}), 400

    if len(valid_files) > 5:
        logger.warning(f"검증 실패: 파일 개수 초과 ({len(valid_files)}개)")
        return jsonify({"success": False, "error": "PDF 파일은 최대 5개까지 업로드할 수 있습니다."}), 400

    for f in valid_files:
        if not f.filename.lower().endswith(".pdf"):
            logger.warning(f"검증 실패: 지원되지 않는 파일 형식 ({f.filename})")
            return jsonify({"success": False, "error": f"'{f.filename}'은(는) PDF 파일이 아닙니다. PDF 파일만 업로드할 수 있습니다."}), 400

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

    file_names = ", ".join(f.filename for f in valid_files)
    logger.info(f"요청 파라미터 - 파일({len(valid_files)}개): [{file_names}], 유형: {quiz_type_label}, 난이도: {difficulty_label}, 문항수: {num_questions}")

    # 4. 각 PDF 텍스트 추출 및 결합
    extracted_docs = []
    total_pages = 0
    total_text_length = 0

    try:
        for idx, f in enumerate(valid_files, 1):
            pdf_bytes = f.read()
            pdf_reader = PdfReader(BytesIO(pdf_bytes))
            file_pages = len(pdf_reader.pages)
            total_pages += file_pages

            doc_text = ""
            for page in pdf_reader.pages:
                page_text = page.extract_text()
                if page_text:
                    doc_text += page_text + "\n"

            doc_text = doc_text.strip()
            if doc_text:
                extracted_docs.append(f"--- [참고 문서 {idx}: {f.filename}] ---\n{doc_text}")
                total_text_length += len(doc_text)
            else:
                logger.warning(f"경고: 파일 '{f.filename}'에서 텍스트가 추출되지 않았습니다.")

        logger.info(f"PDF 파싱 완료: 총 {len(valid_files)}개 파일, {total_pages}페이지, 추출 텍스트 길이: {total_text_length}자")

        if not extracted_docs or total_text_length < 30:
            logger.warning("검증 실패: PDF에서 추출된 텍스트가 없거나 너무 적습니다.")
            return jsonify({
                "success": False,
                "error": "업로드된 PDF 파일에서 유효한 텍스트를 추출할 수 없습니다. 스캔 이미지 전용 PDF가 아닌 텍스트가 포함된 PDF인지 확인해 주세요."
            }), 400

        full_extracted_text = "\n\n".join(extracted_docs)

    except Exception as e:
        logger.error(f"PDF 파싱 중 오류 발생: {str(e)}", exc_info=True)
        return jsonify({"success": False, "error": f"PDF 파일을 읽는 도중 오류가 발생했습니다: {str(e)}"}), 500

    # 5. 프롬프트 엔지니어링
    # 여러 문서 종합을 위해 최대 약 50,000자까지 프롬프트에 활용
    max_context_chars = 50000
    if len(full_extracted_text) > max_context_chars:
        logger.info(f"PDF 텍스트가 길어 상위 {max_context_chars}자만 프롬프트에 포함합니다.")
        context_text = full_extracted_text[:max_context_chars] + "\n...(이하 생략)..."
    else:
        context_text = full_extracted_text

    system_instruction = (
        "당신은 시험 문제 출제 전문 교수이자 수능 출제위원급 AI 전문가입니다. "
        "제공된 본문 내용(여러 PDF 문서가 포함될 수 있음)을 종합적으로 분석하여 핵심 개념을 고르게 평가할 수 있는 고품질 퀴즈를 한국어로 제작하세요."
    )

    prompt = f"""[출제 지침]
- 본문 내용을 바탕으로 다음 조건에 정확히 맞춰 퀴즈를 생성하세요.
- 문제 유형: {quiz_type_label}
- 난이도: {difficulty_label}
- 문항 수: 총 {num_questions}문제
- 언어: 한국어
- 출력 포맷: 깔끔하고 가독성 높은 Markdown 문법 사용

[객관식 선지 필수 규칙 - 줄바꿈 및 왼쪽 정렬]
- 객관식 문제의 선택지 ①, ②, ③, ④, ⑤는 절대로 한 줄에 연달아 이어서 쓰지 마세요.
- 반드시 각 보기 번호 앞에 줄바꿈을 넣어, 모든 보기가 왼쪽 정렬로 한 줄에 하나씩 단독 줄로 출력되도록 하세요.
  예시:
  ### 문제 1. [문제 질문]
  ① [첫 번째 보기 내용]
  ② [두 번째 보기 내용]
  ③ [세 번째 보기 내용]
  ④ [네 번째 보기 내용]
  ⑤ [다섯 번째 보기 내용]

[정답 및 해설 출력 필수 규칙]
- <details> 안에 정답과 해설, 오답 해설을 반드시 아래 형식으로 작성하세요.
- 대괄호([ ])나 HTML 태그, 형광펜 마킹을 사용하지 마세요.
- 첫 줄에 '정답: [번호]', 둘째 줄에 '해설: [본문 근거 상세 설명]', 그 아래에 '오답' 및 각 오답 보기 해설을 작성하세요:

[문항별 출력 형식 필수 요구사항]
각 문제는 아래 형식을 엄격히 지켜 작성해 주세요.

### 문제 [번호]. [문제 질문]
(문제 유형이 객관식인 경우 위 규칙대로 각 보기를 ①, ②, ③, ④, ⑤ 줄바꿈하여 한 줄에 하나씩 나열)
(문제 유형이 주관식/서술형인 경우 답변 작성 가이드 명시)

<details>
<summary><b>정답 및 해설 보기 (클릭)</b></summary>

정답: ④
해설: [왜 정답인지 본문 내용에 근거한 상세 설명]
오답
① : [1번 보기 오답 해설]
② : [2번 보기 오답 해설]
③ : [3번 보기 오답 해설]
⑤ : [5번 보기 오답 해설 (정답 번호를 제외한 나머지 보기들)]
</details>

---

[본문 내용]
{context_text}
"""

    # 6. Gemini API 호출 (다중 후보 모델 폴백 및 자동 재시도)
    try:
        client = genai.Client(api_key=api_key)
        generated_quiz = generate_quiz_with_fallback(client, prompt, system_instruction)

        return jsonify({
            "success": True,
            "quiz": generated_quiz
        })

    except Exception as e:
        err_msg = str(e)
        logger.error(f"Gemini API 호출 중 최종 오류 발생: {err_msg}", exc_info=True)

        if any(kw in err_msg.lower() for kw in ["503", "unavailable", "high demand", "overloaded"]):
            user_error = "Google AI 서버에 일시적인 접속량 급증(503)이 발생했습니다. 10~20초 후 다시 시도해 주세요."
        elif any(kw in err_msg.lower() for kw in ["429", "resource_exhausted"]):
            user_error = "Gemini API 무료 요청 한도를 일시 초과했습니다. 잠시 후 다시 시도해 주세요."
        elif any(kw in err_msg.lower() for kw in ["api_key_invalid", "403"]):
            user_error = "Gemini API 키가 유효하지 않거나 권한이 없습니다. 환경변수 GEMINI_API_KEY를 확인해 주세요."
        else:
            user_error = f"AI 퀴즈 생성 중 오류가 발생했습니다: {err_msg}"

        return jsonify({
            "success": False,
            "error": user_error
        }), 500


if __name__ == "__main__":
    logger.info("Flask 개발 서버 시작: http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
