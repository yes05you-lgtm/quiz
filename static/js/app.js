/**
 * AI Quiz Generator - 프론트엔드 로직 (app.js)
 */

document.addEventListener("DOMContentLoaded", () => {
    // DOM 요소 캐싱
    const quizForm = document.getElementById("quiz-form");
    const fileInput = document.getElementById("pdf_file");
    const dropzone = document.getElementById("dropzone");
    const fileInfo = document.getElementById("file-info");
    const fileNameSpan = document.getElementById("file-name");
    const btnRemoveFile = document.getElementById("btn-remove-file");

    const submitBtn = document.getElementById("submit-btn");
    const btnText = submitBtn.querySelector(".btn-text");
    const spinner = document.getElementById("spinner");

    const errorBox = document.getElementById("error-box");
    const errorMessage = document.getElementById("error-message");

    const emptyState = document.getElementById("empty-state");
    const loadingState = document.getElementById("loading-state");
    const quizResult = document.getElementById("quiz-result");
    const resultActions = document.getElementById("result-actions");
    const copyBtn = document.getElementById("copy-btn");
    const downloadPdfBtn = document.getElementById("download-pdf-btn");

    // 최신 생성된 원본 Markdown 텍스트 저장용 변수
    let currentMarkdownText = "";

    // -------------------------------------------------------------------------
    // 1. 파일 선택 및 드래그 앤 드롭 이벤트 핸들러
    // -------------------------------------------------------------------------
    function handleFileSelected(file) {
        if (!file) return;

        // 확장자 검사
        if (!file.name.toLowerCase().endsWith(".pdf")) {
            showError("PDF 파일만 업로드할 수 있습니다.");
            clearFile();
            return;
        }

        // 파일 크기 검사 (최대 16MB)
        const maxSize = 16 * 1024 * 1024;
        if (file.size > maxSize) {
            showError("파일 크기가 16MB를 초과합니다. 더 작은 PDF를 업로드해 주세요.");
            clearFile();
            return;
        }

        hideError();
        fileNameSpan.textContent = `${file.name} (${formatBytes(file.size)})`;
        fileInfo.classList.remove("hidden");
        dropzone.classList.add("hidden");
    }

    function clearFile() {
        fileInput.value = "";
        fileNameSpan.textContent = "";
        fileInfo.classList.add("hidden");
        dropzone.classList.remove("hidden");
    }

    fileInput.addEventListener("change", (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFileSelected(e.target.files[0]);
        }
    });

    btnRemoveFile.addEventListener("click", () => {
        clearFile();
    });

    // 드래그 앤 드롭 효과
    ["dragenter", "dragover"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add("dragover");
        });
    });

    ["dragleave", "drop"].forEach((eventName) => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove("dragover");
        });
    });

    dropzone.addEventListener("drop", (e) => {
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            fileInput.files = e.dataTransfer.files;
            handleFileSelected(e.dataTransfer.files[0]);
        }
    });

    // -------------------------------------------------------------------------
    // 2. 폼 제출 및 /generate API 호출
    // -------------------------------------------------------------------------
    quizForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideError();

        // 프론트엔드 1차 유효성 검사
        const file = fileInput.files[0];
        if (!file) {
            showError("PDF 파일을 업로드해 주세요.");
            return;
        }

        const numQuestionsInput = document.getElementById("num_questions");
        const numQuestions = parseInt(numQuestionsInput.value, 10);
        if (isNaN(numQuestions) || numQuestions < 1 || numQuestions > 30) {
            showError("문항 수는 1 이상 30 이하의 숫자로 입력해 주세요.");
            numQuestionsInput.focus();
            return;
        }

        // UI 로딩 상태 전환
        setLoading(true);

        const formData = new FormData(quizForm);

        try {
            const response = await fetch("/generate", {
                method: "POST",
                body: formData
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                const errorMsg = data.error || `서버 오류가 발생했습니다. (상태 코드: ${response.status})`;
                showError(errorMsg);
                showEmptyState();
                return;
            }

            // 성공 시 결과 렌더링
            currentMarkdownText = data.quiz;
            renderQuizResult(currentMarkdownText);

        } catch (err) {
            console.error("퀴즈 생성 요청 실패:", err);
            showError("네트워크 오류 또는 서버 응답 실패가 발생했습니다. 인터넷 연결을 확인해 주세요.");
            showEmptyState();
        } finally {
            setLoading(false);
        }
    });

    // -------------------------------------------------------------------------
    // 3. 결과 렌더링 및 상태 제어 함수
    // -------------------------------------------------------------------------
    function renderQuizResult(markdownText) {
        emptyState.classList.add("hidden");
        loadingState.classList.add("hidden");

        // marked.js 라이브러리를 통해 Markdown을 HTML로 파싱
        if (window.marked && typeof window.marked.parse === "function") {
            quizResult.innerHTML = window.marked.parse(markdownText);
        } else {
            // fallback: 일반 텍스트 보존 표시
            quizResult.innerHTML = `<pre style="white-space: pre-wrap;">${escapeHtml(markdownText)}</pre>`;
        }

        quizResult.classList.remove("hidden");
        resultActions.style.display = "flex";

        // 모바일 사용자를 위해 결과창으로 부드럽게 스크롤
        if (window.innerWidth <= 900) {
            document.getElementById("result-section").scrollIntoView({ behavior: "smooth" });
        }
    }

    function setLoading(isLoading) {
        if (isLoading) {
            submitBtn.disabled = true;
            btnText.textContent = "AI 퀴즈 생성 중...";
            spinner.classList.remove("hidden");

            emptyState.classList.add("hidden");
            quizResult.classList.add("hidden");
            resultActions.style.display = "none";
            loadingState.classList.remove("hidden");
        } else {
            submitBtn.disabled = false;
            btnText.textContent = "AI 퀴즈 생성하기";
            spinner.classList.add("hidden");
            loadingState.classList.add("hidden");
        }
    }

    function showEmptyState() {
        emptyState.classList.remove("hidden");
        loadingState.classList.add("hidden");
        quizResult.classList.add("hidden");
        resultActions.style.display = "none";
    }

    function showError(msg) {
        errorMessage.textContent = msg;
        errorBox.classList.remove("hidden");
        errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function hideError() {
        errorMessage.textContent = "";
        errorBox.classList.add("hidden");
    }

    // -------------------------------------------------------------------------
    // 4. 결과 복사 및 Markdown 다운로드 기능
    // -------------------------------------------------------------------------
    copyBtn.addEventListener("click", async () => {
        if (!currentMarkdownText) return;

        try {
            await navigator.clipboard.writeText(currentMarkdownText);
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = "✅ 복사 완료!";
            copyBtn.disabled = true;

            setTimeout(() => {
                copyBtn.innerHTML = originalText;
                copyBtn.disabled = false;
            }, 2000);
        } catch (err) {
            console.error("클립보드 복사 실패:", err);
            alert("클립보드 복사에 실패했습니다. 권한을 확인해 주세요.");
        }
    });

    downloadPdfBtn.addEventListener("click", async () => {
        if (!currentMarkdownText) return;

        // 원본 Markdown을 파싱하여 임시 DOM 객체 생성
        const tempDiv = document.createElement("div");
        if (window.marked && typeof window.marked.parse === "function") {
            tempDiv.innerHTML = window.marked.parse(currentMarkdownText);
        } else {
            tempDiv.innerHTML = `<p>${escapeHtml(currentMarkdownText)}</p>`;
        }

        // 1. PDF 출력 전용 컨테이너 생성
        const pdfContainer = document.createElement("div");
        pdfContainer.className = "pdf-export-container";

        // 시험지 상단 헤더 및 수험자 정보 테이블 추가
        const dateStr = new Date().toISOString().slice(0, 10);
        const headerDiv = document.createElement("div");
        headerDiv.className = "pdf-header";
        headerDiv.innerHTML = `
            <h1>AI 맞춤형 퀴즈 평가 시험지</h1>
            <table class="pdf-meta-table">
                <tr>
                    <td style="width: 25%;"><b>시험 일자</b></td>
                    <td style="width: 25%;">${dateStr}</td>
                    <td style="width: 25%;"><b>수험 번호</b></td>
                    <td style="width: 25%;"></td>
                </tr>
                <tr>
                    <td><b>성 명</b></td>
                    <td></td>
                    <td><b>득 점</b></td>
                    <td><b>/ 100</b></td>
                </tr>
            </table>
        `;
        pdfContainer.appendChild(headerDiv);

        // 2. 문제를 개별 블록으로 묶고 '정답 및 해설(<details>)'은 완벽히 제거
        let currentBlock = null;

        Array.from(tempDiv.children).forEach((child) => {
            const tagName = child.tagName.toUpperCase();

            // <details>, <summary> 태그(정답 및 해설)는 PDF에서 완전히 제외
            if (tagName === "DETAILS" || tagName === "SUMMARY") {
                return;
            }

            // <hr> 태그도 블록 디자인으로 구분되므로 제외
            if (tagName === "HR") {
                return;
            }

            // 새로운 문제 제목(H3, H2 등)을 만나면 새로운 문제 블록 생성
            if (tagName === "H3" || tagName === "H2") {
                currentBlock = document.createElement("div");
                currentBlock.className = "pdf-question-block";
                pdfContainer.appendChild(currentBlock);
            }

            // 첫 문제 제목 이전의 일반 텍스트가 있을 경우 블록 생성
            if (!currentBlock) {
                currentBlock = document.createElement("div");
                currentBlock.className = "pdf-question-block";
                pdfContainer.appendChild(currentBlock);
            }

            // 현재 문제 블록에 자식 노드 추가
            currentBlock.appendChild(child.cloneNode(true));
        });

        // 3. 버튼 로딩 상태 표시 및 PDF 생성
        const originalBtnHtml = downloadPdfBtn.innerHTML;
        downloadPdfBtn.innerHTML = "⏳ PDF 생성 중...";
        downloadPdfBtn.disabled = true;

        const opt = {
            margin: [12, 12, 12, 12],
            filename: `AI_Quiz_Exam_${dateStr}.pdf`,
            image: { type: "jpeg", quality: 0.98 },
            html2canvas: { scale: 2, useCORS: true, letterRendering: true },
            jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
            // 문제 블록이 중간에 끊어지지 않도록 설정
            pagebreak: { mode: ["avoid-all", "css", "legacy"] }
        };

        try {
            if (window.html2pdf) {
                await window.html2pdf().set(opt).from(pdfContainer).save();
            } else {
                alert("PDF 변환 라이브러리를 불러오지 못했습니다. 페이지를 새로고침 후 다시 시도해 주세요.");
            }
        } catch (err) {
            console.error("PDF 생성 오류:", err);
            alert("PDF 파일 생성 중 오류가 발생했습니다: " + err.message);
        } finally {
            downloadPdfBtn.innerHTML = originalBtnHtml;
            downloadPdfBtn.disabled = false;
        }
    });

    // -------------------------------------------------------------------------
    // 5. 유틸리티 헬퍼 함수
    // -------------------------------------------------------------------------
    function formatBytes(bytes) {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    }

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    // -------------------------------------------------------------------------
    // 6. PWA 서비스 워커(Service Worker) 등록
    // -------------------------------------------------------------------------
    if ("serviceWorker" in navigator) {
        window.addEventListener("load", () => {
            navigator.serviceWorker.register("/sw.js")
                .then((reg) => {
                    console.log("[PWA] Service Worker 등록 완료. Scope:", reg.scope);
                })
                .catch((err) => {
                    console.warn("[PWA] Service Worker 등록 실패:", err);
                });
        });
    }
});
