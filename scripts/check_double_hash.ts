import bcrypt from "bcryptjs";

async function main() {
  const hash2 = "$2b$10$2z0xQFy2Ks2MdENAwR4jQ.XQD07m/MWA3NTda7XPZpF9C5tdf8pxO"; // Ramesh current hash
  const hash5 = "$2b$10$ScIB8nYYxebrYIC7SSKVZ.9a9Y1KqjgfA6SkmFIE6o0zOA4cDNeRy"; // Test Driver current hash

  const candidates = [
    "••••••••",
    "••••••",
    "******",
    "********",
    "password",
    "123456",
    "12345678",
    "admin123",
    "student123",
    "",
  ];

  for (const c of candidates) {
    console.log(`Candidate '${c}':`);
    console.log(`  hash2:`, await bcrypt.compare(c, hash2));
    console.log(`  hash5:`, await bcrypt.compare(c, hash5));
  }
}

main().catch(console.error);
