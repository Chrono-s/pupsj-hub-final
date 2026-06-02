const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'public', 'css', 'app.css');
const content = fs.readFileSync(cssPath, 'utf8');

const stack = [];
let lines = content.split('\n');

for (let lineNum = 0; lineNum < lines.length; lineNum++) {
  const line = lines[lineNum];
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '{') {
      stack.push({ char, lineNum: lineNum + 1, content: line });
    } else if (char === '}') {
      if (stack.length === 0) {
        console.log(`Extra closing brace '}' at line ${lineNum + 1}: ${line}`);
      } else {
        stack.pop();
      }
    }
  }
}

if (stack.length > 0) {
  console.log(`\nUnclosed braces found: ${stack.length}`);
  stack.forEach((item, index) => {
    console.log(`\nUnclosed brace #${index + 1} at line ${item.lineNum}:`);
    console.log(`  ${item.content.trim()}`);
  });
} else {
  console.log("Brackets are perfectly balanced!");
}
