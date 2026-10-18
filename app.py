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


@app.errorhandler(413)
def request_entity_too_large(error):
    return jsonify({
        "success": False,
        "error": "업로드한 파일 용량이 너무 큽니다. 더 작은 PDF를 업로드해 주세요."
    }), 413


@app.errorhandler(500)
def internal_server_error(error):
    return jsonify({
        "success": False,
        "error": "서버 내부 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    }), 500


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

[객관식 보기 출력 필수 규칙 - 줄글 나열 절대 금지]
- 문제 유형이 객관식인 경우, 보기 ①, ②, ③, ④, ⑤는 반드시 한 줄에 하나씩 개별 줄로 줄바꿈하여 작성하세요.
- 여러 보기를 줄글 형태로 한 줄에 이어서 쓰는 것을 엄격히 금지합니다.
- 각 보기는 반드시 줄의 맨 왼쪽에서 원문자 번호(①, ②, ③, ④, ⑤)로 시작해야 합니다.
  올바른 작성 형식:
  ### 문제 1. [문제 질문]
  ① [첫 번째 보기 내용]
  ② [두 번째 보기 내용]
  ③ [세 번째 보기 내용]
  ④ [네 번째 보기 내용]
  ⑤ [다섯 번째 보기 내용]

[<보기>, <예시>, 지문 출력 및 배치 필수 규칙]
- 문제에 <보기>, <예시>, [지문], <사례> 등이 있는 경우, 반드시 [문제 질문]이 끝난 다음(선택지 ①~⑤가 나오기 직전)에 배치해야 합니다.
- 절대 문제 질문 앞에 쓰거나 질문 제목 안에 넣지 마세요.
- 코드 블록(```)을 사용하지 말고 반드시 다음과 같이 작성하세요:
<div class="quiz-passage-box">
<b>&lt;보기&gt;</b>
ㄱ. [내용 1]
ㄴ. [내용 2]
ㄷ. [내용 3]
</div>

[정답 및 해설 출력 필수 규칙 - 대괄호 포맷 및 정답 형광펜 마킹]
- 해설은 반드시 모든 보기(①, ②, ③, ④, ⑤)에 대해 각각 작성하되, 다른 군더더기 없이 오직 '[ 번호 : 해설 내용 ]' 형식으로만 작성하세요.
- 그중 정답인 번호의 항목은 대괄호 문장 전체를 <mark class="highlight-answer">[ 번호 : 정답 해설 내용 ]</mark> 태그로 감싸서 작성하세요.
- 오답인 보기들은 일반 텍스트 '[ 번호 : 오답 해설 내용 ]'으로 작성하세요.

[문항별 출력 형식 필수 요구사항]
각 문제는 아래 형식을 엄격히 지켜 작성해 주세요.

### 문제 [번호]. [문제 질문]
(문제에 <보기>나 <예시>가 있는 경우, 반드시 질문이 끝난 바로 다음 여기에 <div class="quiz-passage-box">...</div> 배치)
(그 다음 객관식인 경우 ①~⑤ 보기를 한 줄씩 줄바꿈하여 왼쪽 정렬로 나열)
(문제 유형이 주관식/서술형인 경우 답변 작성 가이드 명시)

<details>
<summary><b>정답 및 해설 보기 (클릭)</b></summary>

[ ① : 1번 보기 해설: 본문 내용에 근거한 상세 설명 ]
[ ② : 2번 보기 해설: 본문 내용에 근거한 상세 설명 ]
<mark class="highlight-answer">[ ③ : 3번 정답 보기 해설: 본문 근거에 따라 왜 정답인지 상세 설명 ]</mark>
[ ④ : 4번 보기 해설: 본문 내용에 근거한 상세 설명 ]
[ ⑤ : 5번 보기 해설: 본문 내용에 근거한 상세 설명 ]
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
