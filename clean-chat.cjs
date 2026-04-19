const fs = require('fs');
const path = require('path');

function readDirRecursively(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach((file) => {
        file = path.join(dir, file);
        const stat = fs.statSync(file);
        if (stat && stat.isDirectory() && !file.includes('node_modules') && !file.includes('.git')) {
            results = results.concat(readDirRecursively(file));
        } else if (file.endsWith('.html')) {
            results.push(file);
        }
    });
    return results;
}

const htmlFiles = readDirRecursively('.');
let removedCount = 0;

htmlFiles.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    const beforeLength = content.length;
    
    // Pattern for <a> tags spanning multiple lines
    content = content.replace(/\s*<a[^>]*href=["'][^"']*A11\/chat\.html["'][^>]*>[\s\S]*?<\/a>/ig, '');
    
    // Pattern for <li> containing chat.html
    content = content.replace(/\s*<li[^>]*>[\s\S]*?A11\/chat\.html[\s\S]*?<\/li>/ig, '');
    
    // Pattern for <div> onclick
    content = content.replace(/\s*<div[^>]*onclick=["'][^"']*A11\/chat\.html["'][^>]*>[\s\S]*?<\/div>/ig, '');

    if (content.length !== beforeLength) {
        fs.writeFileSync(file, content, 'utf8');
        console.log('Removed chat references from ' + file);
        removedCount++;
    }
});

console.log('Processed ' + htmlFiles.length + ' files. Modified ' + removedCount + ' files.');
