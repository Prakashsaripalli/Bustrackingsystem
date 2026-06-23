import fs from "fs";
import path from "path";

function findInDir(dirPath: string, query: string) {
  const files = fs.readdirSync(dirPath);
  files.forEach(file => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      findInDir(fullPath, query);
    } else if (file.endsWith(".ts") || file.endsWith(".js")) {
      const content = fs.readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      lines.forEach((line, idx) => {
        if (line.toLowerCase().includes(query.toLowerCase())) {
          console.log(`${path.relative(process.cwd(), fullPath)}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
  });
}

findInDir("src/app/api", "emit");
findInDir("src/app/api", "socket");
