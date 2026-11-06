import sharp from "sharp";

const svg = "public/icon.svg";
await sharp(svg).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(svg).resize(512, 512).png().toFile("public/icon-512.png");
await sharp({ create: { width: 512, height: 512, channels: 4, background: "#08284f" } }).composite([{ input: await sharp(svg).resize(390, 390).png().toBuffer(), left: 61, top: 61 }]).png().toFile("public/icon-maskable-512.png");
