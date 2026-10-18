/**
 * AI Quiz Generator - 프론트엔드 로직 (app.js)
 */

document.addEventListener("DOMContentLoaded", () => {
    // DOM 요소 캐싱
    const quizForm = document.getElementById("quiz-form");
    const fileInput = document.getElementById("pdf_file");
    const dropzone = document.getElementById("dropzone");
    const fileLabelText = document.getElementById("file-label-text");
    const fileListContainer = document.getElementById("file-list-container");
    const fileCountSpan = document.getElementById("file-count");
    const fileListEl = document.getElementById("file-list");
    const btnClearAll = document.getElementById("btn-clear-all");

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
    const copyAnswersBtn = document.getElementById("copy-answers-btn");
    const downloadPdfBtn = document.getElementById("download-pdf-btn");

    // marked.js 줄바꿈 및 GFM 옵션 활성화 (보기가 한 줄로 뭉쳐 나오는 현상 방지)
    if (window.marked && typeof window.marked.setOptions === "function") {
        window.marked.setOptions({
            breaks: true,
            gfm: true
        });
    }

    // 최신 생성된 원본 Markdown 텍스트 저장용 변수
    let currentMarkdownText = "";

    // 업로드할 파일 목록 상태 (최대 5개)
    let selectedFiles = [];
    const MAX_FILES = 5;
    const MAX_FILE_SIZE = 16 * 1024 * 1024; // 16MB

    // -------------------------------------------------------------------------
    // 1. 파일 관리 및 UI 렌더링
    // -------------------------------------------------------------------------
    function handleFilesAdded(incomingFiles) {
        if (!incomingFiles || incomingFiles.length === 0) return;

        hideError();
        const filesToAdd = Array.from(incomingFiles);
        const warningMessages = [];

        for (const file of filesToAdd) {
            // 최대 개수 제한 체크
            if (selectedFiles.length >= MAX_FILES) {
                warningMessages.push(`최대 ${MAX_FILES}개의 파일까지만 등록할 수 있습니다.`);
                break;
            }

            // 확장자 검사
            if (!file.name.toLowerCase().endsWith(".pdf")) {
                warningMessages.push(`'${file.name}'은(는) PDF 파일이 아닙니다.`);
                continue;
            }

            // 파일 크기 검사
            if (file.size > MAX_FILE_SIZE) {
                warningMessages.push(`'${file.name}'의 크기가 16MB를 초과합니다.`);
                continue;
            }

            // 중복 파일 검사 (파일명 및 파일 크기 기준)
            const isDuplicate = selectedFiles.some(
                (f) => f.name === file.name && f.size === file.size
            );
            if (isDuplicate) {
                continue;
            }

            selectedFiles.push(file);
        }

        if (warningMessages.length > 0) {
            showError(warningMessages.join(" "));
        }

        updateFileListUI();
        fileInput.value = ""; // 동일 파일 재선택 허용을 위해 초기화
    }

    function removeFile(index) {
        if (index >= 0 && index < selectedFiles.length) {
            selectedFiles.splice(index, 1);
            hideError();
            updateFileListUI();
        }
    }

    function clearAllFiles() {
        selectedFiles = [];
        hideError();
        updateFileListUI();
    }

    function updateFileListUI() {
        const count = selectedFiles.length;
        fileCountSpan.textContent = count;

        if (count === 0) {
            fileListContainer.classList.add("hidden");
            fileListEl.innerHTML = "";
            dropzone.classList.remove("hidden");
            fileLabelText.textContent = "클릭하여 PDF 파일을 선택하거나 여기로 드래그하세요";
        } else {
            fileListContainer.classList.remove("hidden");
            fileListEl.innerHTML = selectedFiles.map((file, idx) => `
                <li class="file-item">
                    <div class="file-item-info">
                        <span class="file-item-icon">📄</span>
                        <span class="file-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                        <span class="file-item-size">(${formatBytes(file.size)})</span>
                    </div>
                    <button type="button" class="btn-remove-item" data-index="${idx}" title="삭제">✕</button>
                </li>
            `).join("");

            if (count >= MAX_FILES) {
                dropzone.classList.add("hidden");
            } else {
                dropzone.classList.remove("hidden");
                fileLabelText.textContent = `+ 클릭 또는 드래그하여 PDF 파일 추가 (${MAX_FILES - count}개 더 추가 가능)`;
            }
        }
    }

    // 파일 선택(change) 이벤트
    fileInput.addEventListener("change", (e) => {
        handleFilesAdded(e.target.files);
    });

    // 파일 목록 개별 삭제 이벤트 위임
    fileListEl.addEventListener("click", (e) => {
        const removeBtn = e.target.closest(".btn-remove-item");
        if (removeBtn) {
            const index = parseInt(removeBtn.dataset.index, 10);
            if (!isNaN(index)) {
                removeFile(index);
            }
        }
    });

    // 전체 삭제 버튼 이벤트
    btnClearAll.addEventListener("click", () => {
        clearAllFiles();
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
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFilesAdded(e.dataTransfer.files);
        }
    });

    // -------------------------------------------------------------------------
    // 2. 폼 제출 및 /generate API 호출
    // -------------------------------------------------------------------------
    quizForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        hideError();

        // 프론트엔드 1차 유효성 검사
        if (selectedFiles.length === 0) {
            showError("PDF 파일을 1개 이상 업로드해 주세요.");
            return;
        }

        if (selectedFiles.length > MAX_FILES) {
            showError(`최대 ${MAX_FILES}개의 PDF 파일만 업로드할 수 있습니다.`);
            return;
        }

        // 총 파일 용량 체크 (Vercel 서버리스 페이로드 한도: 4.5MB)
        const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);
        const MAX_TOTAL_SIZE = 4.5 * 1024 * 1024; // 4.5MB
        if (totalSize > MAX_TOTAL_SIZE) {
            showError(`선택한 PDF 파일들의 총 용량(${formatBytes(totalSize)})이 서버리스 업로드 한도(4.5MB)를 초과합니다. 4.5MB 이하로 나누거나 압축해 주세요.`);
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
        // 기본 폼 데이터에서 파일 필드 정리 후 선택된 파일 목록 주입
        formData.delete("pdf_files");
        formData.delete("pdf_file");
        selectedFiles.forEach((file) => {
            formData.append("pdf_files", file, file.name);
            formData.append("pdf_file", file, file.name);
        });

        try {
            const response = await fetch("/generate", {
                method: "POST",
                body: formData
            });

            // 응답 헤더 확인: JSON 여부에 따라 안전하게 분기
            let data;
            const contentType = response.headers.get("content-type") || "";

            if (contentType.includes("application/json")) {
                data = await response.json();
            } else {
                // Vercel 타임아웃(504), 용량초과(413) 등 HTML 에러 응답 처리
                const text = await response.text();
                if (response.status === 504) {
                    throw new Error("서버 응답 시간 초과(504 Gateway Timeout). AI 문서 분석에 시간이 초과되었습니다. 문항 수를 줄이거나 PDF 페이지를 줄여 다시 시도해 주세요.");
                } else if (response.status === 413) {
                    throw new Error("업로드 용량 초과(413 Payload Too Large). Vercel 서버리스는 총 4.5MB 이하만 업로드 가능합니다.");
                } else {
                    throw new Error(`서버 응답 오류 (HTTP ${response.status}): ${text.slice(0, 120) || "서버에서 오류가 발생했습니다."}`);
                }
            }

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
            console.error("퀴즈 생성 요청 실패 상세:", err);
            let userMessage = err.message || "알 수 없는 오류가 발생했습니다.";
            if (userMessage.includes("Failed to fetch") || userMessage.includes("NetworkError")) {
                userMessage = "서버와 통신할 수 없습니다. 로컬 서버(python app.py)가 실행 중인지 또는 인터넷 연결을 확인해 주세요.";
            }
            showError(userMessage);
            showEmptyState();
        } finally {
            setLoading(false);
        }
    });

    // -------------------------------------------------------------------------
    // 3. 결과 렌더링 및 객관식/보기 박스 포맷 최적화 함수
    // -------------------------------------------------------------------------
    function formatQuizMarkdown(text) {
        if (!text) return "";

        // 1. 코드 블록(```)으로 감싸진 <보기>, [보기], <예시>, [예시]를 quiz-passage-box로 변환 (폰트 깨짐 및 글씨 잘림 방지)
        let formatted = text.replace(/```(?:text|markdown)?\s*([<\[]?(?:보기|예시|지문|사례)[>\]]?[\s\S]*?)```/gi, (match, p1) => {
            return `<div class="quiz-passage-box">\n${p1.trim()}\n</div>`;
        });

        // 2. HTML 태그 형태 <보기>...</보기>, <예시>...</예시>를 quiz-passage-box로 변환
        formatted = formatted.replace(/<보기>([\s\S]*?)<\/보기>/gi, (match, p1) => {
            return `<div class="quiz-passage-box"><b>&lt;보기&gt;</b>\n${p1.trim()}</div>`;
        });
        formatted = formatted.replace(/<예시>([\s\S]*?)<\/예시>/gi, (match, p1) => {
            return `<div class="quiz-passage-box"><b>&lt;예시&gt;</b>\n${p1.trim()}</div>`;
        });

        // 3. 단독 <보기>, <예시> 태그가 브라우저에 의해 무시되거나 잘리지 않도록 안전 변환
        formatted = formatted.replace(/<보기>/gi, '<div class="quiz-passage-box"><b>&lt;보기&gt;</b>\n');
        formatted = formatted.replace(/<\/보기>/gi, '</div>');
        formatted = formatted.replace(/<예시>/gi, '<div class="quiz-passage-box"><b>&lt;예시&gt;</b>\n');
        formatted = formatted.replace(/<\/예시>/gi, '</div>');

        // 4. 객관식 보기 번호(①~⑤)가 줄 중간에 붙어 있는 경우 강제로 줄바꿈 삽입
        formatted = formatted.replace(/([^\n])\s*([①②③④⑤])/g, "$1\n\n$2");
        // 5. 1), 2) 등 괄호형 번호가 줄 중간에 있는 경우도 줄바꿈 삽입
        formatted = formatted.replace(/([^\n])\s*(\([1-5]\)|[1-5]\))\s+/g, "$1\n\n$2 ");

        return formatted;
    }

    function beautifyQuizPassages(container) {
        if (!container) return;
        // pre, blockquote 태그가 있으면 글씨체 깨짐 방지 및 가로 스크롤 잘림 방지 클래스 적용
        container.querySelectorAll("pre, blockquote").forEach((el) => {
            el.classList.add("quiz-passage-box");
        });
    }

    function beautifyQuizOptions(container) {
        if (!container) return;
        const paragraphs = container.querySelectorAll("p");
        paragraphs.forEach((p) => {
            if (/[①②③④⑤]/.test(p.innerHTML)) {
                const lines = p.innerHTML.split(/<br\s*\/?>|\n/i);
                const hasOption = lines.some((line) => /^\s*[①②③④⑤]/.test(line.trim()));
                if (hasOption) {
                    const optionsHtml = [];
                    const leadingTexts = [];
                    let isOptionStarted = false;

                    lines.forEach((line) => {
                        const trimmed = line.trim();
                        const match = trimmed.match(/^([①②③④⑤])\s*(.*)$/);
                        if (match) {
                            isOptionStarted = true;
                            optionsHtml.push(
                                `<div class="quiz-option-item"><span class="quiz-option-num">${match[1]}</span><span class="quiz-option-text">${match[2]}</span></div>`
                            );
                        } else if (!isOptionStarted && trimmed) {
                            leadingTexts.push(line);
                        } else if (trimmed) {
                            if (optionsHtml.length > 0) {
                                const lastIdx = optionsHtml.length - 1;
                                optionsHtml[lastIdx] = optionsHtml[lastIdx].replace(
                                    /<\/div>$/,
                                    ` ${trimmed}</div>`
                                );
                            } else {
                                leadingTexts.push(line);
                            }
                        }
                    });

                    let replacement = "";
                    if (leadingTexts.length > 0) {
                        replacement += `<p>${leadingTexts.join("<br>")}</p>`;
                    }
                    if (optionsHtml.length > 0) {
                        replacement += `<div class="quiz-options-group">${optionsHtml.join("")}</div>`;
                    }

                    if (replacement) {
                        const wrapper = document.createElement("div");
                        wrapper.innerHTML = replacement;
                        p.parentNode.replaceChild(wrapper, p);
                    }
                }
            }
        });
    }

    // 정답 및 해설: 모든 문항(보기) 해설을 제공하되, 정답인 번호와 해설에 함께 반투명형광레드 마킹
    function beautifyQuizExplanations(container) {
        if (!container) return;
        const detailsList = container.querySelectorAll("details");
        detailsList.forEach((details) => {
            const summary = details.querySelector("summary");
            const summaryHtml = summary ? summary.outerHTML : "<summary><b>정답 및 해설 보기 (클릭)</b></summary>";

            const clone = details.cloneNode(true);
            const cloneSummary = clone.querySelector("summary");
            if (cloneSummary) cloneSummary.remove();

            const innerHtml = clone.innerHTML.trim();
            const innerText = clone.textContent.trim();

            // 1. 이미 mark 태그로 정답 번호와 해설이 감싸져 있는 경우
            if (innerHtml.includes("highlight-answer") || innerHtml.includes("<mark")) {
                let processedHtml = innerHtml.replace(/<mark(?!\s+class)/gi, '<mark class="highlight-answer"');
                details.innerHTML = `${summaryHtml}<div class="explanation-box">${processedHtml}</div>`;
                return;
            }

            // 2. 정답 번호 탐색 (예: "정답: ③" 또는 "③" 또는 "3번")
            let correctNum = "";
            const numMatch = innerText.match(/(?:정답|답안)\s*[:：]?\s*([①②③④⑤]|\([1-5]\)|[1-5]번|[1-5])/i);
            if (numMatch) {
                correctNum = numMatch[1].replace(/번$/, "").trim();
            }

            // 3. 줄 단위로 나누어 보기별 해설 처리 (정답인 번호와 해설에 함께 반투명 형광레드 적용)
            const rawLines = innerHtml.split(/<br\s*\/?>|\n/i).map(l => l.trim()).filter(Boolean);
            if (rawLines.length > 1 && correctNum) {
                const formattedLines = rawLines.map((line) => {
                    const plainLine = line.replace(/<[^>]+>/g, "").trim();
                    const isCorrectLine = (
                        plainLine.startsWith(correctNum) ||
                        (correctNum === "3" && plainLine.startsWith("③")) ||
                        (correctNum === "1" && plainLine.startsWith("①")) ||
                        (correctNum === "2" && plainLine.startsWith("②")) ||
                        (correctNum === "4" && plainLine.startsWith("④")) ||
                        (correctNum === "5" && plainLine.startsWith("⑤")) ||
                        (correctNum === "③" && plainLine.startsWith("3")) ||
                        plainLine.includes("정답")
                    );

                    if (isCorrectLine && !line.includes("highlight-answer")) {
                        return `<div class="explanation-item"><mark class="highlight-answer">${line}</mark></div>`;
                    }
                    return `<div class="explanation-item">${line}</div>`;
                });

                details.innerHTML = `${summaryHtml}<div class="explanation-box">${formattedLines.join("")}</div>`;
                return;
            }

            // 4. 단일 문단인 경우
            let answer = "";
            let explanation = "";
            const ansMatch = innerText.match(/(?:정답|답안)\s*[:：]\s*([^\n\r]+)/i);
            if (ansMatch) {
                answer = ansMatch[1].replace(/^[*-•\s]+/, "").trim();
            }

            const expMatch = innerText.match(/(?:해설|풀이|근거)\s*[:：]\s*([\s\S]+)/i);
            if (expMatch) {
                explanation = expMatch[1].trim();
            } else if (ansMatch) {
                explanation = innerText.replace(ansMatch[0], "").replace(/^[*-•\s]+/, "").trim();
            } else {
                explanation = innerText;
            }

            const markBadge = answer ? `<mark class="highlight-answer">정답: ${escapeHtml(answer)} - ${escapeHtml(explanation)}</mark>` : escapeHtml(explanation);

            details.innerHTML = `
                ${summaryHtml}
                <div class="explanation-box">
                    <p class="explanation-text">${markBadge}</p>
                </div>
            `;
        });
    }

    function extractAnswersOnly(markdown) {
        if (!markdown) return "";

        const tempDiv = document.createElement("div");
        if (window.marked && typeof window.marked.parse === "function") {
            tempDiv.innerHTML = window.marked.parse(markdown);
        } else {
            tempDiv.innerHTML = markdown;
        }

        const items = [];
        const headers = tempDiv.querySelectorAll("h2, h3, h4");

        if (headers.length > 0) {
            headers.forEach((h) => {
                const questionTitle = h.textContent.trim();
                let nextEl = h.nextElementSibling;
                let detailsEl = null;

                while (nextEl && !["H2", "H3", "H4"].includes(nextEl.tagName)) {
                    if (nextEl.tagName === "DETAILS") {
                        detailsEl = nextEl;
                        break;
                    }
                    nextEl = nextEl.nextElementSibling;
                }

                let answerText = "";
                let explanationText = "";

                if (detailsEl) {
                    const clone = detailsEl.cloneNode(true);
                    const summary = clone.querySelector("summary");
                    if (summary) summary.remove();

                    const text = clone.textContent.trim();

                    const ansMatch = text.match(/(?:정답|답안)\s*[:：]\s*([^\n\r]+)/i);
                    if (ansMatch) {
                        answerText = ansMatch[1].replace(/^[*-•\s]+/, "").trim();
                        // 인라인에 해설이 붙어 있는 경우 분리
                        const inlineExp = answerText.match(/^(.*?)(?:\s+(?:해설|풀이|근거)\s*[:：]|\s{2,})(.*)$/);
                        if (inlineExp) {
                            answerText = inlineExp[1].trim();
                            explanationText = inlineExp[2].trim();
                        }
                    }

                    if (!explanationText) {
                        const expMatch = text.match(/(?:해설|풀이|근거)\s*[:：]\s*([\s\S]+)/i);
                        if (expMatch) {
                            explanationText = expMatch[1].trim();
                        } else if (ansMatch) {
                            explanationText = text.replace(ansMatch[0], "").replace(/^[*-•\s]+/, "").trim();
                        } else {
                            explanationText = text;
                        }
                    }
                }

                let itemStr = `[${questionTitle}]\n`;
                if (answerText) itemStr += `- 정답: ${answerText}\n`;
                if (explanationText) itemStr += `- 해설: ${explanationText}\n`;
                items.push(itemStr.trim());
            });
        }

        // 폴백 정규식 추출
        if (items.length === 0) {
            const questionBlocks = markdown.split(/(?=###?\s*문제\s*\d+)/i);
            for (const block of questionBlocks) {
                if (!block.trim()) continue;
                const matchHeader = block.match(/###?\s*(문제\s*\d+[\.\:]?\s*[^\n]+)/i);
                const matchAns = block.match(/(?:정답|답안)\s*[:：]\s*([^\n\r]+)/i);
                const matchExp = block.match(/(?:해설|풀이|근거)\s*[:：]\s*([\s\S]*?)(?=<\/details>|---|###|$)/i);

                if (matchHeader) {
                    let blockStr = `[${matchHeader[1].trim()}]\n`;
                    if (matchAns) blockStr += `- 정답: ${matchAns[1].replace(/<[^>]+>/g, "").trim()}\n`;
                    if (matchExp) {
                        const cleanExp = matchExp[1].replace(/<\/?[^>]+(>|$)/g, "").trim();
                        blockStr += `- 해설: ${cleanExp}\n`;
                    }
                    items.push(blockStr.trim());
                }
            }
        }

        return items.join("\n\n");
    }

    function renderQuizResult(markdownText) {
        emptyState.classList.add("hidden");
        loadingState.classList.add("hidden");

        const formattedMarkdown = formatQuizMarkdown(markdownText);

        // marked.js 라이브러리를 통해 Markdown을 HTML로 파싱
        if (window.marked && typeof window.marked.parse === "function") {
            quizResult.innerHTML = window.marked.parse(formattedMarkdown);
            beautifyQuizPassages(quizResult);
            beautifyQuizOptions(quizResult);
            beautifyQuizExplanations(quizResult);
        } else {
            // fallback: 일반 텍스트 보존 표시
            quizResult.innerHTML = `<pre style="white-space: pre-wrap;">${escapeHtml(markdownText)}</pre>`;
        }

        quizResult.classList.remove("hidden");
        resultActions.style.display = "flex";

        // 모바일 사용자를 위해 결과창으로 부드럽게 스크롤 (화면 레이아웃 변경 방지)
        if (window.innerWidth <= 900) {
            document.getElementById("result-section").scrollIntoView({ behavior: "smooth", block: "start" });
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
    // 4. 결과 복사, 정답·해설 복사 및 Markdown 다운로드 기능
    // -------------------------------------------------------------------------
    copyBtn.addEventListener("click", async () => {
        if (!currentMarkdownText) return;

        try {
            await navigator.clipboard.writeText(currentMarkdownText);
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = "✅ 결과 복사 완료!";
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

    if (copyAnswersBtn) {
        copyAnswersBtn.addEventListener("click", async () => {
            if (!currentMarkdownText) return;

            const answersOnlyText = extractAnswersOnly(currentMarkdownText);
            if (!answersOnlyText) {
                alert("정답 및 해설 내용을 추출하지 못했습니다.");
                return;
            }

            try {
                await navigator.clipboard.writeText(answersOnlyText);
                const originalText = copyAnswersBtn.innerHTML;
                copyAnswersBtn.innerHTML = "✅ 정답·해설 복사 완료!";
                copyAnswersBtn.disabled = true;

                setTimeout(() => {
                    copyAnswersBtn.innerHTML = originalText;
                    copyAnswersBtn.disabled = false;
                }, 2000);
            } catch (err) {
                console.error("정답/해설 복사 실패:", err);
                alert("클립보드 복사에 실패했습니다. 권한을 확인해 주세요.");
            }
        });
    }

    downloadPdfBtn.addEventListener("click", async () => {
        if (!currentMarkdownText) return;

        const formattedMarkdown = formatQuizMarkdown(currentMarkdownText);
        // 원본 Markdown을 파싱하여 임시 DOM 객체 생성
        const tempDiv = document.createElement("div");
        if (window.marked && typeof window.marked.parse === "function") {
            tempDiv.innerHTML = window.marked.parse(formattedMarkdown);
            beautifyQuizPassages(tempDiv);
            beautifyQuizOptions(tempDiv);
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
