class ObflEngine {
            constructor() {
                this.mapping = new Map();
                this.prefix = "_0x" + Math.random().toString(16).slice(2, 5);
                this.counter = 0;
            }

            getShortName(original) {
                if (this.mapping.has(original)) return this.mapping.get(original);
                const short = this.prefix + (this.counter++).toString(16);
                this.mapping.set(original, short);
                return short;
            }

            minify(html) {
                const step1 = html.replace(/<!--[\s\S]*?-->/g, ''); // Remove comments
                const step2 = step1.replace(/>\s+</g, '><');         // Remove space between tags
                return step2.trim();
            }

            obfuscate(code, options) {
                let processed = code;

                if (options.renameCss) {
                    console.log("Renaming CSS/HTML identifiers...");
                    
                    // 1. Extract IDs and Classes
                    const idRegex = /id=["']([^"']+)["']/g;
                    const classRegex = /class=["']([^"']+)["']/g;
                    const cssVarRegex = /--([a-zA-Z0-9_-]+)/g;

                    let match;
                    const identifiers = new Set();

                    // Find all classes
                    while ((match = classRegex.exec(code)) !== null) {
                        match[1].split(/\s+/).filter(Boolean).forEach(c => identifiers.add(c));
                    }
                    // Find all IDs
                    while ((match = idRegex.exec(code)) !== null) {
                        identifiers.add(match[1]);
                    }
                    // Find CSS Variables
                    while ((match = cssVarRegex.exec(code)) !== null) {
                        identifiers.add('--' + match[1]);
                    }

                    // 2. Filter out some common names or things that shouldn't be renamed if needed
                    // (For now we rename everything detected)

                    // 3. Perform Replacement
                    // Note: We need to be careful with string replacements to not break other things
                    // A better way is to iterate through the identifiers sorted by length descending
                    const sortedIds = Array.from(identifiers).sort((a, b) => b.length - a.length);

                    sortedIds.forEach(id => {
                        const renamed = this.getShortName(id);
                        
                        // Replace in class strings specifically to avoid partial matching
                        const isVar = id.startsWith('--');
                        
                        if (isVar) {
                            // Replace --variable everywhere
                            processed = processed.split(id).join(renamed);
                        } else {
                            // Replace class names in class="abc def"
                            processed = processed.replace(new RegExp(`(class=["'])([^"']*)(${id})([^"']*)(["'])`, 'g'), `$1$2${renamed}$4$5`);
                            // Replace IDs specifically
                            processed = processed.replace(new RegExp(`id=["']${id}["']`, 'g'), `id="${renamed}"`);
                            // Replace in CSS selectors (complex because it could be .class or #id)
                            processed = processed.replace(new RegExp(`([.#])${id}(?![a-zA-Z0-9_-])`, 'g'), `$1${renamed}`);
                            // Replace in JS querySelectors
                            processed = processed.replace(new RegExp(`(['"])([.#])${id}(['"])`, 'g'), `$1$2${renamed}$3`);
                        }
                    });
                }

                // JS Obfuscation for <script> content
                const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
                processed = processed.replace(scriptRegex, (match, scriptContent) => {
                    if (!scriptContent.trim()) return match;
                    
                    try {
                        const obRes = JavaScriptObfuscator.obfuscate(scriptContent, {
                            compact: true,
                            controlFlowFlattening: true,
                            controlFlowFlatteningThreshold: 0.75,
                            numbersToExpressions: true,
                            simplify: true,
                            stringArray: true,
                            stringArrayThreshold: 0.75,
                            unicodeEscapeSequence: options.deepJs
                        }).getObfuscatedCode();
                        return `<script>${obRes}<\/script>`;
                    } catch (e) {
                        console.error("JS Obfuscation failed for a block", e);
                        return match;
                    }
                });

                return this.minify(processed);
            }
        }

        function sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        async function simulateUiLag(min = 90, max = 220, withSignalDrop = false) {
            const delay = randomBetween(min, max);
            document.body.classList.add('fake-lag');
            if (withSignalDrop) {
                document.body.classList.add('signal-drop');
            }
            await sleep(delay);
            document.body.classList.remove('fake-lag');
            document.body.classList.remove('signal-drop');
            return delay;
        }

        async function runObfuscation() {
            const input = document.getElementById('inputCode').value;
            if (!input.trim()) return alert("Vui lòng nhập code!");

            await simulateUiLag(180, 360, Math.random() < 0.65);

            const btn = document.getElementById('btnRun');
            const btnText = document.getElementById('btnText');
            const loader = document.getElementById('loader');
            const outputArea = document.getElementById('outputCode');
            const placeholder = document.getElementById('placeholderStats');
            const stats = document.getElementById('stats');

            // UI Feedback
            btn.disabled = true;
            btnText.innerText = "ĐANG XỬ LÝ...";
            loader.classList.remove('hidden');

            // Artificial delay for "feel"
            await new Promise(r => setTimeout(r, 800));

            try {
                const engine = new ObflEngine();
                const options = {
                    renameCss: document.getElementById('renameCss').checked,
                    deepJs: document.getElementById('deepJs').checked
                };

                const result = engine.obfuscate(input, options);
                
                // Final Wrap (Script Locker)
                const finalCode = b64Escape(result);
                const wrapper = `<script>document.write(decodeURIComponent(escape(atob("${finalCode}"))));<\/script>`;

                outputArea.value = wrapper;
                
                // Show stats
                placeholder.classList.add('hidden');
                stats.classList.remove('hidden');
                document.getElementById('btnCopy').classList.remove('hidden');
                document.getElementById('btnDownload').classList.remove('hidden');

                const diff = ((wrapper.length / input.length) * 100 - 100).toFixed(1);
                document.getElementById('fileDiff').innerText = (diff > 0 ? '+' : '') + diff + '%';

            } catch (e) {
                console.error(e);
                alert("Đã xảy ra lỗi khi mã hóa. Kiểm tra Console để biết thêm chi tiết.");
            } finally {
                btn.disabled = false;
                btnText.innerText = "TIẾN HÀNH MÃ HÓA";
                loader.classList.add('hidden');
            }
        }

        function b64Escape(str) {
            return btoa(unescape(encodeURIComponent(str)));
        }

        async function copyResult() {
            await simulateUiLag(90, 170, Math.random() < 0.35);
            const out = document.getElementById('outputCode');
            out.select();
            document.execCommand('copy');
            
            const btn = document.getElementById('btnCopy');
            const originalText = btn.innerText;
            btn.innerText = "Copied!";
            btn.classList.replace('bg-slate-800', 'bg-green-600');
            setTimeout(() => {
                btn.innerText = originalText;
                btn.classList.replace('bg-green-600', 'bg-slate-800');
            }, 2000);
        }

        async function downloadResult() {
            await simulateUiLag(120, 220, Math.random() < 0.4);
            const code = document.getElementById('outputCode').value;
            const blob = new Blob([code], {type: 'text/html'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'obfuscated_app.html';
            a.click();
        }

        const shell = document.querySelector('.error-shell');
        const corruptPanels = Array.from(document.querySelectorAll('.corrupt-panel'));
        const coreRifts = Array.from(document.querySelectorAll('.core-rift'));

        function randomBetween(min, max) {
            return Math.random() * (max - min) + min;
        }

        function runCatastrophicCorruption() {
            if (!shell) return;

            document.body.classList.add('core-collapse');
            shell.classList.add('critical-failure');

            corruptPanels.forEach((panel, index) => {
                panel.style.setProperty('--corrupt-x', `${randomBetween(-24, 24).toFixed(1)}px`);
                panel.style.setProperty('--corrupt-y', `${randomBetween(-12, 12).toFixed(1)}px`);
                panel.style.setProperty('--corrupt-skew', `${randomBetween(-4.5, 4.5).toFixed(2)}deg`);
                panel.style.setProperty('--corrupt-hue', `${randomBetween(-26, 8).toFixed(1)}deg`);
                panel.style.setProperty('--ui-shift-x', `${randomBetween(-8, 8).toFixed(1)}px`);
                panel.style.setProperty('--ui-shift-y', `${randomBetween(-4, 4).toFixed(1)}px`);
                panel.style.setProperty('--ui-skew', `${randomBetween(-2.4, 2.4).toFixed(2)}deg`);
                panel.style.zIndex = String(3 + index);
            });

            coreRifts.forEach((rift, index) => {
                rift.style.top = `${randomBetween(index === 0 ? 10 : 48, index === 0 ? 28 : 72).toFixed(1)}vh`;
                rift.style.transform = `translate3d(${randomBetween(-140, 140).toFixed(1)}px, 0, 0) skewX(${randomBetween(-14, 14).toFixed(1)}deg)`;
                rift.style.clipPath = `polygon(0 ${randomBetween(0, 24).toFixed(1)}%, 100% ${randomBetween(0, 12).toFixed(1)}%, 100% ${randomBetween(56, 100).toFixed(1)}%, 0 ${randomBetween(72, 100).toFixed(1)}%)`;
            });

            const hold = randomBetween(180, 420);
            clearTimeout(window.__amcCorruptionTimer);
            window.__amcCorruptionTimer = setTimeout(() => {
                document.body.classList.remove('core-collapse');
                shell.classList.remove('critical-failure');
                corruptPanels.forEach(panel => {
                    panel.style.removeProperty('--corrupt-x');
                    panel.style.removeProperty('--corrupt-y');
                    panel.style.removeProperty('--corrupt-skew');
                    panel.style.removeProperty('--corrupt-hue');
                    panel.style.removeProperty('--ui-shift-x');
                    panel.style.removeProperty('--ui-shift-y');
                    panel.style.removeProperty('--ui-skew');
                    panel.style.removeProperty('z-index');
                });
                coreRifts.forEach(rift => {
                    rift.style.removeProperty('top');
                    rift.style.removeProperty('transform');
                    rift.style.removeProperty('clip-path');
                });
            }, hold);
        }

        setInterval(() => {
            if (Math.random() < 0.72) {
                runCatastrophicCorruption();
            }
        }, 1200);

        setInterval(() => {
            if (Math.random() < 0.42) {
                simulateUiLag(70, 160, Math.random() < 0.5);
            }
        }, 2600);

        // File handle
        document.getElementById('fileInput').addEventListener('change', async function(e) {
            const file = e.target.files[0];
            if (!file) return;
            await simulateUiLag(120, 240, Math.random() < 0.45);
            const reader = new FileReader();
            reader.onload = function(e) {
                document.getElementById('inputCode').value = e.target.result;
            };
            reader.readAsText(file);
        });