import fs from "fs";
import path from "path";

function findInFile(filePath: string, query: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    if (line.toLowerCase().includes(query.toLowerCase())) {
      console.log(`${path.basename(filePath)}:${idx + 1}: ${line.trim()}`);
    }
  });
}

findInFile("server.js", "resolve");
findInFile("server.js", "alert");
findInFile("server/index.js", "resolve");
findInFile("server/index.js", "alert");
