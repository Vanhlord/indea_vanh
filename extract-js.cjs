const fs = require('fs');
const path = require('path');

const rootDir = 'c:\\Users\\vivet\\DU-AN-001\\WEB1\\WEB1';

function walkDir(dir, callback) {
    fs.readdirSync(dir).forEach(f => {
        let dirPath = path.join(dir, f);
        if (f === 'node_modules' || f === '.git' || f === '.github') return;
        let isDirectory = fs.statSync(dirPath).isDirectory();
        isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
    });
}

walkDir(rootDir, function(filePath) {
    if (filePath.endsWith('.html')) {
        let htmlContent = fs.readFileSync(filePath, 'utf8');
        const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
        let match;
        let scriptsToExtract = [];
        let modifiedHtml = htmlContent;

        while ((match = scriptRegex.exec(htmlContent)) !== null) {
            const scriptContent = match[1].trim();
            if (scriptContent.replace(/\/\/.*/g, '').trim().length > 0) {
                scriptsToExtract.push(scriptContent);
                modifiedHtml = modifiedHtml.replace(match[0], '');
            }
        }

        if (scriptsToExtract.length > 0) {
            let baseName = path.basename(filePath, '.html');
            const jsName = baseName + '.js';
            const jsDir = path.join(rootDir, 'html', 'js');
            if (!fs.existsSync(jsDir)) {
                fs.mkdirSync(jsDir, { recursive: true });
            }
            const jsFilePath = path.join(jsDir, jsName);
            const combinedJs = scriptsToExtract.join('\n\n// --- Split ---\n\n');
            fs.writeFileSync(jsFilePath, combinedJs, 'utf8');

            const scriptTag = `<script src="/html/js/${jsName}"></script>\n`;
            if (modifiedHtml.includes('</body>')) {
                modifiedHtml = modifiedHtml.replace('</body>', scriptTag + '</body>');
            } else {
                modifiedHtml += '\n' + scriptTag;
            }

            fs.writeFileSync(filePath, modifiedHtml, 'utf8');
            console.log(`Extracted JS from ${path.relative(rootDir, filePath)} to /html/js/${jsName}`);
        }
    }
});
