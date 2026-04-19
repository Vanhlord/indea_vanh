const input = document.getElementById('input');
        const inputLabel = document.getElementById('inputLabel');
        const output = document.getElementById('output');
        const modeButton = document.getElementById('modeButton');
        const modeMenu = document.getElementById('modeMenu');
        const modeOptions = document.querySelectorAll('.mode-option');
        const reverseButton = document.getElementById('reverseButton');
        const copyButton = document.getElementById('copyButton');
        const downloadZipBtn = document.getElementById('downloadZipBtn');
        const imageInput = document.getElementById('imageInput');
        const chooseImageBtn = document.getElementById('chooseImageBtn');
        const viewerOverlay = document.getElementById('viewerOverlay');
        const viewerContent = document.getElementById('viewerContent');
        const secretTextInputContainer = document.getElementById('secretTextInputContainer');
        const secretTextInput = document.getElementById('secretTextInput');
        const secretMessageArea = document.getElementById('secretMessageArea');
        const secretMessageDisplay = document.getElementById('secretMessageDisplay');
        const imageSelectArea = document.getElementById('imageSelectArea');
        const utf8Encoder = new TextEncoder();
        const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
        
        // Marker for Secret Text: "SECRET" in binary
        const SECRET_MARKER = '010100110100010101000011010100100100010101010100';

        let currentType = 'binary';
        let isReversed = false;
        let copyResetTimer = null;
        let embeddingExtractorPromise = null;
        let selectedFile = null;
        let currentRawResult = '';

        const typeLabels = {
            binary: 'Nhị phân',
            morse: 'Morse',
            base64: 'Base64',
            hex: 'Hex',
            octal: 'Octal',
            url: 'URL Encode',
            htmlEntity: 'HTML Entity',
            unicodeEscape: 'Unicode \\u',
            embedding: 'Embedding Vectors',
            image: 'Hình ảnh'
        };

        const MORSE_MAP = {
            'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.',
            'F': '..-.', 'G': '--.', 'H': '....', 'I': '..', 'J': '.---',
            'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---',
            'P': '.--.', 'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-',
            'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-', 'Y': '-.--',
            'Z': '--..',
            '0': '-----', '1': '.----', '2': '..---', '3': '...--',
            '4': '....-', '5': '.....', '6': '-....', '7': '--...',
            '8': '---..', '9': '----.',
            '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--',
            ':': '---...', ';': '-.-.-.', "'": '.----.', '"': '.-..-.',
            '-': '-....-', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
            '&': '.-...', '=': '-...-', '+': '.-.-.', '@': '.--.-.',
            '_': '..--.-', '$': '...-..-',
            ' ': '/'
        };

        const REVERSE_MORSE_MAP = Object.fromEntries(
            Object.entries(MORSE_MAP).map(([char, morse]) => [morse, char])
        );
        const D_STROKE_UPPER = '\u0110';

        modeButton.addEventListener('click', () => {
            modeMenu.classList.toggle('hidden');
        });

        modeOptions.forEach(option => {
            option.addEventListener('click', () => {
                currentType = option.dataset.type;
                modeButton.innerText = typeLabels[currentType];
                updateDirectionUI();
                modeMenu.classList.add('hidden');
            });
        });

        reverseButton.addEventListener('click', () => {
            if (currentType === 'embedding') return;
            isReversed = !isReversed;
            updateDirectionUI();
        });

        document.addEventListener('click', (event) => {
            if (!modeButton.contains(event.target) && !modeMenu.contains(event.target)) {
                modeMenu.classList.add('hidden');
            }
        });
        
        chooseImageBtn.addEventListener('click', () => imageInput.click());
        
        ['dragenter', 'dragover'].forEach(eventName => {
            chooseImageBtn.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                chooseImageBtn.classList.add('bg-slate-100', 'border-slate-400', 'scale-[1.02]');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            chooseImageBtn.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                chooseImageBtn.classList.remove('bg-slate-100', 'border-slate-400', 'scale-[1.02]');
            }, false);
        });

        chooseImageBtn.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files[0] && files[0].type.startsWith('image/')) {
                handleImageSelect(files[0]);
            }
        });

        imageInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                handleImageSelect(e.target.files[0]);
            }
        });

        input.addEventListener('paste', (e) => {
            if (currentType !== 'image') return;
            
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const file = items[i].getAsFile();
                    if (file) {
                        e.preventDefault(); // Prevent pasting raw bits if it's an image
                        // Create a new File object with a name since getAsFile() might return a generic blob
                        const pastedFile = new File([file], 'pasted_image.png', { type: file.type });
                        handleImageSelect(pastedFile);
                    }
                    break;
                }
            }
        });

        let previewUrl = null;
        function handleImageSelect(file) {
            selectedFile = file;
            
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = URL.createObjectURL(file);
            
            chooseImageBtn.innerHTML = `
                <div class="flex flex-col items-center gap-2">
                    <img src="${previewUrl}" class="max-h-32 rounded-lg shadow-sm mb-1">
                    <span class="text-slate-800 font-semibold">${file.name}</span>
                    <span class="text-xs text-slate-400">Nhấp hoặc kéo thả để thay đổi</span>
                </div>
            `;
            
            chooseImageBtn.classList.remove('text-slate-400');
            chooseImageBtn.classList.add('border-slate-800', 'bg-slate-50/50');
        }

        async function convert() {
            const value = input.value.trim();
            const isImageMode = currentType === 'image';
            
            // Validation
            if (isImageMode) {
                if (!isReversed && !selectedFile) {
                    output.innerText = "Vui lòng chọn hoặc kéo thả ảnh vào trước nhé.";
                    return;
                }
                if (isReversed && !selectedFile && value.length === 0) {
                    output.innerText = "Vui lòng nhập mã nhị phân hoặc chọn ảnh để trích xuất.";
                    return;
                }
            } else if (value.length === 0) {
                output.innerText = "Vui lòng nhập nội dung trước nhé.";
                return;
            }

            try {
                let result = '';

                if (currentType === 'binary') {
                    result = isReversed ? binaryToText(value) : textToBinary(value);
                } else if (currentType === 'morse') {
                    result = isReversed ? morseToText(value) : textToMorse(value);
                } else if (currentType === 'base64') {
                    result = isReversed ? base64ToText(value) : textToBase64(value);
                } else if (currentType === 'hex') {
                    result = isReversed ? hexToText(value) : textToHex(value);
                } else if (currentType === 'octal') {
                    result = isReversed ? octalToText(value) : textToOctal(value);
                } else if (currentType === 'url') {
                    result = isReversed ? urlToText(value) : textToUrl(value);
                } else if (currentType === 'htmlEntity') {
                    result = isReversed ? htmlEntityToText(value) : textToHtmlEntity(value);
                } else if (currentType === 'unicodeEscape') {
                    result = isReversed ? unicodeEscapeToText(value) : textToUnicodeEscape(value);
                } else if (currentType === 'embedding') {
                    if (isReversed) {
                        output.innerText = "Embedding Vectors hiện chỉ hỗ trợ chiều Văn bản -> vector.";
                        return;
                    }
                    output.innerText = "Đang xử lý embedding AI cục bộ...";
                    result = await textToEmbeddingVectorLocalAI(value);
                } else if (currentType === 'image') {
                    secretMessageArea.classList.add('hidden');
                    if (isReversed) { // Binary -> Image (reversed)
                        let blob;
                        let foundSecretBinary;
                        
                        if (selectedFile) {
                            // Direct extraction from uploaded image
                            blob = selectedFile;
                            foundSecretBinary = await extractSecretFromImage(blob);
                            currentRawResult = ""; // No raw text result for file input
                        } else {
                            // Extract from binary string entered in textarea
                            blob = await binaryToImage(value);
                            foundSecretBinary = await extractSecretFromImage(blob);
                            currentRawResult = value; 
                        }
                        
                        const url = URL.createObjectURL(blob);
                        const canShare = navigator.canShare && navigator.canShare({ files: [new File([blob], 'result_image.png', { type: 'image/png' })] });

                        output.innerHTML = `
                            <img src="${url}" class="max-w-full max-h-64 rounded-xl shadow-sm cursor-pointer hover:opacity-90 transition-all mb-4" onclick="openViewer(null, 'image', '${url}')">
                            <div class="flex flex-wrap gap-2 justify-center">
                                ${canShare ? `<button id="shareImgBtn" class="px-3 py-2 bg-amber-500 text-white text-[10px] font-bold rounded-xl hover:bg-amber-600 transition-all shadow-sm">Chia sẻ</button>` : ''}
                                <button id="copyImgBtn" class="px-3 py-2 bg-slate-700 text-white text-[10px] font-bold rounded-xl hover:bg-slate-800 transition-all shadow-sm">Sao chép ảnh</button>
                                <button id="directDlImgBtn" class="px-3 py-2 bg-emerald-600 text-white text-[10px] font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-sm">Tải Ảnh</button>
                                <button id="zipDlImgBtn" class="px-3 py-2 bg-blue-600 text-white text-[10px] font-bold rounded-xl hover:bg-blue-700 transition-all shadow-sm">Tải ZIP</button>
                            </div>
                        `;
                        
                        if (canShare) {
                            document.getElementById('shareImgBtn').onclick = () => shareResultFile(blob, 'result_image.png');
                        }
                        document.getElementById('copyImgBtn').onclick = () => copyImageToClipboard(blob);
                        document.getElementById('directDlImgBtn').onclick = () => downloadFileDirect(blob, 'result_image.png');
                        document.getElementById('zipDlImgBtn').onclick = () => downloadBlobAsZip(blob, "result_image");

                        if (foundSecretBinary) {
                            try {
                                const bytes = new Uint8Array(foundSecretBinary.match(/.{8}/g).map(bin => parseInt(bin, 2)));
                                const decodedSecret = utf8Decoder.decode(bytes);
                                secretMessageDisplay.innerText = decodedSecret;
                                secretMessageArea.classList.remove('hidden');
                            } catch (e) {
                                // If decoding fails, fallback to binary display
                                secretMessageDisplay.innerText = foundSecretBinary;
                                secretMessageArea.classList.remove('hidden');
                            }
                        }
                        return;
                    } else { // Image -> Binary (not reversed)
                        output.innerText = "Đang mã hóa hình ảnh (pixel embedding)...";
                        const secretValue = secretTextInput.value.trim();
                        const { binary, blob } = await imageToBinary(selectedFile, secretValue);
                        
                        currentRawResult = binary;
                        const url = URL.createObjectURL(blob);
                        const canShare = navigator.canShare && navigator.canShare({ files: [new File([blob], 'encoded_image.png', { type: 'image/png' })] });

                        output.innerHTML = `
                            <div class="w-full flex flex-col items-center gap-4">
                                <div class="w-full bg-slate-50 p-4 rounded-2xl border border-dashed border-slate-200 flex flex-col items-center">
                                    <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Xem trước ảnh đã thắt mã:</p>
                                    <img src="${url}" class="max-w-full max-h-48 rounded-xl shadow-sm cursor-pointer hover:opacity-90 transition-all mb-4" onclick="openViewer(null, 'image', '${url}')">
                                    <div class="flex flex-wrap gap-2 justify-center">
                                        ${canShare ? `<button id="shareEncodedBtn" class="px-3 py-2 bg-amber-500 text-white text-[10px] font-bold rounded-xl hover:bg-amber-600 transition-all shadow-sm">Chia sẻ</button>` : ''}
                                        <button id="copyEncodedBtn" class="px-3 py-2 bg-slate-700 text-white text-[10px] font-bold rounded-xl hover:bg-slate-800 transition-all shadow-sm">Sao chép ảnh</button>
                                        <button id="dlEncodedBtn" class="px-3 py-2 bg-emerald-600 text-white text-[10px] font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-sm">Tải Ảnh</button>
                                    </div>
                                </div>
                                <div id="fileCardContainer" class="w-full"></div>
                            </div>
                        `;
                        
                        if (canShare) document.getElementById('shareEncodedBtn').onclick = () => shareResultFile(blob, 'encoded_image.png');
                        document.getElementById('copyEncodedBtn').onclick = () => copyImageToClipboard(blob);
                        document.getElementById('dlEncodedBtn').onclick = () => downloadFileDirect(blob, 'encoded_image.png');

                        const tempOutput = output; // Store reference to current output
                        const cardContainer = document.getElementById('fileCardContainer');
                        // Define custom render inside this context to target cardContainer
                        const renderFileCardInto = (name, size, onView, onDownload, blobData, fileName) => {
                            const sizeStr = size > 1024 * 1024 ? (size / (1024 * 1024)).toFixed(2) + ' MB' : (size / 1024).toFixed(2) + ' KB';
                            const canShareCard = blobData && navigator.canShare && navigator.canShare({ files: [new File([blobData], fileName, { type: blobData.type })] });
                            
                            cardContainer.innerHTML = `
                                <div class="w-full flex flex-col gap-3 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-all text-left">
                                    <div class="flex items-center gap-4">
                                        <div class="w-12 h-12 bg-blue-50 text-blue-500 rounded-xl flex items-center justify-center shrink-0">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                                        </div>
                                        <div class="flex-1 min-w-0">
                                            <p class="text-sm font-semibold text-slate-800 truncate">${name}</p>
                                            <p class="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">${sizeStr} (File Mã)</p>
                                        </div>
                                    </div>
                                    <div class="flex flex-wrap gap-2 justify-center sm:justify-end border-t border-slate-50 pt-3">
                                        <button id="viewCardBtn" class="px-3 py-2 bg-slate-900 text-white text-[10px] font-bold rounded-xl hover:bg-slate-800 transition-all">Xem mã</button>
                                        <button id="cardDirectDlBtn" class="px-3 py-2 bg-emerald-600 text-white text-[10px] font-bold rounded-xl hover:bg-emerald-700 transition-all">Tải File Mã</button>
                                        <button id="cardZipDlBtn" class="px-3 py-2 bg-blue-600 text-white text-[10px] font-bold rounded-xl hover:bg-blue-700 transition-all">Tải ZIP</button>
                                    </div>
                                </div>
                            `;
                            document.getElementById('viewCardBtn').onclick = onView;
                            document.getElementById('cardDirectDlBtn').onclick = () => downloadFileDirect(blobData, fileName);
                            const cardZipDlBtn = document.getElementById('cardZipDlBtn');
                            cardZipDlBtn.onclick = onDownload;
                        };

                        renderFileCardInto(selectedFile.name + ".bin", binary.length, () => openViewer(binary, "text"), () => downloadTextAsZip(binary, selectedFile.name), new Blob([binary], {type: 'text/plain'}), selectedFile.name + ".bin");
                        
                        if (secretValue) {
                            secretMessageDisplay.innerText = secretValue;
                            secretMessageArea.classList.remove('hidden');
                        }
                        
                        return;
                    }
                }
                
                // If we reach here, it means it's not an image conversion that returns early
                downloadZipBtn.classList.add('hidden'); // Hide for non-image conversions

                currentRawResult = result || "";
                output.innerText = result || "Không có kết quả.";
            } catch (e) {
                output.innerText = e?.message || "Dữ liệu chưa đúng định dạng cho chế độ đã chọn.";
            }
        }

        function updateDirectionUI() {
            const typeLabel = typeLabels[currentType];
            const oneWayMode = currentType === 'embedding';
            if (oneWayMode && isReversed) {
                isReversed = false;
            }
            reverseButton.disabled = oneWayMode;
            reverseButton.classList.toggle('opacity-50', oneWayMode);
            reverseButton.classList.toggle('cursor-not-allowed', oneWayMode);

            const fromLabel = isReversed ? typeLabel : 'Văn bản';
            const toLabel = isReversed ? 'Văn bản' : typeLabel;
            reverseButton.title = `Đảo chiều: ${fromLabel} -> ${toLabel}`;
            reverseButton.setAttribute('aria-label', `Đảo chiều: ${fromLabel} -> ${toLabel}`);
            inputLabel.innerText = fromLabel;
            
            const isImageMode = currentType === 'image';
            const isImageUploadMode = isImageMode && !isReversed;
            
            // In image mode, always show image selection area
            imageSelectArea.classList.toggle('hidden', !isImageMode);
            
            // Textarea is shown for all modes EXCEPT when we are UPLOADING an image to convert to binary
            input.classList.toggle('hidden', isImageUploadMode);
            
            // Secret text input for EMBEDDING is only shown when uploading image (not reversed)
            secretTextInputContainer.classList.toggle('hidden', !isImageUploadMode);
            
            if (!isImageUploadMode) {
                secretTextInput.value = '';
            }
            secretMessageArea.classList.add('hidden');
            
            input.placeholder = getInputPlaceholder(currentType, isReversed);
        }

        function getInputPlaceholder(type, reversed) {
            if (!reversed) return "Nhập văn bản...";

            if (type === 'binary') return 'Nhập nhị phân (ví dụ: 01001000 01101001)';
            if (type === 'morse') return 'Nhập Morse (dùng / cho khoảng trắng)';
            if (type === 'base64') return 'Nhập chuỗi Base64';
            if (type === 'hex') return 'Nhập Hex (ví dụ: 48 69)';
            if (type === 'octal') return 'Nhập Octal (ví dụ: 110 151)';
            if (type === 'url') return 'Nhập URL encoded (ví dụ: Xin%20chao)';
            if (type === 'htmlEntity') return 'Nhập HTML Entity (ví dụ: &#72;&#105;)';
            if (type === 'unicodeEscape') return 'Nhập Unicode escape (ví dụ: \\u0048\\u0069)';
            if (type === 'image') return 'Nhập dãy nhị phân của ảnh (0101...)';
            return `Nhập ${typeLabels[type]}...`;
        }

        function textToBinary(text) {
            const bytes = utf8Encoder.encode(text);
            return Array.from(bytes, (byte) => byte.toString(2).padStart(8, '0')).join(' ');
        }

        function binaryToText(binary) {
            const compact = binary.replace(/\s+/g, '');
            if (!compact || !/^[01]+$/.test(compact) || compact.length % 8 !== 0) {
                throw new Error('Invalid binary');
            }
            const bytes = new Uint8Array(compact.match(/.{8}/g).map((bin) => parseInt(bin, 2)));
            return utf8Decoder.decode(bytes);
        }

        function textToMorse(text) {
            const unsupported = [];
            const codes = Array.from(text).map((char) => {
                const morseChar = toSupportedMorseChar(char);
                const code = morseChar ? MORSE_MAP[morseChar] : null;
                if (!code) {
                    unsupported.push(char);
                    return null;
                }
                return code;
            });
            if (unsupported.length > 0) {
                const preview = unsupported.slice(0, 8).join(' ');
                throw new Error(`Morse chưa hỗ trợ ký tự: ${preview}`);
            }
            return codes.join(' ');
        }

        function toSupportedMorseChar(char) {
            if (!char) return null;
            if (/\s/.test(char)) return ' ';

            const upper = char.toUpperCase();
            if (MORSE_MAP[upper]) return upper;

            if (upper === D_STROKE_UPPER) return 'D';

            const normalized = upper.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (normalized === D_STROKE_UPPER) return 'D';
            if (MORSE_MAP[normalized]) return normalized;

            return null;
        }

        function morseToText(morse) {
            const chunks = morse.trim().split(/\s+/).filter(Boolean);
            if (chunks.length === 0) {
                throw new Error('Invalid morse');
            }
            const invalid = chunks.find((code) => code !== '/' && !REVERSE_MORSE_MAP[code]);
            if (invalid) {
                throw new Error('Invalid morse');
            }
            return chunks.map((code) => (code === '/' ? ' ' : REVERSE_MORSE_MAP[code])).join('');
        }

        function textToBase64(text) {
            const bytes = utf8Encoder.encode(text);
            const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
            return btoa(bin);
        }

        function base64ToText(base64) {
            const cleaned = base64.replace(/\s+/g, '');
            if (!cleaned || !/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned) || cleaned.length % 4 !== 0) {
                throw new Error('Invalid base64');
            }
            const bin = atob(cleaned);
            const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
            return utf8Decoder.decode(bytes);
        }

        function textToHex(text) {
            const bytes = utf8Encoder.encode(text);
            return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
        }

        function hexToText(hex) {
            const compact = hex.replace(/\s+/g, '');
            if (!/^[0-9a-fA-F]+$/.test(compact) || compact.length % 2 !== 0) {
                throw new Error('Invalid hex');
            }
            const bytes = new Uint8Array(compact.match(/.{2}/g).map((h) => parseInt(h, 16)));
            return utf8Decoder.decode(bytes);
        }

        function textToOctal(text) {
            const bytes = utf8Encoder.encode(text);
            return Array.from(bytes, (byte) => byte.toString(8).padStart(3, '0')).join(' ');
        }

        function octalToText(octal) {
            const compact = octal.replace(/\s+/g, '');
            if (!compact || !/^[0-7]+$/.test(compact) || compact.length % 3 !== 0) {
                throw new Error('Invalid octal');
            }
            const byteStrings = compact.match(/.{3}/g);
            if (byteStrings.some((part) => parseInt(part, 8) > 255)) {
                throw new Error('Invalid octal');
            }
            const bytes = new Uint8Array(byteStrings.map((part) => parseInt(part, 8)));
            return utf8Decoder.decode(bytes);
        }

        function textToUrl(text) {
            return encodeURIComponent(text);
        }

        function urlToText(value) {
            return decodeURIComponent(value);
        }

        function textToHtmlEntity(text) {
            return Array.from(text).map((char) => `&#${char.codePointAt(0)};`).join('');
        }

        function htmlEntityToText(value) {
            const normalized = value.trim();
            if (!/^(\s*&#(?:[xX][0-9a-fA-F]+|[0-9]+);\s*)+$/.test(normalized)) {
                throw new Error('Invalid html entity');
            }
            const tokens = normalized.match(/&#(?:[xX][0-9a-fA-F]+|[0-9]+);/g) || [];
            return tokens.map((token) => {
                const code = token.slice(2, -1);
                const point = /^[xX]/.test(code) ? parseInt(code.slice(1), 16) : parseInt(code, 10);
                if (!Number.isInteger(point) || point < 0 || point > 0x10FFFF) {
                    throw new Error('Invalid html entity');
                }
                return String.fromCodePoint(point);
            }).join('');
        }

        function textToUnicodeEscape(text) {
            return Array.from(text).map((char) => {
                const codePoint = char.codePointAt(0);
                if (codePoint <= 0xFFFF) {
                    return `\\u${codePoint.toString(16).padStart(4, '0')}`;
                }
                const u = codePoint - 0x10000;
                const high = 0xD800 + (u >> 10);
                const low = 0xDC00 + (u & 0x3FF);
                return `\\u${high.toString(16).padStart(4, '0')}\\u${low.toString(16).padStart(4, '0')}`;
            }).join('');
        }

        function unicodeEscapeToText(value) {
            const normalized = value.trim();
            if (!/^(\s*(?:\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]{1,6}\})\s*)+$/.test(normalized)) {
                throw new Error('Invalid unicode escape');
            }
            const tokens = normalized.match(/\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})/g) || [];
            return tokens.map((token) => {
                if (token.startsWith('\\u{')) {
                    const point = parseInt(token.slice(3, -1), 16);
                    if (!Number.isInteger(point) || point < 0 || point > 0x10FFFF) {
                        throw new Error('Invalid unicode escape');
                    }
                    return String.fromCodePoint(point);
                }
                return String.fromCharCode(parseInt(token.slice(2), 16));
            }).join('');
        }

        async function loadEmbeddingExtractor() {
            if (!embeddingExtractorPromise) {
                output.innerText = "Đang tải model AI, vui lòng đợi...";
                embeddingExtractorPromise = import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2')
                    .then(({ pipeline, env }) => {
                        env.useBrowserCache = true;
                        return pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                            quantized: true
                        });
                    });
            }
            return embeddingExtractorPromise;
        }

        async function textToEmbeddingVectorLocalAI(text) {
            try {
                const extractor = await loadEmbeddingExtractor();
                const tensor = await extractor(text, { pooling: 'mean', normalize: true });
                const values = Array.from(tensor?.data || []);
                if (values.length === 0) {
                    throw new Error('Không lấy được vector embedding từ model.');
                }
                const rounded = values.map((v) => Number(v.toFixed(6)));
                return `[${rounded.join(', ')}]`;
            } catch (error) {
                throw new Error(`Embedding cục bộ lỗi: ${error?.message || 'Unknown error'}`);
            }
        }

        async function imageToBinary(file, secretText = '') {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = async (e) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        const data = imageData.data;
                        
                        if (secretText) {
                            const bits = Array.from(utf8Encoder.encode(secretText))
                                .map(byte => byte.toString(2).padStart(8, '0'))
                                .join('') + SECRET_MARKER;
                            
                            // Each pixel (RGBA) has 3 channels we use (RGB). 
                            // So we need (bits.length / 3) pixels.
                            if (bits.length > (data.length / 4) * 3) {
                                reject(new Error("Ảnh quá nhỏ để giấu tin nhắn này! Hãy chọn ảnh lớn hơn hoặc rút ngắn tin nhắn."));
                                return;
                            }
                            
                            let bitIndex = 0;
                            for (let i = 0; i < data.length && bitIndex < bits.length; i++) {
                                if ((i + 1) % 4 === 0) continue; // Skip Alpha channel
                                data[i] = (data[i] & 0xFE) | parseInt(bits[bitIndex], 2);
                                bitIndex++;
                            }
                            ctx.putImageData(imageData, 0, 0);
                        }
                        
                        canvas.toBlob(async (blob) => {
                            const arrayBuffer = await blob.arrayBuffer();
                            const bytes = new Uint8Array(arrayBuffer);
                            const binary = Array.from(bytes, (byte) => byte.toString(2).padStart(8, '0')).join('');
                            resolve({ binary, blob });
                        }, 'image/png');
                    };
                    img.onerror = () => reject(new Error("Lỗi khi tải ảnh."));
                    img.src = e.target.result;
                };
                reader.onerror = () => reject(new Error("Lỗi khi đọc file."));
                reader.readAsDataURL(file);
            });
        }

        async function binaryToImage(binary) {
            const compact = binary.replace(/\s+/g, '');
            if (!compact || !/^[01]+$/.test(compact) || compact.length % 8 !== 0) {
                throw new Error('Dữ liệu nhị phân không hợp lệ (phải là bội số của 8).');
            }
            const bytes = new Uint8Array(compact.match(/.{8}/g).map((bin) => parseInt(bin, 2)));
            return new Blob([bytes], { type: 'image/png' });
        }

        async function extractSecretFromImage(blob) {
            return new Promise((resolve) => {
                const img = new Image();
                const url = URL.createObjectURL(blob);
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                    
                    let bits = '';
                    // Optimization: stop if we find the marker or run out of pixels
                    for (let i = 0; i < data.length; i++) {
                        if ((i + 1) % 4 === 0) continue; // Skip alpha
                        bits += (data[i] & 1).toString();
                        
                        // Check for marker in the last 64 bits every 8 bits to keep it snappy
                        if (bits.length >= SECRET_MARKER.length && bits.length % 8 === 0) {
                            if (bits.endsWith(SECRET_MARKER)) {
                                break;
                            }
                        }
                    }
                    
                    URL.revokeObjectURL(url);
                    const markerIndex = bits.indexOf(SECRET_MARKER);
                    if (markerIndex !== -1) {
                        resolve(bits.substring(0, markerIndex));
                    } else {
                        resolve('');
                    }
                };
                img.onerror = () => {
                    URL.revokeObjectURL(url);
                    resolve('');
                };
                img.src = url;
            });
        }

        async function copyImageToClipboard(blob) {
            try {
                if (!window.ClipboardItem) {
                    throw new Error("Trình duyệt không hỗ trợ ClipboardItem.");
                }
                const item = new ClipboardItem({ [blob.type]: blob });
                await navigator.clipboard.write([item]);
                alert("Đã chép ảnh vào bộ nhớ tạm! Anh có thể nhấn Ctrl+V để dán.");
            } catch (e) {
                alert("Không thể sao chép ảnh: " + e.message + "\nAnh hãy dùng nút 'Tải Ảnh' nhé!");
            }
        }

        function downloadFileDirect(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        async function shareResultFile(blob, filename) {
            try {
                const file = new File([blob], filename, { type: blob.type });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'Chia sẻ mã bí mật',
                        text: 'Gửi file chứa nội dung bí mật từ Trình biên dịch A001'
                    });
                } else {
                    alert("Trình duyệt hoặc hệ điều hành của anh chưa hỗ trợ chia sẻ file này trực tiếp. Anh hãy dùng nút 'Tải về' nhé!");
                }
            } catch (e) {
                if (e.name !== 'AbortError') {
                    alert("Lỗi khi chia sẻ: " + e.message);
                }
            }
        }

        function renderFileCard(name, size, onView, onDownload, blob = null, filename = '') {
            const sizeStr = size > 1024 * 1024 
                ? (size / (1024 * 1024)).toFixed(2) + ' MB' 
                : (size / 1024).toFixed(2) + ' KB';
            
            const canShare = blob && navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] });

            output.innerHTML = `
                <div class="w-full flex flex-col gap-3 p-4 bg-white border border-slate-100 rounded-2xl shadow-sm hover:shadow-md transition-all text-left">
                    <div class="flex items-center gap-4">
                        <div class="w-12 h-12 bg-blue-50 text-blue-500 rounded-xl flex items-center justify-center shrink-0">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-sm font-semibold text-slate-800 truncate">${name}</p>
                            <p class="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">${sizeStr}</p>
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-2 justify-center sm:justify-end border-t border-slate-50 pt-3">
                        <button id="viewBtn" class="px-3 py-2 bg-slate-900 text-white text-[10px] font-bold rounded-xl hover:bg-slate-800 transition-all">Xem mã</button>
                        ${canShare ? `<button id="shareBtn" class="px-3 py-2 bg-amber-500 text-white text-[10px] font-bold rounded-xl hover:bg-amber-600 transition-all">Chia sẻ</button>` : ''}
                        <button id="cardDirectDlBtn" class="px-3 py-2 bg-emerald-600 text-white text-[10px] font-bold rounded-xl hover:bg-emerald-700 transition-all">Tải File</button>
                        <button id="cardDlBtn" class="px-3 py-2 bg-blue-600 text-white text-[10px] font-bold rounded-xl hover:bg-blue-700 transition-all">Tải ZIP</button>
                    </div>
                </div>
            `;
            
            document.getElementById('viewBtn').onclick = onView;
            document.getElementById('cardDlBtn').onclick = onDownload;
            if (blob && filename) {
                document.getElementById('cardDirectDlBtn').onclick = () => downloadFileDirect(blob, filename);
            } else {
                document.getElementById('cardDirectDlBtn').classList.add('hidden');
            }
            if (canShare) {
                document.getElementById('shareBtn').onclick = () => shareResultFile(blob, filename);
            }
            
            downloadZipBtn.classList.remove('hidden');
            downloadZipBtn.onclick = onDownload;
        }

        function openViewer(data, type, existingUrl = null) {
            viewerTitle.innerText = type === 'image' ? "Xem trước hình ảnh" : "Mã nhị phân RAW";
            viewerContent.innerHTML = '';
            
            if (type === 'image') {
                const url = existingUrl || URL.createObjectURL(data);
                const img = document.createElement('img');
                img.src = url;
                img.className = 'max-w-full rounded-2xl shadow-2xl mx-auto';
                if (!existingUrl) img.onload = () => URL.revokeObjectURL(url);
                viewerContent.appendChild(img);
            } else {
                viewerContent.innerText = data;
            }
            
            viewerOverlay.classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        }

        function closeViewer() {
            viewerOverlay.classList.add('hidden');
            document.body.style.overflow = '';
        }

        function generateRandomCode() {
            const randomDigits = Math.floor(10000000 + Math.random() * 90000000).toString();
            return `Code${randomDigits}`;
        }

        async function downloadTextAsZip(text, originalName) {
            try {
                const zip = new JSZip();
                const randomCode = generateRandomCode();
                zip.file(`${randomCode}.bin.txt`, text);
                const content = await zip.generateAsync({type:"blob"});
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${randomCode}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (e) {
                alert("Lỗi khi tạo ZIP: " + e.message);
            }
        }

        async function downloadBlobAsZip(blob, filename) {
            try {
                const zip = new JSZip();
                const randomCode = generateRandomCode();
                const extension = blob.type.split('/')[1] || 'png';
                zip.file(`${randomCode}.${extension}`, blob);
                
                const content = await zip.generateAsync({type:"blob"});
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${randomCode}.zip`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (e) {
                alert("Lỗi khi tạo file ZIP: " + e.message);
            }
        }

        async function copySecret() {
            const text = secretMessageDisplay.innerText.trim();
            if (!text) return;
            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                } else {
                    fallbackCopyText(text);
                }
                const originalText = secretMessageDisplay.innerText;
                secretMessageDisplay.innerText = 'Đã chép mã!';
                setTimeout(() => secretMessageDisplay.innerText = originalText, 1000);
            } catch (e) {
                alert("Lỗi khi sao chép mã mật.");
            }
        }

        async function copyOutput() {
            const text = currentRawResult.trim();
            if (!text) {
                setCopyButtonState('Chưa có');
                return;
            }

            try {
                if (navigator.clipboard && window.isSecureContext) {
                    await navigator.clipboard.writeText(text);
                } else {
                    fallbackCopyText(text);
                }
                setCopyButtonState('Đã chép');
            } catch (e) {
                setCopyButtonState('Lỗi');
            }
        }

        function fallbackCopyText(text) {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            const copied = document.execCommand('copy');
            document.body.removeChild(textarea);
            if (!copied) throw new Error('Copy failed');
        }

        function setCopyButtonState(stateText) {
            copyButton.innerText = stateText;
            clearTimeout(copyResetTimer);
            copyResetTimer = setTimeout(() => {
                copyButton.innerText = 'Sao chép';
            }, 1200);
        }

        updateDirectionUI();