import fs from 'fs';
import path from 'path';

const htmlDir = 'c:\\Users\\vivet\\DU-AN-001\\WEB1\\WEB1\\html';
const jsDir = path.join(htmlDir, 'js');
const filesToProcess = [
    { htmlPath: path.join(htmlDir, 'index.html'), jsName: 'index.js' },
    { htmlPath: path.join('c:\\Users\\vivet\\DU-AN-001\\WEB1\\WEB1\\A11', 'donet.html'), jsName: 'donet.js' },
    { htmlPath: path.join('c:\\Users\\vivet\\DU-AN-001\\WEB1\\WEB1\\p', 'kho.html'), jsName: 'kho.js' },
    { htmlPath: path.join('c:\\Users\\vivet\\DU-AN-001\\WEB1\\WEB1\\tools', 'qr-code.html'), jsName: 'qr-code.js' },
    { htmlPath: path.join('c:\\Users\\vivet\\DU-AN-001\\WEB1\\WEB1\\admin', 'notifications.html'), jsName: 'notifications.js' },
    { htmlPath: path.join('c:\\Users\\vivet\\DU-AN-001\\WEB1\\WEB1\\tools', 'amc.html'), jsName: 'amc.js' },
    { htmlPath: path.join('c:\\Users\\vivet\\DU-AN-001\\WEB1\\WEB1\\tools', 'biendich.html'), jsName: 'biendich.js' },
    { htmlPath: path.join('c:\\Users\\vivet\\DU-AN-001\\WEB1\\WEB1\\tools', 'lock-script.html'), jsName: 'lock-script.js' },
    { htmlPath: path.join('c:\\Users\\vivet\\DU-AN-001\\WEB1\\WEB1\\tools', 'ma-hoa-javascript.html'), jsName: 'ma-hoa-javascript.js' }
];

if (!fs.existsSync(jsDir)) {
    fs.mkdirSync(jsDir, { recursive: true });
}

for (const fileObj of filesToProcess) {
    if (!fs.existsSync(fileObj.htmlPath)) {
        console.log(`Skipping ${fileObj.htmlPath} (not found)`);
        continue;
    }

    let htmlContent = fs.readFileSync(fileObj.htmlPath, 'utf8');
    
    // Find all <script>...</script> tags that do not have a src attribute
    // Be careful not to match <script src="..."></script>
    const scriptRegex = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
    
    let match;
    let scriptsToExtract = [];
    let modifiedHtml = htmlContent;

    while ((match = scriptRegex.exec(htmlContent)) !== null) {
        const scriptContent = match[1].trim();
        if (scriptContent.length > 0) {
            scriptsToExtract.push(scriptContent);
        }
        modifiedHtml = modifiedHtml.replace(match[0], ''); // Remove the inline script tag
    }

    if (scriptsToExtract.length > 0) {
        // Build the combined JS content
        const combinedJs = scriptsToExtract.join('\n\n// --- Split ---\n\n');
        
        // Write to js file
        const jsFilePath = path.join(jsDir, fileObj.jsName);
        fs.writeFileSync(jsFilePath, combinedJs, 'utf8');
        
        // Append <script src="/html/js/[name].js"></script> before </body>
        // Or if </body> is missing, just append at the end
        const scriptTag = `<script src="/html/js/${fileObj.jsName}"></script>\n`;
        if (modifiedHtml.includes('</body>')) {
            modifiedHtml = modifiedHtml.replace('</body>', scriptTag + '</body>');
        } else {
            modifiedHtml += '\n' + scriptTag;
        }

        fs.writeFileSync(fileObj.htmlPath, modifiedHtml, 'utf8');
        console.log(`Extracted JS from ${path.basename(fileObj.htmlPath)} to /html/js/${fileObj.jsName}`);
    } else {
        console.log(`No inline JS found in ${path.basename(fileObj.htmlPath)}`);
    }
}
